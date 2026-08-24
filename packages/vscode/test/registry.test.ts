import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CompatibilityRegistryClient,
  parseCompatibilityRegistry,
  type RegistryStore,
} from "../src/registry.js";

const VERSION = "26.818.41705";
const HASH = "a".repeat(64);

class MemoryStore implements RegistryStore {
  readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

test("compatibility registry accepts only version-to-SHA-256 mappings", () => {
  const registry = parseCompatibilityRegistry({ [VERSION]: [HASH, HASH] });
  assert.deepEqual(registry, { [VERSION]: [HASH] });
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry[VERSION]), true);

  assert.throws(() => parseCompatibilityRegistry({ latest: [HASH] }), /Invalid Codex/);
  assert.throws(() => parseCompatibilityRegistry({ [VERSION]: ["short"] }), /invalid SHA-256/);
  assert.throws(() => parseCompatibilityRegistry({}), /cannot be empty/);
});

test("registry client refreshes once and reuses its fresh persistent cache", async () => {
  const store = new MemoryStore();
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ [VERSION]: [HASH] }), {
      status: 200,
      headers: { etag: '"registry-v1"', "content-type": "application/json" },
    });
  };
  const client = new CompatibilityRegistryClient({
    embeddedRegistry: { [VERSION]: [HASH] },
    store,
    fetcher,
    now: () => 1000,
  });

  const first = await client.load();
  const second = await client.load();
  assert.equal(first.source, "remote");
  assert.equal(second.source, "cache");
  assert.equal(requests, 1);
});

test("registry client fails closed to embedded data when refresh is unavailable", async () => {
  const store = new MemoryStore();
  const client = new CompatibilityRegistryClient({
    embeddedRegistry: { [VERSION]: [HASH] },
    store,
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  const result = await client.load(true);
  assert.equal(result.source, "embedded");
  assert.deepEqual(result.registry, { [VERSION]: [HASH] });
  assert.match(result.warning ?? "", /offline/);
});
