import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGENTS, EMPTY_OUTPUT, type AgentName, type AgentStructuredOutput } from "./agent-schema";

function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!error) return false;

  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes(`could not find the table 'public.${tableName}'`) ||
    lower.includes(`relation "public.${tableName}" does not exist`) ||
    lower.includes(`"public.${tableName}"`) && lower.includes("schema cache") ||
    lower.includes(`table '${tableName}'`) && lower.includes("schema cache") ||
    lower.includes(`public.${tableName}`) && lower.includes("does not exist")
  );
}

export const resolveOfficerLogin = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: string; username?: string; identifier?: string }) => ({
    identifier: String(input.identifier ?? input.username ?? input.email ?? "").trim().toLowerCase(),
  }))
  .handler(async ({ data }) => {
    if (!data.identifier) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, email, role")
      .or(`username.eq.${data.identifier},email.eq.${data.identifier}`)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Profile lookup failed during login:", error.message);
      return null;
    }

    if (!profile || !profile.email || !profile.role) return null;
    if (!["officer", "coordinator"].includes(profile.role)) return null;

    return {
      id: profile.id,
      username: profile.username,
      email: profile.email,
      role: profile.role,
    };
  });

export const analyzeAllIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: incidents, error } = await context.supabase
      .from("emergency_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message || "Could not load incidents for analysis.");
    }

    if (!incidents?.length) {
      return { ok: true, empty: true, summary: "No incidents are available for analysis." };
    }

    const fallbackSummary = buildIncidentBatchSummary(incidents);
    const incidentRefs = incidents.map((incident) => String(incident.ref_code ?? incident.id));
    const batchActions = buildIncidentBatchActions(incidents);
    const batchPriority = detectBatchPriority(incidents);
    const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;

    const saveBatchResult = async (summary: string, note: string | null, source: "ai" | "fallback") => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const payload = {
        request_id: null,
        batch_id: batchId,
        analysis_type: "batch",
        summary,
        actions: batchActions,
        resource_allocation: buildIncidentBatchAllocations(incidents),
        priority: batchPriority,
        incident_count: incidents.length,
        incident_refs: incidentRefs,
        status: source === "ai" ? "completed" : "fallback",
        created_by: context.userId,
      };

      const { error: saveError } = await supabaseAdmin.from("response_plans").insert(payload);
      if (saveError) {
        console.error("Batch analysis save failed:", saveError.message);
        throw new Error(saveError.message || "Could not save the combined incident analysis.");
      }

      return { summary, note };
    };

    const { data: providerRows } = await context.supabase.from("ai_provider_settings").select("*");
    const activeSelection = resolveProviderSelection(
      (providerRows ?? []).map((row) => ({
        slot: Number(row.slot),
        active: Boolean(row.active),
        default_model: typeof row.default_model === "string" ? row.default_model : null,
      })),
    );

    const selectedSlot = activeSelection?.slot ?? 1;
    const selectedRow = (providerRows ?? []).find((row) => Number(row.slot) === selectedSlot);
    const configured = Boolean((selectedRow?.base_url ?? "") && (selectedRow?.api_key ?? ""));
    const model = selectedRow?.default_model ?? activeSelection?.model ?? "openrouter/free";

    if (!configured || !model) {
      const result = await saveBatchResult(fallbackSummary, "AI provider settings are not configured yet, so the batch report was generated from the live incident data only.", "fallback");
      return { ok: true, empty: false, summary: result.summary, note: result.note };
    }

    try {
      const { completeChat, readSlot } = await import("./ai-providers.server");
      const fallbackSlot = readSlot((selectedSlot as 1 | 2 | 3) ?? 1);
      const slotCfg = {
        ...fallbackSlot,
        name: selectedRow?.name ?? fallbackSlot.name,
        baseUrl: String(selectedRow?.base_url ?? fallbackSlot.baseUrl ?? "").trim().replace(/\/+$/, ""),
        apiKey: String(selectedRow?.api_key ?? fallbackSlot.apiKey ?? "").trim(),
        defaultModel: selectedRow?.default_model ?? fallbackSlot.defaultModel,
        configured: Boolean((selectedRow?.base_url ?? fallbackSlot.baseUrl ?? "") && (selectedRow?.api_key ?? fallbackSlot.apiKey ?? "")),
      };

      const prompt = [
        "You are producing a single combined emergency-response report for the active incident set.",
        "Return only a concise but complete operational briefing in plain English.",
        buildIncidentBatchSummary(incidents),
      ].join("\n\n");

      const rawResult = await completeChat(
        slotCfg,
        model,
        "You are a senior emergency coordinator preparing one combined incident brief.",
        prompt,
      );

      const parsedResult = parseBatchResult(rawResult, fallbackSummary);
      const result = await saveBatchResult(parsedResult, null, "ai");
      return { ok: true, empty: false, summary: result.summary, note: result.note };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI analysis was unavailable for this incident set.";
      const result = await saveBatchResult(fallbackSummary, message, "fallback");
      return {
        ok: true,
        empty: false,
        summary: result.summary,
        note: result.note,
      };
    }
  });

