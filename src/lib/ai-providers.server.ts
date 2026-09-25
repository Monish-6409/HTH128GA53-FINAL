/**
 * Provider adapter system for the three configurable AI provider slots.
 *
 * Nothing here is provider-specific: each slot is described entirely by
 * environment variables, so OpenRouter, Groq, Gemini (OpenAI-compatible
 * endpoint), Together, Azure, a self-hosted gateway, etc. all work.
 *
 *   AI_PROVIDER_{n}_NAME      display name, e.g. "OpenRouter"
 *   AI_PROVIDER_{n}_BASE_URL  OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1
 *   AI_PROVIDER_{n}_API_KEY   secret API key (server-side only, never sent to the browser)
 *   AI_PROVIDER_{n}_MODEL     optional default model id
 *
 * API keys never leave the server.
 */

export type ProviderSlot = 1 | 2 | 3;

export interface SlotConfig {
  slot: ProviderSlot;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string | null;
  configured: boolean;
  active?: boolean;
}

export interface ProviderModelDetail {
  id: string;
  object: string;
  created: number | null;
  owned_by: string | null;
  permission: string | null;
  description: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  pricing: Record<string, string> | null;
}

interface RawModel {
  id?: unknown;
  object?: unknown;
  created?: unknown;
  owned_by?: unknown;
  permission?: unknown;
  description?: unknown;
  context_window?: unknown;
  max_output_tokens?: unknown;
  pricing?: unknown;
}

export interface ProviderSettingsRow {
  slot: number;
  active?: boolean | null;
  name?: string | null;
  base_url?: string | null;
  api_key?: string | null;
  default_model?: string | null;
  model_list?: unknown;
}

export const SLOTS: ProviderSlot[] = [1, 2, 3];

export function normalizeBaseUrl(value: string): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

export function inferProviderKind(baseUrl: string, fallbackName?: string): "openrouter" | "openai" | "openai-compatible" {
  const normalizedUrl = normalizeBaseUrl(baseUrl ?? "").toLowerCase();
  const normalizedName = (fallbackName ?? "").toLowerCase();

  if (normalizedUrl.includes("openrouter.ai") || normalizedName.includes("openrouter")) {
    return "openrouter";
  }

  if (normalizedUrl.includes("api.openai.com") || normalizedName.includes("openai")) {
    return "openai";
  }

  return "openai-compatible";
}

export function assertCompatibleProvider(baseUrl: string, apiKey: string, fallbackName?: string): string | null {
  const normalizedUrl = normalizeBaseUrl(baseUrl ?? "").toLowerCase();
  const nextKey = String(apiKey ?? "").trim();
  const providerKind = inferProviderKind(baseUrl, fallbackName);
  const looksLikeOpenRouterKey = nextKey.startsWith("sk-or-") || nextKey.startsWith("or-");

  if (providerKind === "openai" && looksLikeOpenRouterKey) {
    return "This OpenRouter key is configured for the OpenAI endpoint. Set the provider base URL to https://openrouter.ai/api/v1 or provide a valid OpenAI key.";
  }

  if (providerKind === "openrouter" && normalizedUrl.includes("api.openai.com")) {
    return "OpenRouter requires the OpenRouter base URL: https://openrouter.ai/api/v1";
  }

  return null;
}

export function getFriendlyAiError(status: number, providerLabel?: string): string {
  const label = providerLabel || "AI provider";

  switch (status) {
    case 401:
      return "AI analysis is temporarily unavailable because the AI provider authentication failed.";
    case 402:
      return "AI analysis is temporarily unavailable because the AI provider has insufficient credits.";
    case 429:
      return "AI analysis is temporarily unavailable because the AI provider rate limit was reached.";
    default:
      return `${label} is temporarily unavailable. Please try again later.`;
  }
}

export function readSlot(slot: ProviderSlot): SlotConfig {
  const name = process.env[`AI_PROVIDER_${slot}_NAME`] ?? "";
  const baseUrl = normalizeBaseUrl(process.env[`AI_PROVIDER_${slot}_BASE_URL`] ?? "");
  const apiKey = process.env[`AI_PROVIDER_${slot}_API_KEY`] ?? "";
  const defaultModel = process.env[`AI_PROVIDER_${slot}_MODEL`] ?? null;
  return {
    slot,
    name: name || `Provider slot ${slot}`,
    baseUrl,
    apiKey,
    defaultModel,
    configured: Boolean(baseUrl && apiKey),
  };
}

export function readAllSlots(): SlotConfig[] {
  return SLOTS.map(readSlot);
}

