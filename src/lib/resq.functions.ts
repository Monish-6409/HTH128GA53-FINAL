import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGENTS, EMPTY_OUTPUT, type AgentName, type AgentStructuredOutput } from "./agent-schema";

const DEMO_USERNAME = "umar";
const DEMO_PASSWORD = "umar1234";
export const USERNAME_DOMAIN = "resq.local";

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

/** Creates the seeded demo coordinator account the first time it is needed. */
export const ensureDemoCoordinator = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const email = `${DEMO_USERNAME}@${USERNAME_DOMAIN}`;

  const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = list?.users.find((u) => u.email === email) ?? null;

  if (!user) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { username: DEMO_USERNAME },
    });
    if (error) throw new Error(error.message);
    user = created.user;
  }
  if (!user) return { ok: false };

  await supabaseAdmin.from("user_roles").upsert(
    { user_id: user.id, role: "coordinator" },
    { onConflict: "user_id,role" },
  );
  await supabaseAdmin.from("officers").update({ user_id: user.id }).eq("username", DEMO_USERNAME);
  return { ok: true };
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

/** Provider slot status + discovered models. API keys are never returned. */
export const getProviderSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { readAllSlots, discoverModels } = await import("./ai-providers.server");
    const slots = readAllSlots();
    return Promise.all(
      slots.map(async (s) => ({
        slot: s.slot,
        name: s.name,
        configured: s.configured,
        defaultModel: s.defaultModel,
        models: await discoverModels(s),
      })),
    );
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
    const { readSlot, completeChat } = await import("./ai-providers.server");

    const { data: req } = await supabase
      .from("emergency_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Error("Request not found.");

    const { data: resources } = await supabase.from("resources").select("*");
    const { data: configs } = await supabase.from("agent_configs").select("*");

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
      const slotCfg = readSlot(((cfg?.provider_slot ?? 1) as 1 | 2 | 3));
      const model = cfg?.model || slotCfg.defaultModel;
      if (!slotCfg.configured || !model) {
        throw new Error(
          `${agent.label} has no usable AI provider. Configure provider slot ${slotCfg.slot} and pick a model.`,
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
