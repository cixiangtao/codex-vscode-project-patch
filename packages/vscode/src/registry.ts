import type { BundleRegistry } from "../../../src/core.js";

export const COMPATIBILITY_REGISTRY_URL =
  "https://raw.githubusercontent.com/cixiangtao/codex-vscode-project-patch/main/compatibility/bundles.json";

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_REQUEST_ATTEMPTS = 2;
const CACHE_KEY = "codexPatch.compatibilityRegistry";
const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_REGISTRY_ENTRIES = 512;
const MAX_HASHES_PER_VERSION = 8;
const VERSION_PATTERN = /^\d+(?:\.\d+)+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface RegistryStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

interface CachedRegistry {
  fetchedAt: number;
  registry: BundleRegistry;
  etag?: string;
}

export interface RegistryLoadResult {
  registry: BundleRegistry;
  source: "remote" | "cache" | "embedded";
  warning?: string;
}

interface CompatibilityRegistryClientOptions {
  embeddedRegistry: BundleRegistry;
  store: RegistryStore;
  fetcher?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  timeoutMs?: number;
  requestAttempts?: number;
  url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates compatibility data before it can authorize a bundle hash.
 *
 * The parser intentionally accepts only version keys and non-empty SHA-256
 * arrays. Structural bundle validation remains a separate mandatory gate.
 */
export function parseCompatibilityRegistry(value: unknown): BundleRegistry {
  if (!isRecord(value)) throw new Error("Compatibility registry must be a JSON object.");

  const registry: Record<string, readonly string[]> = {};
  const entries = Object.entries(value);
  if (entries.length > MAX_REGISTRY_ENTRIES) {
    throw new Error("Compatibility registry contains too many entries.");
  }
  for (const [version, hashes] of entries) {
    if (!VERSION_PATTERN.test(version)) {
      throw new Error(`Invalid Codex extension version in compatibility registry: ${version}`);
    }
    if (!Array.isArray(hashes) || hashes.length === 0 || hashes.length > MAX_HASHES_PER_VERSION) {
      throw new Error(`Compatibility entry ${version} must contain at least one SHA-256 hash.`);
    }
    const verifiedHashes = hashes.map((hash) => {
      if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) {
        throw new Error(`Compatibility entry ${version} contains an invalid SHA-256 hash.`);
      }
      return hash;
    });
    registry[version] = Object.freeze([...new Set(verifiedHashes)]);
  }

  if (Object.keys(registry).length === 0) {
    throw new Error("Compatibility registry cannot be empty.");
  }
  return Object.freeze(registry);
}

function readCachedRegistry(store: RegistryStore): CachedRegistry | undefined {
  const cached = store.get<unknown>(CACHE_KEY);
  if (!isRecord(cached) || typeof cached.fetchedAt !== "number") return undefined;
  try {
    const registry = parseCompatibilityRegistry(cached.registry);
    return {
      fetchedAt: cached.fetchedAt,
      registry,
      ...(typeof cached.etag === "string" ? { etag: cached.etag } : {}),
    };
  } catch {
    return undefined;
  }
}

/** Loads a validated compatibility registry with a short, persistent cache. */
export class CompatibilityRegistryClient {
  readonly #embeddedRegistry: BundleRegistry;
  readonly #store: RegistryStore;
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  readonly #timeoutMs: number;
  readonly #requestAttempts: number;
  readonly #url: string;

  constructor({
    embeddedRegistry,
    store,
    fetcher = fetch,
    now = Date.now,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    requestAttempts = DEFAULT_REQUEST_ATTEMPTS,
    url = COMPATIBILITY_REGISTRY_URL,
  }: CompatibilityRegistryClientOptions) {
    this.#embeddedRegistry = parseCompatibilityRegistry(embeddedRegistry);
    this.#store = store;
    this.#fetcher = fetcher;
    this.#now = now;
    this.#cacheTtlMs = cacheTtlMs;
    this.#timeoutMs = timeoutMs;
    this.#requestAttempts = Math.max(1, Math.floor(requestAttempts));
    this.#url = url;
  }

  async load(force = false): Promise<RegistryLoadResult> {
    const cached = readCachedRegistry(this.#store);
    const now = this.#now();
    if (!force && cached != null && now - cached.fetchedAt < this.#cacheTtlMs) {
      return { registry: cached.registry, source: "cache" };
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#requestAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const headers = new Headers({ Accept: "application/json" });
        if (cached?.etag != null) headers.set("If-None-Match", cached.etag);
        const response = await this.#fetcher(this.#url, {
          headers,
          signal: controller.signal,
        });
        if (response.status === 304 && cached != null) {
          const refreshed = { ...cached, fetchedAt: now };
          await this.#store.update(CACHE_KEY, refreshed);
          return { registry: refreshed.registry, source: "cache" };
        }
        if (!response.ok) {
          throw new Error(`Compatibility registry request failed with HTTP ${response.status}.`);
        }

        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > MAX_REGISTRY_BYTES) {
          throw new Error("Compatibility registry response is too large.");
        }
        const registry = parseCompatibilityRegistry(JSON.parse(body) as unknown);
        const etag = response.headers.get("etag");
        const nextCache: CachedRegistry = {
          fetchedAt: now,
          registry,
          ...(etag == null ? {} : { etag }),
        };
        await this.#store.update(CACHE_KEY, nextCache);
        return { registry, source: "remote" };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }

    const warning = `Could not refresh compatibility data after ${this.#requestAttempts} attempts: ${String(lastError)}`;
    if (cached != null) return { registry: cached.registry, source: "cache", warning };
    return { registry: this.#embeddedRegistry, source: "embedded", warning };
  }
}
