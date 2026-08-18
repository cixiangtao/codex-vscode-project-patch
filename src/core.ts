import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, realpath, rename, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CLEAN_REQUEST_ANCHOR_SOURCE,
  KNOWN_BUNDLES,
  LEGACY_PATCHED_REQUEST_ANCHOR,
  PATCH_ID,
  PATCH_CWD_VARIABLE,
  PATCH_MARKER,
  PATCH_REVISION,
  PATCHED_REQUEST_ANCHOR_SOURCE,
  WORKSPACE_HELPER_SOURCE,
} from "./constants.js";

export type Editor = "vscode" | "cursor" | "auto";

export type PatchState =
  | "clean"
  | "patched"
  | "restored"
  | "patched-unmanaged"
  | "inconsistent"
  | "modified-or-unknown-hash"
  | "unsupported-version";

export type BundleRegistry = Readonly<Record<string, readonly string[]>>;

export interface PatchStructure {
  markerCount: number;
  originalAnchorCount: number;
  patchedAnchorCount: number;
  workspaceHelperPresent: boolean;
  validClean: boolean;
  validPatched: boolean;
}

interface ExtensionManifest {
  publisher?: unknown;
  name?: unknown;
  version?: unknown;
  main?: unknown;
}

interface ExtensionTarget {
  extensionDir: string;
  packagePath: string;
  version: string;
  main: string;
  bundlePath: string;
  relativeBundlePath: string;
}

interface StatePaths {
  root: string;
  installId: string;
  manifestPath: string;
}

interface StateManifest {
  schemaVersion: number;
  status: "active" | "restored";
  patchId: string;
  patchRevision: number;
  extensionDir: string;
  extensionVersion: string;
  bundleRelativePath: string;
  originalHash: string;
  patchedHash: string;
  backupPath: string;
  appliedAt: string;
  restoredAt?: string | undefined;
}

interface ResolveOptions {
  extensionDir?: string | undefined;
  editor?: Editor | undefined;
  preferPatched?: boolean | undefined;
}

export interface StatusOptions extends ResolveOptions {
  stateDir?: string | undefined;
  registry?: BundleRegistry | undefined;
}

export interface ApplyOptions extends StatusOptions {
  dryRun?: boolean | undefined;
  now?: (() => Date) | undefined;
}

export interface RestoreOptions extends StatusOptions {
  now?: (() => Date) | undefined;
}

export interface PatchStatus {
  state: PatchState;
  patchable: boolean;
  restorable: boolean;
  editor: Editor;
  extensionDir: string;
  version: string;
  entry: string;
  bundlePath: string;
  currentHash: string;
  versionSupported: boolean;
  cleanHashSupported: boolean;
  knownHashes: readonly string[];
  structure: PatchStructure;
  stateDir: string;
  manifestPath: string;
  backupPath: string | null;
}

export interface ApplyResult {
  changed: boolean;
  dryRun: boolean;
  status: PatchStatus;
  wouldChange?: boolean | undefined;
  originalHash?: string | undefined;
  patchedHash?: string | undefined;
  backupPath?: string | undefined;
}

export interface RestoreResult {
  changed: boolean;
  status: PatchStatus;
}

export class PatchError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details: unknown = undefined) {
    super(message);
    this.name = "PatchError";
    this.code = code;
    this.details = details;
  }
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function matches(source: string, pattern: string): RegExpMatchArray[] {
  return [...source.matchAll(new RegExp(pattern, "g"))];
}

export function inspectPatchStructure(source: string): PatchStructure {
  const markerCount = countOccurrences(source, PATCH_MARKER);
  const cleanAnchors = matches(source, CLEAN_REQUEST_ANCHOR_SOURCE);
  const currentPatchedAnchors = matches(source, PATCHED_REQUEST_ANCHOR_SOURCE);
  const legacyPatchedAnchorCount = countOccurrences(source, LEGACY_PATCHED_REQUEST_ANCHOR);
  const workspaceHelpers = matches(source, WORKSPACE_HELPER_SOURCE);
  const originalAnchorCount = cleanAnchors.length;
  const patchedAnchorCount = currentPatchedAnchors.length + legacyPatchedAnchorCount;
  const workspaceHelperPresent = workspaceHelpers.length === 1;
  const patchedHelperMatches =
    patchedAnchorCount === 1 &&
    workspaceHelperPresent &&
    ((currentPatchedAnchors.length === 1 &&
      currentPatchedAnchors[0]!.groups?.helper === workspaceHelpers[0]!.groups?.helper) ||
      (legacyPatchedAnchorCount === 1 && workspaceHelpers[0]!.groups?.helper === "Cb"));

  return {
    markerCount,
    originalAnchorCount,
    patchedAnchorCount,
    workspaceHelperPresent,
    validClean:
      markerCount === 0 &&
      originalAnchorCount === 1 &&
      patchedAnchorCount === 0 &&
      workspaceHelperPresent,
    validPatched:
      markerCount === 1 &&
      originalAnchorCount === 0 &&
      patchedAnchorCount === 1 &&
      workspaceHelperPresent &&
      patchedHelperMatches,
  };
}