function parseBatchResult(raw: string | null | undefined, fallback: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return fallback;

  const withoutFence = value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = withoutFence.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { summary?: string; overview?: string; message?: string };
      const summary = parsed.summary ?? parsed.overview ?? parsed.message;
      if (typeof summary === "string" && summary.trim()) return summary.trim();
    } catch {
      // fall through to plain text parsing
    }
  }

  return withoutFence || fallback;
}

function buildIncidentBatchActions(incidents: Array<Record<string, any>>) {
  const urgent = incidents.filter((incident) => String(incident.severity).toLowerCase() === "critical");
  const zones = Array.from(new Set(incidents.map((incident) => String(incident.zone ?? "Unassigned"))));

  return [
    {
      agent: "coordinator",
      action: `Prioritize ${urgent.length ? urgent.length : 0} urgent incident(s) and confirm that all critical requests are receiving immediate deployment support.`,
    },
    {
      agent: "logistics",
      action: `Stage resources toward ${zones.slice(0, 3).join(", ") || "the priority zones"} and confirm capacity across affected sectors.`,
    },
    {
      agent: "medical",
      action: `Check triage capacity, medical notes, and transport availability for the most severe and vulnerable cases.`,
    },
  ];
}

function detectBatchPriority(incidents: Array<Record<string, any>>) {
  const severityOrder = { critical: 4, high: 3, moderate: 2, low: 1 } as Record<string, number>;
  const maximum = incidents.reduce((best, incident) => {
    const value = severityOrder[String(incident.severity ?? "low").toLowerCase()] ?? 1;
    return Math.max(best, value);
  }, 1);

  if (maximum >= 4) return "critical";
  if (maximum >= 3) return "high";
  if (maximum >= 2) return "moderate";
  return "low";
}

