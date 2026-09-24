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
  .inputValidator((input: { email: string }) => ({
    email: String(input.email ?? "").trim().toLowerCase(),
  }))
  .handler(async ({ data }) => {
    if (!data.email) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, email, role")
      .eq("email", data.email)
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
    const [requests, resources, officers, configs, plans, roleRes] = await Promise.all([
      supabase.from("emergency_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("resources").select("*").order("category"),
      supabase.from("officers").select("*").order("agent_id"),
      supabase.from("agent_configs").select("*"),
      supabase.from("response_plans").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const roles = (roleRes.data ?? []).map((r) => r.role as string);
    return {
      requests: requests.data ?? [],
      resources: resources.data ?? [],
      officers: officers.data ?? [],
      configs: configs.data ?? [],
      plans: plans.data ?? [],
      isCoordinator: roles.includes("coordinator"),
    };
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