export function patchBundle(source: string): string {
  const before = inspectPatchStructure(source);
  if (!before.validClean) {
    throw new PatchError(
      "ANCHOR_MISMATCH",
      "The bundle does not contain exactly one supported clean patch anchor.",
      before,
    );
  }

  if (source.includes(PATCH_CWD_VARIABLE)) {
    throw new PatchError(
      "PATCH_VARIABLE_COLLISION",
      "The bundle already contains the reserved patch variable.",
    );
  }
  const cleanAnchor = matches(source, CLEAN_REQUEST_ANCHOR_SOURCE)[0]!;
  const workspaceHelper = matches(source, WORKSPACE_HELPER_SOURCE)[0]!.groups?.helper;
  const method = cleanAnchor.groups?.method;
  const params = cleanAnchor.groups?.params;
  if (workspaceHelper == null || method == null || params == null) {
    throw new PatchError(
      "ANCHOR_MISMATCH",
      "The supported bundle anchors did not expose the expected identifiers.",
    );
  }
  const forwardOffset = cleanAnchor[0].indexOf("this.pendingMcpRequests");
  if (forwardOffset < 0 || cleanAnchor.index == null) {
    throw new PatchError("ANCHOR_MISMATCH", "The request bridge forwarder was not found.");
  }
  const injection =
    `let ${PATCH_CWD_VARIABLE}=${workspaceHelper}();` +
    `${method}==="thread/list"&&${PATCH_CWD_VARIABLE}.length>0&&` +
    `(${params}={...${params},cwd:${PATCH_CWD_VARIABLE}});` +
    `/*${PATCH_MARKER}*/`;
  const replacement = `${cleanAnchor[0].slice(0, forwardOffset)}${injection}${cleanAnchor[0].slice(forwardOffset)}`;
  const patched =
    source.slice(0, cleanAnchor.index) +
    replacement +
    source.slice(cleanAnchor.index + cleanAnchor[0].length);
  const after = inspectPatchStructure(patched);
  if (!after.validPatched) {
    throw new PatchError(
      "PATCH_VERIFICATION_FAILED",
      "The transformed bundle failed structural verification.",
      after,
    );
  }
  return patched;
}

function compareVersionsDescending(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part));
  const b = right.split(".").map((part) => Number(part));
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function extensionRoots(editor: Editor): string[] {
  const home = os.homedir();
  const vscode = [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".vscode-insiders", "extensions"),
  ];
  const cursor = [path.join(home, ".cursor", "extensions")];
  if (editor === "vscode") return vscode;
  if (editor === "cursor") return cursor;
  if (editor === "auto") return [...vscode, ...cursor];
  throw new PatchError("INVALID_EDITOR", `Unsupported editor: ${editor}`);
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") return null;
    throw new PatchError("INVALID_JSON", `Could not read JSON: ${file}`, {
      cause: String(error),
    });
  }
}