function buildIncidentBatchAllocations(incidents: Array<Record<string, any>>) {
  const zoneCounts = incidents.reduce<Record<string, number>>((acc, incident) => {
    const zone = String(incident.zone ?? "Unassigned");
    acc[zone] = (acc[zone] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(zoneCounts).map(([zone, count]) => ({
    zone,
    quantity: count,
    item: "incident coverage",
  }));
}

function buildIncidentBatchSummary(incidents: Array<Record<string, any>>) {
  const total = incidents.length;
  const bySeverity = Object.entries(
    incidents.reduce<Record<string, number>>((acc, incident) => {
      const severity = String(incident.severity ?? "low");
      acc[severity] = (acc[severity] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const topZone = incidents
    .map((incident) => String(incident.zone ?? "Unassigned"))
    .reduce<Record<string, number>>((acc, zone) => {
      acc[zone] = (acc[zone] ?? 0) + 1;
      return acc;
    }, {});
  const topZoneEntry = Object.entries(topZone).sort((a, b) => b[1] - a[1])[0];
  const urgent = incidents.filter((incident) => String(incident.severity).toLowerCase() === "critical");

  return [
    `Overall incident summary: ${total} active incident(s) are currently in the system.`,
    `Severity breakdown: ${bySeverity.map(([level, count]) => `${level} (${count})`).join(", ") || "none"}.`,
    `Most active area: ${topZoneEntry ? `${topZoneEntry[0]} (${topZoneEntry[1]} incident(s))` : "No zone assigned"}.`,
    `Urgent cases: ${urgent.length ? urgent.map((incident) => incident.ref_code).join(", ") : "none"}.`,
    `Recommended actions: deploy the nearest available resources to the highest-priority zones, confirm contact details for each incident, and re-check capacity where event load is highest.`,
  ].join("\n");
}

/* ------------------------------------------------------------------ public */

/** Look up a submitted request by its reference code (safe fields only). */
export const getRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { refCode: string }) => ({
    refCode: String(input.refCode ?? "").trim().toUpperCase(),
  }))
  .handler(async ({ data }) => {
    if (!data.refCode) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("emergency_requests")
      .select("ref_code, emergency_type, severity, people_count, zone, status, created_at")
      .eq("ref_code", data.refCode)
      .maybeSingle();
    return row ?? null;
  });

/* --------------------------------------------------------------- dashboard */

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [requests, resources, officers, configs, plans, roleRes, profileRes] = await Promise.all([
      supabase.from("emergency_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("resources").select("*").order("category"),
      supabase.from("officers").select("*").order("agent_id"),
      supabase.from("agent_configs").select("*"),
      supabase.from("response_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("username, email, role").eq("id", userId).maybeSingle(),
    ]);
    const roles = (roleRes.data ?? []).map((r) => r.role as string);
    const profileRole = profileRes.data?.role ?? (roles.includes("coordinator") ? "coordinator" : "officer");
    const batchAnalysis = (plans.data ?? []).find((plan) => plan.analysis_type === "batch" || plan.batch_id || (!plan.request_id && plan.summary)) ?? null;
    return {
      requests: requests.data ?? [],
      resources: resources.data ?? [],
      officers: officers.data ?? [],
      configs: configs.data ?? [],
      plans: plans.data ?? [],
      batchAnalysis,
      profile: profileRes.data ?? null,
      isCoordinator: roles.includes("coordinator") || profileRole === "coordinator",
    };
  });

export const getBatchAnalysis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("response_plans")
      .select("*")
      .or("analysis_type.eq.batch,batch_id.not.is.null")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(error.message || "Could not load the consolidated incident analysis.");
    }

    return data?.[0] ?? null;
  });

/** Provider slot status + discovered models. API keys are never returned to the browser. */
export const getProviderSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readAllSlots, discoverModels, discoverModelDetails, resolveProviderSelection } = await import(
      "./ai-providers.server",
    );

    let rows: Array<Record<string, any>> = [];
    try {
      const result = await context.supabase.from("ai_provider_settings").select("*").order("slot");
      rows = result.data ?? [];
    } catch (error) {
      if (!isMissingTableError(error, "ai_provider_settings")) {
        throw error;
      }
      rows = [];
    }

    const rowsBySlot = new Map(rows.map((row) => [Number(row.slot), row]));

    const allSlots = readAllSlots().map((s) => {
      const row = rowsBySlot.get(s.slot);
      return {
        ...s,
        name: row?.name ?? s.name,
        baseUrl: row?.base_url ?? s.baseUrl,
        apiKey: row?.api_key ?? s.apiKey,
        defaultModel: row?.default_model ?? s.defaultModel,
        configured: Boolean((row?.base_url ?? s.baseUrl) && (row?.api_key ?? s.apiKey)),
        active: Boolean(row?.active),
      };
    });

    const activeSelection = resolveProviderSelection(
      allSlots.map((slot) => ({ slot: slot.slot, active: slot.active, default_model: slot.defaultModel })),
    );

    return Promise.all(
      allSlots.map(async (s) => {
        const details = await discoverModelDetails(s);
        const models = await discoverModels(s);
        return {
          slot: s.slot,
          name: s.name,
          baseUrl: s.baseUrl,
          configured: s.configured,
          active: s.active || (!!activeSelection && activeSelection.slot === s.slot),
          defaultModel: s.defaultModel,
          modelCount: details.length,
          models,
          modelDetails: details,
        };
      }),
    );
  });

