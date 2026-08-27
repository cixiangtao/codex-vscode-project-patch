import assert from "node:assert/strict";
import { test } from "vitest";

import {
  renderCompatibilityTable,
  selectMacAssets,
  validateThreadListSchema,
} from "../scripts/compatibility-helpers.mjs";

function marketplaceVersion(
  version,
  targetPlatform,
  lastUpdated,
  host = "openai.gallerycdn.vsassets.io",
  preRelease = false,
) {
  return {
    version,
    targetPlatform,
    lastUpdated,
    assetUri: `https://${host}/extensions/openai/chatgpt/${version}/asset`,
    properties: [
      {
        key: "Microsoft.VisualStudio.Code.PreRelease",
        value: String(preRelease),
      },
    ],
  };
}

function marketplacePayload(versions) {
  return {
    results: [
      {
        extensions: [
          {
            publisher: { publisherName: "openai" },
            extensionName: "chatgpt",
            versions,
          },
        ],
      },
    ],
  };
}

test("selectMacAssets chooses the newest complete macOS release pair", () => {
  const selected = selectMacAssets(
    marketplacePayload([
      marketplaceVersion("2.0.0", "darwin-arm64", "2026-08-18T01:00:00Z"),
      marketplaceVersion("1.0.0", "darwin-arm64", "2026-08-17T01:00:00Z"),
      marketplaceVersion("1.0.0", "darwin-x64", "2026-08-17T01:00:00Z"),
      marketplaceVersion("2.0.0", "darwin-x64", "2026-08-18T01:00:01Z"),
    ]),
  );
  assert.equal(selected.version, "2.0.0");
  assert.match(selected.assets["darwin-arm64"], /Microsoft\.VisualStudio\.Services\.VSIXPackage$/);
});

test("selectMacAssets prefers the newest stable pair over a newer pre-release pair", () => {
  const selected = selectMacAssets(
    marketplacePayload([
      marketplaceVersion("26.5820.71523", "darwin-arm64", "2026-08-27T01:50:10Z", undefined, true),
      marketplaceVersion("26.5820.71523", "darwin-x64", "2026-08-27T01:48:39Z", undefined, true),
      marketplaceVersion("26.820.71523", "darwin-arm64", "2026-08-27T01:46:12Z"),
      marketplaceVersion("26.820.71523", "darwin-x64", "2026-08-27T01:45:39Z"),
    ]),
  );
  assert.equal(selected.version, "26.820.71523");
  assert.equal(selected.preRelease, false);
});

test("selectMacAssets falls back to a pre-release pair when no stable pair exists", () => {
  const selected = selectMacAssets(
    marketplacePayload([
      marketplaceVersion("26.5820.71523", "darwin-arm64", "2026-08-27T01:50:10Z", undefined, true),
      marketplaceVersion("26.5820.71523", "darwin-x64", "2026-08-27T01:48:39Z", undefined, true),
    ]),
  );
  assert.equal(selected.version, "26.5820.71523");
  assert.equal(selected.preRelease, true);
});

test("selectMacAssets refuses non-Marketplace download hosts", () => {
  assert.throws(
    () =>
      selectMacAssets(
        marketplacePayload([
          marketplaceVersion("2.0.0", "darwin-arm64", "2026-08-18T01:00:00Z", "example.com"),
          marketplaceVersion("2.0.0", "darwin-x64", "2026-08-18T01:00:01Z"),
        ]),
      ),
    /unexpected asset host/,
  );
});

test("validateThreadListSchema requires exact string and string-array cwd matching", () => {
  const schema = {
    title: "ThreadListParams",
    definitions: {
      ThreadListCwdFilter: {
        anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      },
    },
    properties: {
      cwd: {
        anyOf: [{ $ref: "#/definitions/ThreadListCwdFilter" }, { type: "null" }],
        description: "Only threads whose cwd exactly matches one path are returned.",
      },
    },
  };
  assert.doesNotThrow(() => validateThreadListSchema(schema));
  assert.throws(
    () =>
      validateThreadListSchema({
        ...schema,
        definitions: { ThreadListCwdFilter: { anyOf: [{ type: "string" }] } },
      }),
    /no longer guarantees/,
  );
});

test("renderCompatibilityTable emits deterministic newest-first rows", () => {
  const table = renderCompatibilityTable({
    "1.2.0": ["b"],
    "2.0.0": ["c", "a"],
  });
  assert.ok(table.indexOf("`2.0.0` | `c`") < table.indexOf("`1.2.0` | `b`"));
  assert.match(table, /compatibility-table:start/);
  assert.match(table, /compatibility-table:end/);
});