async function loadExtension(extensionDir: string): Promise<ExtensionTarget> {
  const packagePath = path.join(extensionDir, "package.json");
  const manifest = await readJson<ExtensionManifest>(packagePath);
  if (manifest == null) {
    throw new PatchError(
      "EXTENSION_NOT_FOUND",
      `No package.json found in extension directory: ${extensionDir}`,
    );
  }
  if (manifest.publisher !== "openai" || manifest.name !== "chatgpt") {
    throw new PatchError(
      "WRONG_EXTENSION",
      `Expected openai.chatgpt, found ${manifest.publisher ?? "?"}.${manifest.name ?? "?"}.`,
    );
  }
  if (typeof manifest.version !== "string" || typeof manifest.main !== "string") {
    throw new PatchError(
      "INVALID_EXTENSION_MANIFEST",
      "The extension manifest is missing version or main.",
    );
  }

  const resolvedDir = await realpath(extensionDir);
  const bundlePath = path.resolve(resolvedDir, manifest.main);
  const relativeBundlePath = path.relative(resolvedDir, bundlePath);
  if (
    relativeBundlePath.startsWith(`..${path.sep}`) ||
    relativeBundlePath === ".." ||
    path.isAbsolute(relativeBundlePath)
  ) {
    throw new PatchError(
      "UNSAFE_BUNDLE_PATH",
      `Extension entry resolves outside the extension directory: ${manifest.main}`,
    );
  }
  try {
    await stat(bundlePath);
  } catch (error) {
    throw new PatchError("BUNDLE_NOT_FOUND", `Extension entry not found: ${bundlePath}`, {
      cause: String(error),
    });
  }

  return {
    extensionDir: resolvedDir,
    packagePath,
    version: manifest.version,
    main: manifest.main,
    bundlePath,
    relativeBundlePath,
  };
}

async function discoverExtensions(editor: Editor): Promise<ExtensionTarget[]> {
  const candidates: ExtensionTarget[] = [];
  for (const root of extensionRoots(editor)) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (isFileSystemError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("openai.chatgpt-")) continue;
      try {
        candidates.push(await loadExtension(path.join(root, entry.name)));
      } catch {
        // Ignore stale or incomplete directories during discovery. Explicit paths still fail loudly.
      }
    }
  }
  return candidates.toSorted((left, right) =>
    compareVersionsDescending(left.version, right.version),
  );
}

export async function resolveExtension({
  extensionDir,
  editor = "vscode",
  preferPatched = false,
}: ResolveOptions = {}): Promise<ExtensionTarget> {
  if (extensionDir != null) return loadExtension(path.resolve(extensionDir));
  const candidates = await discoverExtensions(editor);
  if (candidates.length === 0) {
    throw new PatchError(
      "EXTENSION_NOT_FOUND",
      `No installed openai.chatgpt extension found for editor '${editor}'.`,
    );
  }
  if (preferPatched) {
    for (const candidate of candidates) {
      const source = await readFile(candidate.bundlePath, "utf8");
      if (source.includes(PATCH_MARKER)) return candidate;
    }
  }
  return candidates[0]!;
}

export function defaultStateDir(): string {
  return (
    process.env.CODEX_VSCODE_PROJECT_PATCH_HOME ??
    path.join(os.homedir(), ".codex-vscode-project-patch")
  );
}

function statePaths(target: ExtensionTarget, stateDir?: string): StatePaths {
  const installId = sha256(target.extensionDir).slice(0, 20);
  const root = path.resolve(stateDir ?? defaultStateDir());
  return {
    root,
    installId,
    manifestPath: path.join(root, "installs", `${installId}.json`),
  };
}

async function loadStateManifest(
  target: ExtensionTarget,
  stateDir?: string,
): Promise<{ paths: StatePaths; manifest: StateManifest | null }> {
  const paths = statePaths(target, stateDir);
  return { paths, manifest: await readJson<StateManifest>(paths.manifestPath) };
}

function compatibilityFor(version: string, registry: BundleRegistry): readonly string[] | null {
  const hashes = registry[version];
  return Array.isArray(hashes) ? hashes : null;
}