export const testProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { slot: number; name: string; baseUrl: string; apiKey: string }) => ({
    slot: Number(input.slot ?? 1),
    name: String(input.name ?? "").trim(),
    baseUrl: String(input.baseUrl ?? "").trim(),
    apiKey: String(input.apiKey ?? "").trim(),
  }))
  .handler(async ({ data, context }) => {
    const { data: roleRes } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roleRes?.some((row) => row.role === "coordinator")) {
      throw new Error("Only the coordinator can validate AI provider keys.");
    }

    const { validateProviderConnection } = await import("./ai-providers.server");
    const result = await validateProviderConnection({
      slot: Math.min(3, Math.max(1, data.slot)) as 1 | 2 | 3,
      name: data.name || `Provider slot ${Math.min(3, Math.max(1, data.slot))}`,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      defaultModel: null,
      configured: Boolean(data.baseUrl && data.apiKey),
    });

    return { ok: result.ok, models: result.models, error: result.error ?? null };
  });

export const saveProviderSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      slot: number;
      name: string;
      baseUrl: string;
      apiKey: string;
      defaultModel: string;
      active: boolean;
    }) => ({
      slot: Number(input.slot ?? 1),
      name: String(input.name ?? "").trim(),
      baseUrl: String(input.baseUrl ?? "").trim(),
      apiKey: String(input.apiKey ?? "").trim(),
      defaultModel: String(input.defaultModel ?? "").trim(),
      active: Boolean(input.active),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: roleRes } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!roleRes?.some((row) => row.role === "coordinator")) {
      throw new Error("Only the coordinator can change AI provider settings.");
    }

    const slot = Math.min(3, Math.max(1, data.slot));
    let currentRow: Record<string, any> | null = null;
    try {
      const { data } = await context.supabase
        .from("ai_provider_settings")
        .select("*")
        .eq("slot", slot)
        .maybeSingle();
      currentRow = data ?? null;
    } catch (error) {
      if (!isMissingTableError(error, "ai_provider_settings")) {
        throw error;
      }
      currentRow = null;
    }

    const normalizedName = data.name || currentRow?.name || `Provider slot ${slot}`;
    const normalizedBaseUrl = data.baseUrl || currentRow?.base_url || null;
    const normalizedApiKey = data.apiKey || currentRow?.api_key || null;
    const normalizedDefaultModel = data.defaultModel || currentRow?.default_model || null;

    if (data.active) {
      try {
        await context.supabase.from("ai_provider_settings").update({ active: false }).neq("slot", slot);
      } catch (error) {
        if (!isMissingTableError(error, "ai_provider_settings")) {
          throw error;
        }
      }
    }

    try {
      const { error } = await context.supabase.from("ai_provider_settings").upsert(
        {
          slot,
          name: normalizedName,
          base_url: normalizedBaseUrl ? String(normalizedBaseUrl).trim().replace(/\/+$/, "") : null,
          api_key: normalizedApiKey ? String(normalizedApiKey).trim() : null,
          default_model: normalizedDefaultModel ? String(normalizedDefaultModel).trim() : null,
          active: data.active,
          model_list: [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slot" },
      );

      if (error) throw new Error(error.message || "Could not save AI provider settings.");
      return { ok: true };
    } catch (error) {
      if (isMissingTableError(error, "ai_provider_settings")) {
        throw new Error("AI provider settings are not configured in the database yet. Apply the required Supabase migration to enable AI provider configuration.");
      }
      throw error;
    }
  });

export const addOfficer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { username: string; agentId: string }) => ({
    username: String(input.username ?? "").trim().toLowerCase(),
    agentId: String(input.agentId ?? "").trim(),
  }))
  .handler(async ({ data, context }) => {
    if (!/^[a-z0-9._-]{3,32}$/.test(data.username)) throw new Error("Invalid username.");
    if (!/^[0-9]{4}$/.test(data.agentId)) throw new Error("Agent ID must be exactly 4 digits.");
    const { error } = await context.supabase
      .from("officers")
      .insert({ username: data.username, agent_id: data.agentId, role: "officer" });
    if (error) {
      throw new Error(
        error.code === "23505"
          ? "That username or Agent ID is already in use."
          : "Only the coordinator can add officers.",
      );
    }
    return { ok: true };
  });

export const saveAgentConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agent: string; providerSlot: number; model: string }) => ({
    agent: String(input.agent),
    providerSlot: Number(input.providerSlot),
    model: String(input.model ?? ""),
  }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("agent_configs")
      .update({ provider_slot: data.providerSlot, model: data.model || null, updated_at: new Date().toISOString() })
      .eq("agent", data.agent);
    if (error) throw new Error("Only the coordinator can change agent settings.");
    return { ok: true };
  });

