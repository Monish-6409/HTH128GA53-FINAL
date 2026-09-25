import test from "node:test";
import assert from "node:assert/strict";

import { ensureContentTypeHeader } from "./response-guard.ts";
import {
  assertCompatibleProvider,
  normalizeBaseUrl,
  normalizeModelCatalog,
  resolveProviderSelection,
} from "./ai-providers.server.ts";

test("normalizeModelCatalog preserves model metadata and removes empty ids", () => {
  const result = normalizeModelCatalog({
    data: [
      { id: "gpt-4o-mini", object: "model", created: 1720000000, owned_by: "openai" },
      { id: "", object: "model", created: 1720000001 },
      { id: "claude-3.5-sonnet", object: "model", owned_by: "anthropic" },
    ],
  });

  assert.deepEqual(result.map((model) => model.id), ["gpt-4o-mini", "claude-3.5-sonnet"]);
  assert.equal(result[0]?.owned_by, "openai");
  assert.equal(result[1]?.owned_by, "anthropic");
});

test("resolveProviderSelection prefers the active slot and model when provided", () => {
  const selected = resolveProviderSelection(
    [
      { slot: 1, active: false, default_model: "gpt-4o-mini" },
      { slot: 2, active: true, default_model: "claude-3.5-sonnet" },
      { slot: 3, active: false, default_model: "deepseek-r1" },
    ],
    { slot: 1, model: "grok-3" },
  );

  assert.deepEqual(selected, { slot: 2, model: "claude-3.5-sonnet" });
});

test("normalizeBaseUrl trims trailing slash so provider endpoints stay valid", () => {
  assert.equal(normalizeBaseUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1");
  assert.equal(normalizeBaseUrl("http://localhost:11434/v1///"), "http://localhost:11434/v1");
});

test("assertCompatibleProvider rejects an OpenRouter key on an OpenAI endpoint", () => {
  const result = assertCompatibleProvider("https://api.openai.com/v1", "sk-or-v1-demo-key", "OpenAI");

  assert.match(result ?? "", /OpenRouter/i);
});

test("assertCompatibleProvider accepts a valid OpenRouter config", () => {
  assert.equal(
    assertCompatibleProvider("https://openrouter.ai/api/v1", "sk-or-v1-demo-key", "OpenRouter"),
    null,
  );
});

test("ensureContentTypeHeader adds a content-type header when the Response is missing one", async () => {
  const response = await ensureContentTypeHeader(new Response("{}"));

  assert.equal(response.headers.get("content-type"), "text/plain;charset=UTF-8");
  assert.equal(await response.text(), "{}");
});