export async function getStatus({
  extensionDir,
  editor = "vscode",
  stateDir,
  preferPatched = false,
  registry = KNOWN_BUNDLES,
}: StatusOptions = {}): Promise<PatchStatus> {
  const target = await resolveExtension({ extensionDir, editor, preferPatched });
  const bytes = await readFile(target.bundlePath);
  const source = bytes.toString("utf8");
  const currentHash = sha256(bytes);
  const structure = inspectPatchStructure(source);
  const knownHashes = compatibilityFor(target.version, registry);
  const versionSupported = knownHashes != null;
  const cleanHashSupported = knownHashes?.includes(currentHash) ?? false;
  const { paths, manifest } = await loadStateManifest(target, stateDir);

  let state: PatchState;
  let patchable = false;
  let restorable = false;
  if (structure.validPatched) {
    const managed =
      manifest?.status === "active" &&
      manifest.extensionDir === target.extensionDir &&
      manifest.patchedHash === currentHash &&
      manifest.patchId === PATCH_ID &&
      manifest.patchRevision === PATCH_REVISION;
    state = managed ? "patched" : "patched-unmanaged";
    restorable = managed;
  } else if (
    manifest?.originalHash === currentHash &&
    manifest.extensionDir === target.extensionDir &&
    !structure.markerCount
  ) {
    state = "restored";
    patchable = cleanHashSupported && structure.validClean;
  } else if (cleanHashSupported && structure.validClean) {
    state = "clean";
    patchable = true;
  } else if (manifest?.status === "active") {
    state = "inconsistent";
  } else if (versionSupported) {
    state = "modified-or-unknown-hash";
  } else {
    state = "unsupported-version";
  }

  return {
    state,
    patchable,
    restorable,
    editor,
    extensionDir: target.extensionDir,
    version: target.version,
    entry: target.relativeBundlePath,
    bundlePath: target.bundlePath,
    currentHash,
    versionSupported,
    cleanHashSupported,
    knownHashes: knownHashes ?? [],
    structure,
    stateDir: paths.root,
    manifestPath: paths.manifestPath,
    backupPath: manifest?.backupPath ?? null,
  };
}

async function writeAtomic(file: string, data: string | Uint8Array, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  const handle = await open(temporary, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, mode);
  await rename(temporary, file);
}