/* ------------------------------------------------------------ coordination */

function parseOutput(raw: string): AgentStructuredOutput {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ...EMPTY_OUTPUT, reasoning_summary: raw.slice(0, 800) };
  try {
    const parsed = JSON.parse(match[0]) as Partial<AgentStructuredOutput>;
    return {
      findings: parsed.findings ?? [],
      recommendations: parsed.recommendations ?? [],
      resource_requirements: parsed.resource_requirements ?? [],
      priority: parsed.priority ?? "moderate",
      conflicts: parsed.conflicts ?? [],
      reasoning_summary: parsed.reasoning_summary ?? "",
    };
  } catch {
    return { ...EMPTY_OUTPUT, reasoning_summary: raw.slice(0, 800) };
  }
}

const OUTPUT_CONTRACT = `Reply with ONLY a JSON object of this exact shape:
{"findings":[string],"recommendations":[string],"resource_requirements":[{"item":string,"quantity":string,"zone":string}],"priority":"critical"|"high"|"moderate"|"low","conflicts":[string],"reasoning_summary":string}
Keep it concise and operational. reasoning_summary is a short briefing line for a human commander — never expose internal deliberation.`;

/** Runs the three agents in sequence; each one sees the previous agents' structured output. */
export const runCoordination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => ({ requestId: String(input.requestId) }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { readSlot, completeChat, resolveProviderSelection } = await import("./ai-providers.server");

    const { data: req } = await supabase
      .from("emergency_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Error("Request not found.");

    const { data: resources } = await supabase.from("resources").select("*");
    const { data: configs } = await supabase.from("agent_configs").select("*");
    const { data: providerRows, error: providerError } = await supabase.from("ai_provider_settings").select("*");

    if (providerError && isMissingTableError(providerError, "ai_provider_settings")) {
      return {
        ok: true,
        skipped: true,
        reason: "AI provider settings are not configured in the database yet. Basic request processing is still available; AI coordination is skipped until the provider schema is applied.",
      };
    }
    if (providerError) throw new Error(providerError.message || "Could not load AI provider settings.");

    const runtimeSelection = resolveProviderSelection(
      (providerRows ?? []).map((row) => ({
        slot: Number(row.slot),
        active: Boolean(row.active),
        default_model: typeof row.default_model === "string" ? row.default_model : null,
      })),
    );

    const incident = `INCIDENT ${req.ref_code}
Type: ${req.emergency_type} | Severity: ${req.severity} | People affected: ${req.people_count}
Location: ${req.location_text} (${req.zone ?? "zone unassigned"})
Medical / vulnerability notes: ${req.medical_notes ?? "none reported"}
Current status: ${req.status}

AVAILABLE RESOURCES (name | category | available/total | zone):
${(resources ?? []).map((r) => `- ${r.name} | ${r.category} | ${r.available}/${r.quantity} | ${r.zone ?? "-"}`).join("\n")}`;

    const shared: { agent: AgentName; output: AgentStructuredOutput }[] = [];

    for (const agent of AGENTS) {
      const cfg = configs?.find((c) => c.agent === agent.key);
      const selectedSlot = runtimeSelection?.slot ?? (cfg?.provider_slot ?? 1);
      const row = (providerRows ?? []).find((item) => Number(item.slot) === selectedSlot);
      const fallbackSlot = readSlot(((selectedSlot as 1 | 2 | 3) ?? 1));
      const baseUrl = String(row?.base_url ?? fallbackSlot.baseUrl ?? "").trim().replace(/\/+$/, "");
      const apiKey = String(row?.api_key ?? fallbackSlot.apiKey ?? "").trim();
      const slotCfg = {
        ...fallbackSlot,
        name: row?.name ?? fallbackSlot.name,
        baseUrl,
        apiKey,
        defaultModel: row?.default_model ?? fallbackSlot.defaultModel,
        configured: Boolean(baseUrl && apiKey),
      };
      const model = runtimeSelection?.model || cfg?.model || row?.default_model || slotCfg.defaultModel;
      if (!slotCfg.configured || !model) {
        throw new Error(
          `${agent.label} has no usable AI provider. Configure the active provider slot and pick a model.`,
        );
      }

      const peerContext = shared.length
        ? `\n\nSTRUCTURED OUTPUT FROM OTHER AGENTS (use it, flag conflicts):\n${JSON.stringify(
            shared.map((s) => ({ agent: s.agent, ...s.output })),
            null,
            1,
          )}`
        : "";

      const raw = await completeChat(
        slotCfg,
        model,
        `You are the ${agent.label} in an emergency-response command system. Scope: ${agent.brief}\n${OUTPUT_CONTRACT}`,
        `${incident}${peerContext}`,
      );
      const output = parseOutput(raw);
      shared.push({ agent: agent.key, output });

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("agent_outputs").insert({
        request_id: req.id,
        agent: agent.key,
        provider_slot: slotCfg.slot,
        provider_name: slotCfg.name,
        model,
        findings: output.findings,
        recommendations: output.recommendations,
        resource_requirements: output.resource_requirements,
        priority: output.priority,
        conflicts: output.conflicts,
        reasoning_summary: output.reasoning_summary,
      });
    }

    // Coordinator layer: merge the three structured outputs into one plan.
    const order = { critical: 3, high: 2, moderate: 1, low: 0 } as const;
    const priority = shared
      .map((s) => s.output.priority)
      .reduce((a, b) => (order[b] > order[a] ? b : a), "low" as AgentStructuredOutput["priority"]);

    const actions = shared.flatMap((s) =>
      s.output.recommendations.map((text) => ({ agent: s.agent, action: text })),
    );
    const allocation = shared.flatMap((s) =>
      s.output.resource_requirements.map((r) => ({ agent: s.agent, ...r })),
    );
    const conflicts = shared.flatMap((s) => s.output.conflicts);
    const summary = [
      `Coordinated response plan for ${req.ref_code} — priority ${priority.toUpperCase()}.`,
      ...shared.map((s) => `${s.agent}: ${s.output.reasoning_summary}`),
      conflicts.length ? `Conflicts to resolve: ${conflicts.join("; ")}` : "No inter-agent conflicts reported.",
    ].join("\n");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("response_plans").insert({
      request_id: req.id,
      summary,
      actions,
      resource_allocation: allocation,
      priority,
    });
    await supabaseAdmin.from("emergency_requests").update({ status: "planned" }).eq("id", req.id);

    return { ok: true };
  });

