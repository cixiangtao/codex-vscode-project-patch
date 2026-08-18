export const MAC_TARGETS = ["darwin-arm64", "darwin-x64"];
export const TABLE_START = "<!-- compatibility-table:start -->";
export const TABLE_END = "<!-- compatibility-table:end -->";

function fail(message) {
  throw new Error(message);
}

function validatedAssetUri(value) {
  if (typeof value !== "string") fail("Marketplace asset URI is missing.");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "gallerycdn.vsassets.io" && !url.hostname.endsWith(".gallerycdn.vsassets.io"))
  ) {
    fail(`Marketplace returned an unexpected asset host: ${url.hostname}`);
  }
  return `${url.toString().replace(/\/$/, "")}/Microsoft.VisualStudio.Services.VSIXPackage`;
}

export function selectMacAssets(payload) {
  const extension = payload?.results?.[0]?.extensions?.find(
    (candidate) =>
      candidate?.publisher?.publisherName === "openai" && candidate?.extensionName === "chatgpt",
  );
  if (extension == null || !Array.isArray(extension.versions)) {
    fail("Marketplace response did not contain openai.chatgpt versions.");
  }

  const byVersion = new Map();
  for (const entry of extension.versions) {
    if (
      typeof entry?.version !== "string" ||
      !MAC_TARGETS.includes(entry?.targetPlatform) ||
      typeof entry?.lastUpdated !== "string"
    ) {
      continue;
    }
    const group = byVersion.get(entry.version) ?? new Map();
    group.set(entry.targetPlatform, entry);
    byVersion.set(entry.version, group);
  }

  const complete = [...byVersion.entries()]
    .filter(([, entries]) => MAC_TARGETS.every((target) => entries.has(target)))
    .map(([version, entries]) => ({
      version,
      updatedAt: Math.max(
        ...MAC_TARGETS.map((target) => Date.parse(entries.get(target).lastUpdated)),
      ),
      assets: Object.fromEntries(
        MAC_TARGETS.map((target) => [target, validatedAssetUri(entries.get(target).assetUri)]),
      ),
    }))
    .filter((candidate) => Number.isFinite(candidate.updatedAt))
    .toSorted((left, right) => right.updatedAt - left.updatedAt);

  if (complete.length === 0) fail("Marketplace has no matching macOS ARM64/x64 release pair.");
  return complete[0];
}

export function validateThreadListSchema(schema) {
  const filterVariants = schema?.definitions?.ThreadListCwdFilter?.anyOf;
  const cwdVariants = schema?.properties?.cwd?.anyOf;
  const hasString =
    Array.isArray(filterVariants) && filterVariants.some((entry) => entry?.type === "string");
  const hasStringArray =
    Array.isArray(filterVariants) &&
    filterVariants.some((entry) => entry?.type === "array" && entry?.items?.type === "string");
  const hasFilterReference =
    Array.isArray(cwdVariants) &&
    cwdVariants.some((entry) => entry?.$ref === "#/definitions/ThreadListCwdFilter");
  const hasNull = Array.isArray(cwdVariants) && cwdVariants.some((entry) => entry?.type === "null");
  const description = schema?.properties?.cwd?.description;
  if (
    schema?.title !== "ThreadListParams" ||
    !hasString ||
    !hasStringArray ||
    !hasFilterReference ||
    !hasNull ||
    typeof description !== "string" ||
    !description.includes("exactly matches")
  ) {
    fail("ThreadListParams.cwd no longer guarantees exact string/string-array matching.");
  }
}

function compareVersionsDescending(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function renderCompatibilityTable(registry) {
  const rows = Object.entries(registry)
    .toSorted(([left], [right]) => compareVersionsDescending(left, right))
    .flatMap(([version, hashes]) => hashes.map((hash) => `| \`${version}\` | \`${hash}\` |`));
  return [
    TABLE_START,
    "| Extension version | Clean `out/extension.js` SHA-256 |",
    "| ----------------- | ---------------------------------- |",
    ...rows,
    TABLE_END,
  ].join("\n");
}