function assertJavaScriptSyntax(bundlePath: string): void {
  const result = spawnSync(process.execPath, ["--check", bundlePath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new PatchError(
      "SYNTAX_CHECK_FAILED",
      `Node syntax validation failed for ${bundlePath}.`,
      { stderr: result.stderr?.trim() },
    );
  }
}

async function ensureBackup(
  backupPath: string,
  originalBytes: Uint8Array,
  originalHash: string,
): Promise<void> {
  try {
    const existing = await readFile(backupPath);
    const existingHash = sha256(existing);
    if (existingHash !== originalHash) {
      throw new PatchError(
        "BACKUP_HASH_MISMATCH",
        `Existing backup has an unexpected hash: ${backupPath}`,
        { expected: originalHash, actual: existingHash },
      );
    }
    return;
  } catch (error) {
    if (!isFileSystemError(error) || error.code !== "ENOENT") throw error;
  }
  await writeAtomic(backupPath, originalBytes, 0o600);
  const writtenHash = sha256(await readFile(backupPath));
  if (writtenHash !== originalHash) {
    throw new PatchError("BACKUP_WRITE_FAILED", "Backup verification failed.", {
      expected: originalHash,
      actual: writtenHash,
    });
  }
}

export async function applyPatch({
  extensionDir,
  editor = "vscode",
  stateDir,
  dryRun = false,
  registry = KNOWN_BUNDLES,
  now = () => new Date(),
}: ApplyOptions = {}): Promise<ApplyResult> {
  const status = await getStatus({ extensionDir, editor, stateDir, registry });
  if (status.state === "patched") {
    return { changed: false, dryRun, status };
  }
  if (!status.patchable) {
    throw new PatchError(
      "UNSUPPORTED_BUNDLE",
      `Refusing to patch extension ${status.version} in state '${status.state}'.`,
      {
        version: status.version,
        hash: status.currentHash,
        structure: status.structure,
      },
    );
  }

  const originalBytes = await readFile(status.bundlePath);
  const originalSource = originalBytes.toString("utf8");
  const patchedSource = patchBundle(originalSource);
  const patchedBytes = Buffer.from(patchedSource, "utf8");
  const patchedHash = sha256(patchedBytes);
  if (dryRun) {
    return {
      changed: false,
      dryRun: true,
      wouldChange: true,
      originalHash: status.currentHash,
      patchedHash,
      status,
    };
  }

  const targetStat = await stat(status.bundlePath);
  const backupPath = path.join(status.stateDir, "backups", status.currentHash, "extension.js");
  await ensureBackup(backupPath, originalBytes, status.currentHash);

  let bundleChanged = false;
  try {
    await writeAtomic(status.bundlePath, patchedBytes, targetStat.mode & 0o777);
    bundleChanged = true;
    const written = await readFile(status.bundlePath);
    const writtenHash = sha256(written);
    const writtenStructure = inspectPatchStructure(written.toString("utf8"));
    if (writtenHash !== patchedHash || !writtenStructure.validPatched) {
      throw new PatchError(
        "PATCH_VERIFICATION_FAILED",
        "The on-disk patched bundle did not match the verified transformation.",
        { expectedHash: patchedHash, actualHash: writtenHash, writtenStructure },
      );
    }
    assertJavaScriptSyntax(status.bundlePath);

    const manifest: StateManifest = {
      schemaVersion: 1,
      status: "active",
      patchId: PATCH_ID,
      patchRevision: PATCH_REVISION,
      extensionDir: status.extensionDir,
      extensionVersion: status.version,
      bundleRelativePath: status.entry,
      originalHash: status.currentHash,
      patchedHash,
      backupPath,
      appliedAt: now().toISOString(),
    };
    await writeAtomic(status.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  } catch (error) {
    if (bundleChanged) {
      try {
        await writeAtomic(status.bundlePath, originalBytes, targetStat.mode & 0o777);
      } catch (rollbackError) {
        throw new PatchError(
          "ROLLBACK_FAILED",
          "Patch failed and the automatic rollback also failed. Restore from the backup path in details.",
          { backupPath, cause: String(error), rollbackCause: String(rollbackError) },
        );
      }
    }
    throw error;
  }

  const finalStatus = await getStatus({ extensionDir: status.extensionDir, stateDir, registry });
  if (finalStatus.state !== "patched") {
    throw new PatchError(
      "PATCH_VERIFICATION_FAILED",
      `Expected final state 'patched', got '${finalStatus.state}'.`,
      finalStatus,
    );
  }
  return { changed: true, dryRun: false, backupPath, status: finalStatus };
}

export async function restorePatch({
  extensionDir,
  editor = "vscode",
  stateDir,
  registry = KNOWN_BUNDLES,
  now = () => new Date(),
}: RestoreOptions = {}): Promise<RestoreResult> {
  const status = await getStatus({
    extensionDir,
    editor,
    stateDir,
    preferPatched: extensionDir == null,
    registry,
  });
  if (status.state === "restored" || status.state === "clean") {
    return { changed: false, status };
  }
  if (!status.restorable) {
    throw new PatchError(
      "NOT_RESTORABLE",
      `Refusing to restore extension in state '${status.state}'.`,
      { bundlePath: status.bundlePath, hash: status.currentHash },
    );
  }

  const { manifest } = await loadStateManifest(
    await resolveExtension({ extensionDir: status.extensionDir }),
    stateDir,
  );
  if (manifest == null) {
    throw new PatchError(
      "STATE_MANIFEST_MISSING",
      "The managed patch manifest is missing and restore cannot continue safely.",
    );
  }
  const backupBytes = await readFile(manifest.backupPath);
  const backupHash = sha256(backupBytes);
  if (backupHash !== manifest.originalHash) {
    throw new PatchError("BACKUP_HASH_MISMATCH", "Backup verification failed.", {
      expected: manifest.originalHash,
      actual: backupHash,
      backupPath: manifest.backupPath,
    });
  }

  const targetStat = await stat(status.bundlePath);
  await writeAtomic(status.bundlePath, backupBytes, targetStat.mode & 0o777);
  const restoredHash = sha256(await readFile(status.bundlePath));
  if (restoredHash !== manifest.originalHash) {
    throw new PatchError("RESTORE_VERIFICATION_FAILED", "Restored bundle hash mismatch.", {
      expected: manifest.originalHash,
      actual: restoredHash,
    });
  }
  assertJavaScriptSyntax(status.bundlePath);

  const restoredManifest = {
    ...manifest,
    status: "restored",
    restoredAt: now().toISOString(),
  };
  await writeAtomic(status.manifestPath, `${JSON.stringify(restoredManifest, null, 2)}\n`, 0o600);

  const finalStatus = await getStatus({ extensionDir: status.extensionDir, stateDir, registry });
  if (finalStatus.state !== "restored") {
    throw new PatchError(
      "RESTORE_VERIFICATION_FAILED",
      `Expected final state 'restored', got '${finalStatus.state}'.`,
      finalStatus,
    );
  }
  return { changed: true, status: finalStatus };
}
