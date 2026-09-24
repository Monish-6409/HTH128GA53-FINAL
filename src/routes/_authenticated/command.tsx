import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AGENTS } from "@/lib/agent-schema";
import {
  addOfficer,
  getDashboard,
  getProviderSlots,
  getRequestDetail,
  runCoordination,
  saveAgentConfig,
  saveProviderSettings,
  testProviderConnection,
} from "@/lib/resq.functions";

export const Route = createFileRoute("/_authenticated/command")({
  head: () => ({
    meta: [
      { title: "Command Dashboard — ResQ AI" },
      {
        name: "description",
        content:
          "ResQ AI coordinator command dashboard: live incidents, resources, responders and multi-agent AI response planning.",
      },
      { property: "og:title", content: "Command Dashboard — ResQ AI" },
      { property: "og:description", content: "Coordinator command dashboard for ResQ AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Command,
});

const sevTone: Record<string, string> = {
  critical: "bg-critical text-critical-foreground",
  high: "bg-warning text-warning-foreground",
  moderate: "bg-secondary text-secondary-foreground",
  low: "bg-muted text-muted-foreground",
};

const PROVIDER_PRESETS = [
  { id: "custom", label: "Custom provider", name: "Custom provider", baseUrl: "" },
  { id: "openrouter", label: "OpenRouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "openai", label: "OpenAI", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "groq", label: "Groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { id: "together", label: "Together AI", name: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  { id: "gemini", label: "Google Gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "deepseek", label: "DeepSeek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { id: "local", label: "Local OpenAI-compatible", name: "Local provider", baseUrl: "http://localhost:11434/v1" },
] as const;

function Command() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const dashboardFn = useServerFn(getDashboard);
  const slotsFn = useServerFn(getProviderSlots);
  const detailFn = useServerFn(getRequestDetail);
  const runFn = useServerFn(runCoordination);
  const addOfficerFn = useServerFn(addOfficer);
  const saveConfigFn = useServerFn(saveAgentConfig);
  const saveProviderSettingsFn = useServerFn(saveProviderSettings);
  const testProviderFn = useServerFn(testProviderConnection);

  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [providerPreset, setProviderPreset] = useState<string>("custom");
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [providerBusy, setProviderBusy] = useState<"validate" | "save" | null>(null);
  const [providerForm, setProviderForm] = useState({
    slot: 1,
    name: "",
    baseUrl: "",
    apiKey: "",
    defaultModel: "",
  });

  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => dashboardFn({}) });
  const slots = useQuery({ queryKey: ["slots"], queryFn: () => slotsFn({}) });
  const detail = useQuery({
    queryKey: ["detail", selected],
    enabled: Boolean(selected),
    queryFn: () => detailFn({ data: { requestId: selected as string } }),
  });

  const d = dash.data;
  const providerSlotInfo = (slots.data ?? []).find((s) => s.slot === providerForm.slot) ?? (slots.data ?? [])[0];
  const modelOptions = Array.from(new Set([...discoveredModels, ...(providerSlotInfo?.models ?? [])]));

  useEffect(() => {
    if (!slots.data?.length) return;
    const active = slots.data.find((s) => s.active) ?? slots.data[0];
    if (!active) return;
    setProviderForm((prev) => ({
      ...prev,
      slot: active.slot,
      name: active.name,
      baseUrl: active.baseUrl ?? "",
      defaultModel: active.defaultModel ?? "",
    }));
  }, [slots.data]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  async function onRun(id: string) {
    setNotice(null);
    setRunning(true);
    setSelected(id);
    try {
      await runFn({ data: { requestId: id } });
      await queryClient.invalidateQueries();
      setNotice("Coordinated response plan generated.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Coordination failed.");
    }
    setRunning(false);
  }

  const counts = {
    open: d?.requests.filter((r) => r.status !== "resolved").length ?? 0,
    critical: d?.requests.filter((r) => r.severity === "critical").length ?? 0,
    people: d?.requests.reduce((s, r) => s + (r.people_count ?? 0), 0) ?? 0,
    responders: d?.officers.length ?? 0,
  };
  const zones = Array.from(new Set((d?.requests ?? []).map((r) => r.zone).filter(Boolean))) as string[];

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-navy text-navy-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-sm bg-critical text-xs font-bold text-critical-foreground">
              RQ
            </span>
            <div>
              <p className="text-sm font-semibold">ResQ AI · Command Dashboard</p>
              <p className="text-xs opacity-70">
                {d?.isCoordinator ? "Coordinator access" : "Officer access"} · Regional flood operation
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="rounded-sm border border-navy-foreground/30 px-3 py-1.5 text-xs font-semibold uppercase hover:bg-navy-muted"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-6">
        {notice && (
          <div className="panel border-accent/40 bg-accent/5 p-3 text-sm">{notice}</div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open requests" value={counts.open} />
          <Stat label="Critical" value={counts.critical} tone="text-critical" />
          <Stat label="People affected" value={counts.people} />
          <Stat label="Responders on roster" value={counts.responders} />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="panel p-5">
            <h2 className="text-base font-semibold">Incidents</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 label-cap">Ref</th>
                    <th className="py-2 pr-3 label-cap">Type</th>
                    <th className="py-2 pr-3 label-cap">Severity</th>
                    <th className="py-2 pr-3 label-cap">Zone</th>
                    <th className="py-2 pr-3 label-cap">People</th>
                    <th className="py-2 pr-3 label-cap">Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(d?.requests ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b border-border/60 ${selected === r.id ? "bg-muted/60" : ""}`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{r.ref_code}</td>
                      <td className="py-2 pr-3">{r.emergency_type}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${sevTone[r.severity] ?? ""}`}>
                          {r.severity}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.zone ?? "—"}</td>
                      <td className="py-2 pr-3">{r.people_count}</td>
                      <td className="py-2 pr-3">{r.status}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => setSelected(r.id)}
                          className="rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted"
                        >
                          View
                        </button>
                        <button
                          onClick={() => void onRun(r.id)}
                          disabled={running}
                          className="ml-2 rounded-sm bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                        >
                          {running && selected === r.id ? "Running…" : "Run AI"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel p-5">
            <h2 className="text-base font-semibold">Operational map</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Zone overview — affected sectors with open requests.
            </p>
            <div className="mt-3 grid gap-2 rounded-md border border-border bg-panel p-3">
              {zones.length === 0 && <p className="text-sm text-muted-foreground">No zones reporting.</p>}
              {zones.map((z) => {
                const inZone = (d?.requests ?? []).filter((r) => r.zone === z);
                const crit = inZone.some((r) => r.severity === "critical");
                return (
                  <div key={z} className="flex items-center justify-between rounded-sm bg-card px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${crit ? "bg-critical" : "bg-warning"}`} />
                      {z}
                    </span>
                    <span className="text-xs text-muted-foreground">{inZone.length} request(s)</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">AI provider settings</h2>
            <span className="text-xs text-muted-foreground">
              Active for all AI replies: {providerSlotInfo?.name ?? "Not selected"}
            </span>
          </div>

          {d?.isCoordinator ? (
            <>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="label-cap">Provider preset</span>
                  <select
                    value={providerPreset}
                    onChange={(e) => {
                      const preset = PROVIDER_PRESETS.find((p) => p.id === e.target.value);
                      if (!preset) return;
                      setProviderPreset(preset.id);
                      setProviderForm((prev) => ({
                        ...prev,
                        name: preset.name,
                        baseUrl: preset.baseUrl,
                      }));
                    }}
                    className="rounded-sm border border-input bg-card px-2 py-2 text-sm"
                  >
                    {PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="label-cap">Provider slot</span>
                  <select
                    value={providerForm.slot}
                    onChange={(e) => {
                      const nextSlot = Number(e.target.value);
                      const nextProvider = (slots.data ?? []).find((s) => s.slot === nextSlot) ?? (slots.data ?? [])[0];
                      setProviderForm((prev) => ({
                        ...prev,
                        slot: nextSlot,
                        name: nextProvider?.name ?? prev.name,
                        baseUrl: nextProvider?.baseUrl ?? "",
                        defaultModel: nextProvider?.defaultModel ?? "",
                      }));
                    }}
                    className="rounded-sm border border-input bg-card px-2 py-2 text-sm"
                  >
                    {(slots.data ?? []).map((s) => (
                      <option key={s.slot} value={s.slot}>
                        Slot {s.slot} · {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="label-cap">Display name</span>
                  <input
                    value={providerForm.name}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="rounded-sm border border-input bg-card px-2 py-2 text-sm"
                  />
                </label>
                <label className="grid gap-1.5 md:col-span-2">
                  <span className="label-cap">Base URL</span>
                  <input
                    value={providerForm.baseUrl}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    className="rounded-sm border border-input bg-card px-2 py-2 text-sm font-mono"
                    placeholder="https://openrouter.ai/api/v1"
                  />
                </label>
                <label className="grid gap-1.5 md:col-span-2">
                  <span className="label-cap">API key</span>
                  <input
                    type="password"
                    value={providerForm.apiKey}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    className="rounded-sm border border-input bg-card px-2 py-2 text-sm font-mono"
                    placeholder="Paste a provider API key to scan and activate"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="label-cap">Selected model</span>
                  <select
                    value={providerForm.defaultModel}
                    onChange={(e) => setProviderForm((prev) => ({ ...prev, defaultModel: e.target.value }))}
                    className="rounded-sm border border-input bg-card px-2 py-2 text-sm"
                  >
                    {!modelOptions.length && <option value="">No models discovered yet</option>}
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end justify-end gap-2">
                  <button
                    type="button"
                    disabled={providerBusy !== null}
                    onClick={async () => {
                      if (!providerForm.baseUrl || !providerForm.apiKey) {
                        setNotice("Enter a base URL and an API key before validating.");
                        return;
                      }
                      setProviderBusy("validate");
                      try {
                        const result = await testProviderFn({
                          data: {
                            slot: providerForm.slot,
                            name: providerForm.name,
                            baseUrl: providerForm.baseUrl,
                            apiKey: providerForm.apiKey,
                          },
                        });
                        if (!result.ok) {
                          setNotice(result.error ?? "The provider key could not be validated.");
                          return;
                        }
                        const ids = result.models.map((m) => m.id);
                        setDiscoveredModels(ids);
                        setProviderForm((prev) => ({
                          ...prev,
                          defaultModel: prev.defaultModel && ids.includes(prev.defaultModel) ? prev.defaultModel : ids[0] ?? "",
                        }));
                        setNotice(
                          ids.length
                            ? `Key validated. ${ids.length} model(s) discovered — pick one, then Save & activate.`
                            : "Key validated, but the provider did not list any models.",
                        );
                      } catch (err) {
                        setNotice(err instanceof Error ? err.message : "Could not validate AI provider.");
                      } finally {
                        setProviderBusy(null);
                      }
                    }}
                    className="rounded-sm border border-border bg-card px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {providerBusy === "validate" ? "Validating…" : "Validate key"}
                  </button>
                  <button
                    type="button"
                    disabled={providerBusy !== null}
                    onClick={async () => {
                      setProviderBusy("save");
                      try {
                        await saveProviderSettingsFn({
                          data: {
                            slot: providerForm.slot,
                            name: providerForm.name,
                            baseUrl: providerForm.baseUrl,
                            apiKey: providerForm.apiKey,
                            defaultModel: providerForm.defaultModel,
                            active: true,
                          },
                        });
                        await queryClient.invalidateQueries({ queryKey: ["slots"] });
                        await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                        setProviderForm((prev) => ({ ...prev, apiKey: "" }));
                        setNotice("AI provider saved and activated.");
                      } catch (err) {
                        setNotice(err instanceof Error ? err.message : "Could not update AI provider settings.");
                      } finally {
                        setProviderBusy(null);
                      }
                    }}
                    className="rounded-sm bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {providerBusy === "save" ? "Saving…" : "Save & activate"}
                  </button>
                </div>
              </div>

              {providerSlotInfo?.modelDetails?.length ? (
                <div className="mt-4 rounded-md border border-border bg-card p-3">
                  <p className="label-cap">Detected models</p>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {(providerSlotInfo.modelDetails ?? []).map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        onClick={() => setProviderForm((prev) => ({ ...prev, defaultModel: model.id }))}
                        className={`rounded-sm border p-2 text-left text-xs ${
                          providerForm.defaultModel === model.id
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{model.id}</span>
                          {model.owned_by && <span className="text-muted-foreground">{model.owned_by}</span>}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {model.description ?? model.object ?? "Compatible model"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">
                  Add a valid API key and save to scan the provider catalog for available models.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Only the coordinator can edit AI provider keys and the live default model.
            </p>
          )}
        </section>

        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">AI coordination</h2>
            <span className="text-xs text-muted-foreground">
              Logistics → Medical → Communications, each reading the others' structured output
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {AGENTS.map((a) => {
              const cfg = d?.configs.find((c) => c.agent === a.key);
              const slotInfo = slots.data?.find((s) => s.slot === (cfg?.provider_slot ?? 1));
              return (
                <div key={a.key} className="rounded-md border border-border bg-panel p-4">
                  <p className="text-sm font-semibold">{a.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{a.brief}</p>
                  <div className="mt-3 grid gap-2">
                    <select
                      value={cfg?.provider_slot ?? 1}
                      disabled={!d?.isCoordinator}
                      onChange={async (e) => {
                        await saveConfigFn({
                          data: {
                            agent: a.key,
                            providerSlot: Number(e.target.value),
                            model: "",
                          },
                        });
                        await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                      }}
                      className="rounded-sm border border-input bg-card px-2 py-1.5 text-xs"
                    >
                      {(slots.data ?? []).map((s) => (
                        <option key={s.slot} value={s.slot}>
                          Slot {s.slot} — {s.name} {s.configured ? "" : "(not configured)"}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cfg?.model ?? ""}
                      disabled={!d?.isCoordinator}
                      onChange={async (e) => {
                        await saveConfigFn({
                          data: {
                            agent: a.key,
                            providerSlot: cfg?.provider_slot ?? 1,
                            model: e.target.value,
                          },
                        });
                        await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                      }}
                      className="rounded-sm border border-input bg-card px-2 py-1.5 text-xs"
                    >
                      <option value="">
                        {slotInfo?.defaultModel ? `Default (${slotInfo.defaultModel})` : "Select model"}
                      </option>
                      {(slotInfo?.models ?? []).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          {selected && (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="text-sm font-semibold">
                Agent results — {d?.requests.find((r) => r.id === selected)?.ref_code}
              </h3>
              {(detail.data?.outputs.length ?? 0) === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  No agent output yet. Use “Run AI” on the incident.
                </p>
              )}
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                {(detail.data?.outputs ?? []).map((o) => (
                  <div key={o.id} className="rounded-md border border-border p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold capitalize">{o.agent}</p>
                      <span className={`rounded-sm px-2 py-0.5 text-xs ${sevTone[o.priority ?? ""] ?? "bg-muted"}`}>
                        {o.priority}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {o.provider_name} · {o.model}
                    </p>
                    <List title="Findings" items={o.findings as string[]} />
                    <List title="Recommendations" items={o.recommendations as string[]} />
                    <List title="Conflicts" items={o.conflicts as string[]} />
                    <p className="mt-3 text-xs text-muted-foreground">{o.reasoning_summary}</p>
                  </div>
                ))}
              </div>
              {detail.data?.plan && (
                <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-4">
                  <p className="label-cap">Coordinated response plan</p>
                  <pre className="mt-2 text-sm whitespace-pre-wrap">{detail.data.plan.summary}</pre>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                    {(detail.data.plan.actions as { agent: string; action: string }[]).map((a, i) => (
                      <li key={i}>
                        <span className="text-muted-foreground capitalize">{a.agent}: </span>
                        {a.action}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="panel p-5">
            <h2 className="text-base font-semibold">Resources</h2>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {(d?.resources ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-muted-foreground">{r.zone ?? "—"}</td>
                    <td className="py-2 text-right font-mono text-xs">
                      {r.available}/{r.quantity}
                    </td>
                    <td className="py-2 pl-3 text-right text-xs">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Responders</h2>
              {d?.isCoordinator && (
                <button
                  onClick={() => setShowAdd(true)}
                  className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Add Agent
                </button>
              )}
            </div>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {(d?.officers ?? []).map((o) => (
                  <tr key={o.id} className="border-b border-border/60">
                    <td className="py-2 font-medium">{o.username}</td>
                    <td className="py-2 font-mono text-xs">#{o.agent_id}</td>
                    <td className="py-2 text-muted-foreground capitalize">{o.role}</td>
                    <td className="py-2 text-right text-xs">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d?.isCoordinator && (
              <p className="mt-3 text-xs text-muted-foreground">
                Officer management is restricted to the coordinator.
              </p>
            )}
          </div>
        </section>
      </main>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 px-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await addOfficerFn({
                  data: {
                    username: String(form.get("username")),
                    agentId: String(form.get("agentId")),
                  },
                });
                setShowAdd(false);
                setNotice("Officer added.");
                await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
              } catch (err) {
                setNotice(err instanceof Error ? err.message : "Could not add officer.");
              }
            }}
            className="panel w-full max-w-sm p-6"
          >
            <h3 className="text-base font-semibold">Add Agent</h3>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5">
                <span className="label-cap">Username</span>
                <input name="username" required className="rounded-sm border border-input px-3 py-2 text-sm" />
              </label>
              <label className="grid gap-1.5">
                <span className="label-cap">Agent ID (4 digits)</span>
                <input
                  name="agentId"
                  required
                  pattern="[0-9]{4}"
                  maxLength={4}
                  className="rounded-sm border border-input px-3 py-2 text-sm font-mono"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-sm border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button className="rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                Add agent
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="panel p-4">
      <p className="label-cap">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      <p className="label-cap">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
