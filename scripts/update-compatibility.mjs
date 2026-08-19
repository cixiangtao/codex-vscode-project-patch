#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createWriteStream, openSync, closeSync } from "node:fs";
import { appendFile, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { inspectPatchStructure, patchBundle, sha256 } from "../dist/index.mjs";
import {
  MAC_TARGETS,
  renderCompatibilityTable,
  selectMacAssets,
  TABLE_END,
  TABLE_START,
  validateThreadListSchema,
} from "./compatibility-helpers.mjs";

const MARKETPLACE_ENDPOINT =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const MARKETPLACE_FLAGS = 403;
const EXTENSION_ID = "openai.chatgpt";
const REGISTRY_PATH = path.resolve("compatibility/bundles.json");
const DOCUMENTATION_PATH = path.resolve(".github/README.md");

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed (${result.status ?? "unknown"}): ${result.stderr?.trim() ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

async function queryMarketplace() {
  const response = await fetch(MARKETPLACE_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json;api-version=7.2-preview.1;excludeUrls=true",
      "Content-Type": "application/json",
      "User-Agent": "codex-vscode-project-patch/compatibility-check",
    },
    body: JSON.stringify({
      filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }],
      flags: MARKETPLACE_FLAGS,
    }),
  });
  if (!response.ok) fail(`Marketplace query failed with HTTP ${response.status}.`);
  return response.json();
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { "User-Agent": "codex-vscode-project-patch/compatibility-check" },
    redirect: "follow",
  });
  if (!response.ok || response.body == null) {
    fail(`VSIX download failed with HTTP ${response.status}.`);
  }
  await pipeline(response.body, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
}

function listArchive(archive) {
  return run("unzip", ["-Z1", archive])
    .split("\n")
    .filter((entry) => entry.length > 0);
}

function readArchiveEntry(archive, entry) {
  const result = spawnSync("unzip", ["-p", archive, entry], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`Could not read ${entry} from the VSIX: ${result.stderr.toString("utf8").trim()}`);
  }
  return result.stdout;
}

function extractArchiveEntry(archive, entry, destination) {
  const output = openSync(destination, "wx", 0o700);
  try {
    const result = spawnSync("unzip", ["-p", archive, entry], {
      stdio: ["ignore", output, "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      fail(`Could not extract ${entry} from the VSIX: ${result.stderr.toString("utf8").trim()}`);
    }
  } finally {
    closeSync(output);
  }
}

function requireUniqueEntry(entries, expected) {
  if (entries.filter((entry) => entry === expected).length !== 1) {
    fail(`VSIX must contain exactly one ${expected}.`);
  }
}

async function inspectVsix(archive, marketplaceVersion, target, temporaryDirectory) {
  const entries = listArchive(archive);
  requireUniqueEntry(entries, "extension/package.json");
  const manifest = JSON.parse(readArchiveEntry(archive, "extension/package.json").toString("utf8"));
  if (
    manifest.publisher !== "openai" ||
    manifest.name !== "chatgpt" ||
    manifest.version !== marketplaceVersion ||
    typeof manifest.main !== "string" ||
    !manifest.main.startsWith("./")
  ) {
    fail(`Unexpected ${target} extension manifest.`);
  }

  const bundleEntry = path.posix.normalize(`extension/${manifest.main.slice(2)}`);
  if (!bundleEntry.startsWith("extension/") || bundleEntry.includes("../")) {
    fail(`Unsafe extension entry path: ${manifest.main}`);
  }
  requireUniqueEntry(entries, bundleEntry);
  const bundle = readArchiveEntry(archive, bundleEntry);
  const source = bundle.toString("utf8");
  const structure = inspectPatchStructure(source);
  if (!structure.validClean) {
    fail(`${target} entry bundle no longer has one supported clean patch structure.`);
  }

  const patched = patchBundle(source);
  const patchedPath = path.join(temporaryDirectory, `${target}.patched.js`);
  await writeFile(patchedPath, patched, { flag: "wx", mode: 0o600 });
  run(process.execPath, ["--check", patchedPath]);
  return { entries, hash: sha256(bundle), manifest };
}

async function validateSchema(archive, inspection, target, temporaryDirectory) {
  const architectureDirectory = target === "darwin-arm64" ? "macos-aarch64" : "macos-x86_64";
  const binaryEntry = `extension/bin/${architectureDirectory}/codex`;
  requireUniqueEntry(inspection.entries, binaryEntry);
  const binaryPath = path.join(temporaryDirectory, `codex-${target}`);
  extractArchiveEntry(archive, binaryEntry, binaryPath);
  await chmod(binaryPath, 0o700);
  const schemaDirectory = path.join(temporaryDirectory, "schema");
  await mkdir(schemaDirectory);
  run(binaryPath, ["app-server", "generate-json-schema", "--out", schemaDirectory]);
  const schema = JSON.parse(
    await readFile(path.join(schemaDirectory, "v2", "ThreadListParams.json"), "utf8"),
  );
  validateThreadListSchema(schema);
}

async function updateSources(version, hashes) {
  const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  if (registry[version] != null) return false;
  const nextRegistry = { ...registry, [version]: [...new Set(hashes)].toSorted() };
  const documentation = await readFile(DOCUMENTATION_PATH, "utf8");
  const start = documentation.indexOf(TABLE_START);
  const end = documentation.indexOf(TABLE_END);
  if (start < 0 || end < start || documentation.indexOf(TABLE_START, start + 1) >= 0) {
    fail("Compatibility table markers are missing or ambiguous.");
  }
  const updatedDocumentation =
    documentation.slice(0, start) +
    renderCompatibilityTable(nextRegistry) +
    documentation.slice(end + TABLE_END.length);
  await writeFile(REGISTRY_PATH, `${JSON.stringify(nextRegistry, null, 2)}\n`);
  await writeFile(DOCUMENTATION_PATH, updatedDocumentation);
  return true;
}

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT != null) {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

async function main() {
  if (process.platform !== "darwin") {
    fail("Compatibility updates require a macOS runner for the bundled Codex schema check.");
  }
  const registry = JSON.parse(await readFile(REGISTRY_PATH, "utf8"));
  const selected = selectMacAssets(await queryMarketplace());
  await setOutput("extension-version", selected.version);

  if (registry[selected.version] != null) {
    await setOutput("changed", "false");
    process.stdout.write(`openai.chatgpt@${selected.version} is already supported.\n`);
    return;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-patch-update-"));
  try {
    const inspections = {};
    for (const target of MAC_TARGETS) {
      const archive = path.join(temporaryDirectory, `${target}.vsix`);
      process.stdout.write(`Downloading official ${target} VSIX for validation...\n`);
      await download(selected.assets[target], archive);
      inspections[target] = await inspectVsix(
        archive,
        selected.version,
        target,
        temporaryDirectory,
      );
    }

    const schemaTarget = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    await validateSchema(
      path.join(temporaryDirectory, `${schemaTarget}.vsix`),
      inspections[schemaTarget],
      schemaTarget,
      temporaryDirectory,
    );
    const changed = await updateSources(
      selected.version,
      MAC_TARGETS.map((target) => inspections[target].hash),
    );
    await setOutput("changed", String(changed));
    process.stdout.write(
      `Validated openai.chatgpt@${selected.version} for macOS ARM64/x64 and updated the allowlist.\n`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] == null ? "" : path.resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