export const saveResource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id?: string; name: string; category: string; quantity: number; available: number; zone?: string; status?: string }) => ({
    id: String(input.id ?? ""),
    name: String(input.name ?? "").trim(),
    category: String(input.category ?? "").trim(),
    quantity: Number(input.quantity ?? 0),
    available: Number(input.available ?? 0),
    zone: String(input.zone ?? "").trim() || null,
    status: String(input.status ?? "ready").trim() || "ready",
  }))
  .handler(async ({ data, context }) => {
    const normalizedName = data.name;
    const normalizedCategory = data.category;
    if (!normalizedName || !normalizedCategory) {
      throw new Error("Resource name and category are required.");
    }

    const quantity = Math.max(0, Number(data.quantity) || 0);
    const available = Math.max(0, Math.min(quantity, Number(data.available) || 0));

    const payload = {
      name: normalizedName,
      category: normalizedCategory,
      quantity,
      available,
      zone: data.zone,
      status: data.status,
    };

    if (data.id) {
      const { error } = await context.supabase.from("resources").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message || "Could not update resource.");
      return { ok: true, updated: true };
    }

    const { data: inserted, error } = await context.supabase.from("resources").insert(payload).select("id").single();
    if (error) throw new Error(error.message || "Could not create resource.");
    return { ok: true, updated: false, id: inserted?.id ?? null };
  });

export const getRequestDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => ({ requestId: String(input.requestId) }))
  .handler(async ({ data, context }) => {
    const [outputs, plan] = await Promise.all([
      context.supabase
        .from("agent_outputs")
        .select("*")
        .eq("request_id", data.requestId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("response_plans")
        .select("*")
        .eq("request_id", data.requestId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    return { outputs: outputs.data ?? [], plan: plan.data?.[0] ?? null };
  });
