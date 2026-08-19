import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createColors } from "picocolors";
import { test } from "vitest";

import {
  applyPatch,
  getStatus,
  inspectPatchStructure,
  patchBundle,
  PatchError,
  restorePatch,
  sha256,
} from "../src/core.js";
import {
  LEGACY_PATCHED_REQUEST_ANCHOR,
  PATCH_CWD_VARIABLE,
  PATCH_MARKER,
  TOOL_VERSION,
} from "../src/constants.js";
import { formatHuman, formatHumanError, parseArguments, resolveCommand } from "../src/cli.js";

const FIXTURE_VERSION = "99.1.2";
const noColors = createColors(false);
type ColorInput = string | number | null | undefined;
const semanticColors = {
  bold: (value: ColorInput) => String(value),
  dim: (value: ColorInput) => String(value),
  green: (value: ColorInput) => `<green>${value}</green>`,
  cyan: (value: ColorInput) => `<cyan>${value}</cyan>`,
  yellow: (value: ColorInput) => `<yellow>${value}</yellow>`,
  magenta: (value: ColorInput) => `<magenta>${value}</magenta>`,
  red: (value: ColorInput) => `<red>${value}</red>`,
};

test("CLI version matches package version", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(TOOL_VERSION, packageJson.version);
});

test("no subcommand is reserved for the default apply workflow", () => {
  const parsed = parseArguments([]);
  assert.equal(parsed.command, undefined);
  assert.equal(parsed.options.dryRun, false);
  assert.equal(resolveCommand(parsed.command), "apply");
});

test("commander parses global options around the command", () => {
  const parsed = parseArguments(["--editor", "auto", "status", "--json"]);
  assert.equal(parsed.command, "status");
  assert.equal(parsed.options.editor, "auto");
  assert.equal(parsed.options.json, true);
});

test("commander returns help without exiting the process", () => {
  const parsed = parseArguments(["--help"]);
  assert.equal(parsed.handled, true);
  assert.match(parsed.output, /npx -y codex-vscode-project-patch/);
});

test("commander converts unknown options to stable CLI errors", () => {
  assert.throws(
    () => parseArguments(["--wat"]),
    (error) => error instanceof PatchError && error.code === "UNKNOWN_OPTION",
  );
});

function cleanFixture() {
  return [
    '"use strict";',
    "switch(x){",
    'case"mcp-request":{let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(L1,String(n),o,i);',
    "break;}}",
    "function Cb(){let t=HRe.workspace.workspaceFolders?.map(r=>r.uri.fsPath)??[];return fr()?t.map(ar):t}",
  ].join("");
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-vscode-project-patch-test-"));
  const extensionDir = path.join(root, `openai.chatgpt-${FIXTURE_VERSION}-darwin-arm64`);
  const stateDir = path.join(root, "state");
  await mkdir(path.join(extensionDir, "out"), { recursive: true });
  await writeFile(
    path.join(extensionDir, "package.json"),
    JSON.stringify({
      name: "chatgpt",
      publisher: "openai",
      version: FIXTURE_VERSION,
      main: "./out/extension.js",
    }),
  );
  const source = cleanFixture();
  await writeFile(path.join(extensionDir, "out", "extension.js"), source);
  return {
    extensionDir,
    stateDir,
    source,
    registry: { [FIXTURE_VERSION]: [sha256(source)] },
  };
}

test("patchBundle injects cwd filtering exactly once", () => {
  const patched = patchBundle(cleanFixture());
  assert.match(patched, new RegExp(`o==="thread/list"&&${PATCH_CWD_VARIABLE}\\.length>0`));
  assert.match(patched, new RegExp(`cwd:${PATCH_CWD_VARIABLE}`));
  assert.match(patched, new RegExp(`${PATCH_CWD_VARIABLE}=Cb\\(\\)`));
  assert.equal(patched.includes(PATCH_MARKER), true);
  assert.equal(inspectPatchStructure(patched).validPatched, true);
});

test("patchBundle rejects ambiguous anchors", () => {
  const duplicate =
    'case"mcp-request":{let{id:a,method:b,params:c}=d.request;this.pendingMcpRequests.set(String(a),e),this.codexMcpConnection.sendRequest(F1,String(a),b,c);';
  assert.throws(
    () => patchBundle(`${cleanFixture()}${duplicate}`),
    (error) => error instanceof PatchError && error.code === "ANCHOR_MISMATCH",
  );
});

test("patchBundle follows minified identifier changes without weakening structure checks", () => {
  const source =
    '"use strict";switch(x){case"mcp-request":{let{id:n,method:o,params:i}=r.request;' +
    "this.pendingMcpRequests.set(String(n),e)," +
    "this.codexMcpConnection.sendRequest(z1,String(n),o,i);break;}}" +
    "function kb(){let t=hEe.workspace.workspaceFolders?.map(r=>r.uri.fsPath)??[];" +
    "return hr()?t.map(cr):t}";
  const patched = patchBundle(source);
  assert.match(patched, new RegExp(`${PATCH_CWD_VARIABLE}=kb\\(\\)`));
  assert.equal(inspectPatchStructure(patched).validPatched, true);
});

