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
}

export const SLOTS: ProviderSlot[] = [1, 2, 3];

export function readSlot(slot: ProviderSlot): SlotConfig {
  const name = process.env[`AI_PROVIDER_${slot}_NAME`] ?? "";
  const baseUrl = (process.env[`AI_PROVIDER_${slot}_BASE_URL`] ?? "").replace(/\/+$/, "");
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

/** Model discovery — used when the provider exposes an OpenAI-style /models list. */
export async function discoverModels(cfg: SlotConfig): Promise<string[]> {
  if (!cfg.configured) return [];
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    });
    if (!res.ok) return cfg.defaultModel ? [cfg.defaultModel] : [];
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    return ids.length ? ids.sort() : cfg.defaultModel ? [cfg.defaultModel] : [];
  } catch {
    return cfg.defaultModel ? [cfg.defaultModel] : [];
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
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
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
    const body = await res.text();
    throw new Error(`${cfg.name} request failed [${res.status}]: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}