/** Normalizes an OpenAI-compatible /models payload into a predictable list of models. */
export function normalizeModelCatalog(payload: unknown): ProviderModelDetail[] {
  const data = Array.isArray((payload as { data?: unknown[] } | undefined)?.data)
    ? ((payload as { data?: unknown[] }).data ?? [])
    : [];

  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const model = entry as RawModel;
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return [];

    let pricing: Record<string, string> | null = null;
    if (model.pricing && typeof model.pricing === "object") {
      pricing = Object.fromEntries(
        Object.entries(model.pricing as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    }

    return [
      {
        id,
        object: typeof model.object === "string" ? model.object : "model",
        created: typeof model.created === "number" ? model.created : null,
        owned_by: typeof model.owned_by === "string" ? model.owned_by : null,
        permission: model.permission == null ? null : JSON.stringify(model.permission),
        description:
          typeof model.description === "string"
            ? model.description
            : typeof model.description === "number"
              ? String(model.description)
              : null,
        context_window: typeof model.context_window === "number" ? model.context_window : null,
        max_output_tokens:
          typeof model.max_output_tokens === "number" ? model.max_output_tokens : null,
        pricing,
      },
    ];
  });
}

export function resolveProviderSelection(
  settings: Array<{ slot: number; active?: boolean | null; default_model?: string | null }>,
  override?: { slot?: number; model?: string | null },
): { slot: number; model: string } | null {
  const active = settings.find((s) => s.active);
  if (active) {
    return {
      slot: active.slot,
      model: active.default_model ?? override?.model ?? "",
    };
  }

  if (override && typeof override.slot === "number") {
    return {
      slot: override.slot,
      model: override.model ?? "",
    };
  }

  return null;
}

export async function discoverModels(cfg: SlotConfig): Promise<string[]> {
  if (!cfg.configured) return cfg.defaultModel ? [cfg.defaultModel] : [];
  try {
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) return cfg.defaultModel ? [cfg.defaultModel] : [];
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const ids = normalizeModelCatalog(json).map((m) => m.id);
    return ids.length ? ids.sort() : cfg.defaultModel ? [cfg.defaultModel] : [];
  } catch {
    return cfg.defaultModel ? [cfg.defaultModel] : [];
  }
}

export async function discoverModelDetails(cfg: SlotConfig): Promise<ProviderModelDetail[]> {
  if (!cfg.configured) return [];
  try {
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) return cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [];
    const json = (await res.json()) as unknown;
    const details = normalizeModelCatalog(json);
    return details.length ? details : cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [];
  } catch {
    return cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [];
  }
}

export async function validateProviderConnection(cfg: SlotConfig): Promise<{
  ok: boolean;
  baseUrl: string;
  name: string;
  models: ProviderModelDetail[];
  error?: string;
}> {
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { ok: false, baseUrl: cfg.baseUrl, name: cfg.name, models: [], error: "Missing base URL or API key." };
  }

  const mismatch = assertCompatibleProvider(cfg.baseUrl, cfg.apiKey, cfg.name);
  if (mismatch) {
    return {
      ok: false,
      baseUrl: cfg.baseUrl,
      name: cfg.name,
      models: cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [],
      error: mismatch,
    };
  }

  try {
    const baseUrl = normalizeBaseUrl(cfg.baseUrl);
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const status = res.status;
      return {
        ok: false,
        baseUrl: cfg.baseUrl,
        name: cfg.name,
        models: cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [],
        error: getFriendlyAiError(status, cfg.name),
      };
    }

    const json = (await res.json()) as unknown;
    const models = normalizeModelCatalog(json);
    return {
      ok: true,
      baseUrl: cfg.baseUrl,
      name: cfg.name,
      models: models.length ? models : cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [],
    };
  } catch (error) {
    return {
      ok: false,
      baseUrl: cfg.baseUrl,
      name: cfg.name,
      models: cfg.defaultModel ? [fallbackModel(cfg.defaultModel)] : [],
      error: error instanceof Error ? error.message : "Could not connect to provider.",
    };
  }
}

/** Single chat completion against an OpenAI-compatible endpoint. */
export async function completeChat(
  cfg: SlotConfig,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (!cfg.configured) {
    throw new Error(
      `AI provider slot ${cfg.slot} is not configured. Add its provider name, base URL and API key.`,
    );
  }

  const mismatch = assertCompatibleProvider(cfg.baseUrl, cfg.apiKey, cfg.name);
  if (mismatch) {
    throw new Error(mismatch);
  }

  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const status = res.status;
    throw new Error(getFriendlyAiError(status, cfg.name));
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

function fallbackModel(id: string): ProviderModelDetail {
  return {
    id,
    object: "model",
    created: null,
    owned_by: null,
    permission: null,
    description: null,
    context_window: null,
    max_output_tokens: null,
    pricing: null,
  };
}