test("the current CLI still recognizes patches written by 0.2.1", () => {
  const legacyPatched = cleanFixture().replace(
    'case"mcp-request":{let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(L1,String(n),o,i);',
    LEGACY_PATCHED_REQUEST_ANCHOR,
  );
  const structure = inspectPatchStructure(legacyPatched);
  assert.equal(structure.validPatched, true);
  assert.equal(structure.patchedAnchorCount, 1);
});

test("status, apply, idempotent apply, and restore round trip", async () => {
  const fixture = await createFixture();
  const initial = await getStatus(fixture);
  assert.equal(initial.state, "clean");
  assert.equal(initial.patchable, true);

  const applied = await applyPatch(fixture);
  assert.ok(applied.backupPath);
  assert.equal(applied.changed, true);
  assert.equal(applied.status.state, "patched");
  assert.equal(
    inspectPatchStructure(await readFile(applied.status.bundlePath, "utf8")).validPatched,
    true,
  );
  assert.equal(sha256(await readFile(applied.backupPath)), initial.currentHash);

  const secondApply = await applyPatch(fixture);
  assert.equal(secondApply.changed, false);

  const restored = await restorePatch(fixture);
  assert.equal(restored.changed, true);
  assert.equal(restored.status.state, "restored");
  assert.equal(await readFile(restored.status.bundlePath, "utf8"), fixture.source);

  const secondRestore = await restorePatch(fixture);
  assert.equal(secondRestore.changed, false);
});

test("human apply output includes reload, restore, and backup guidance", async () => {
  const fixture = await createFixture();
  const applied = await applyPatch(fixture);
  assert.ok(applied.backupPath);
  const output = formatHuman("apply", applied, {
    platform: "darwin",
    colors: noColors,
  });
  assert.match(output, /Workspace task filter enabled/);
  assert.match(output, new RegExp(`Patch tool\\s+codex-vscode-project-patch@${TOOL_VERSION}`));
  assert.match(output, new RegExp(`Codex plugin\\s+openai\\.chatgpt@${FIXTURE_VERSION}`));
  assert.match(output, /reload required/i);
  assert.match(output, /Developer: Reload Window/);
  assert.match(output, /npx -y codex-vscode-project-patch restore/);
  assert.match(output, new RegExp(applied.backupPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const idempotent = await applyPatch(fixture);
  const secondOutput = formatHuman("apply", idempotent, {
    platform: "darwin",
    colors: noColors,
  });
  assert.match(secondOutput, /already enabled/);
  assert.match(secondOutput, /Developer: Reload Window/);
  assert.match(secondOutput, /codex-vscode-project-patch restore/);
});

test("human apply output gives each information section a distinct color", async () => {
  const fixture = await createFixture();
  const applied = await applyPatch(fixture);
  const output = formatHuman("apply", applied, {
    platform: "darwin",
    colors: semanticColors,
  });

  assert.match(output, /<cyan>Version information<\/cyan>/);
  assert.match(output, /<cyan>Codex plugin<\/cyan>/);
  assert.match(output, /<yellow>Next steps — reload required<\/yellow>/);
  assert.match(output, /<magenta>Restore the official file<\/magenta>/);
});

test("human restore and error output include the next safe command", async () => {
  const fixture = await createFixture();
  await applyPatch(fixture);
  const restored = await restorePatch(fixture);
  const restoreOutput = formatHuman("restore", restored, {
    platform: "darwin",
    colors: noColors,
  });
  assert.match(restoreOutput, /Official Codex extension file restored/);
  assert.match(
    restoreOutput,
    new RegExp(`Patch tool\\s+codex-vscode-project-patch@${TOOL_VERSION}`),
  );
  assert.match(restoreOutput, new RegExp(`Codex plugin\\s+openai\\.chatgpt@${FIXTURE_VERSION}`));
  assert.match(restoreOutput, /Developer: Reload Window/);
  assert.match(restoreOutput, /npx -y codex-vscode-project-patch$/m);

  const errorOutput = formatHumanError(
    { message: "Unsupported bundle", details: { version: FIXTURE_VERSION } },
    { colors: noColors },
  );
  assert.match(errorOutput, /Command could not be completed/);
  assert.match(errorOutput, new RegExp(`Patch tool\\s+codex-vscode-project-patch@${TOOL_VERSION}`));
  assert.match(errorOutput, new RegExp(`Codex plugin\\s+openai\\.chatgpt@${FIXTURE_VERSION}`));
  assert.match(errorOutput, /status --json/);
});

test("apply dry-run validates without creating state", async () => {
  const fixture = await createFixture();
  const result = await applyPatch({ ...fixture, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldChange, true);
  assert.equal(await readFile(result.status.bundlePath, "utf8"), fixture.source);
});

test("apply refuses unknown version and hash", async () => {
  const fixture = await createFixture();
  await assert.rejects(
    applyPatch({ ...fixture, registry: {} }),
    (error) => error instanceof PatchError && error.code === "UNSUPPORTED_BUNDLE",
  );
});

test("restore refuses a patched bundle modified after apply", async () => {
  const fixture = await createFixture();
  const applied = await applyPatch(fixture);
  await writeFile(
    applied.status.bundlePath,
    `${await readFile(applied.status.bundlePath, "utf8")} `,
  );
  await assert.rejects(
    restorePatch(fixture),
    (error) => error instanceof PatchError && error.code === "NOT_RESTORABLE",
  );
});
