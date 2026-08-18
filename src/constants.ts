import { readFileSync } from "node:fs";

import bundleRegistry from "../compatibility/bundles.json" with { type: "json" };

export const TOOL_NAME = "codex-vscode-project-patch";
export const TOOL_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
export const PATCH_ID = "workspace-thread-filter";
export const PATCH_REVISION = 1;
export const PATCH_MARKER = `codex-vscode-project-patch:${PATCH_ID}@${PATCH_REVISION}`;
export const PATCH_CWD_VARIABLE = "__codexVscodeProjectPatchCwd";

const IDENTIFIER = String.raw`[A-Za-z_$][\w$]*`;

const REQUEST_PREFIX = String.raw`case"mcp-request":\{let\{id:(?<id>${IDENTIFIER}),method:(?<method>${IDENTIFIER}),params:(?<params>${IDENTIFIER})\}=(?<request>${IDENTIFIER})\.request;`;
const REQUEST_FORWARD = String.raw`this\.pendingMcpRequests\.set\(String\(\k<id>\),(?<origin>${IDENTIFIER})\),this\.codexMcpConnection\.sendRequest\((?<provider>${IDENTIFIER}),String\(\k<id>\),\k<method>,\k<params>\);`;

export const CLEAN_REQUEST_ANCHOR_SOURCE = `${REQUEST_PREFIX}${REQUEST_FORWARD}`;
export const PATCHED_REQUEST_ANCHOR_SOURCE =
  REQUEST_PREFIX +
  String.raw`let ${PATCH_CWD_VARIABLE}=(?<helper>${IDENTIFIER})\(\);\k<method>==="thread/list"&&${PATCH_CWD_VARIABLE}\.length>0&&\(\k<params>=\{\.\.\.\k<params>,cwd:${PATCH_CWD_VARIABLE}\}\);/\*${PATCH_MARKER}\*/` +
  REQUEST_FORWARD;

export const LEGACY_PATCHED_REQUEST_ANCHOR =
  'case"mcp-request":{let{id:n,method:o,params:i}=r.request,s=Cb();o==="thread/list"&&s.length>0&&(i={...i,cwd:s});' +
  `/*${PATCH_MARKER}*/` +
  "this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(L1,String(n),o,i);";

export const WORKSPACE_HELPER_SOURCE = String.raw`function (?<helper>${IDENTIFIER})\(\)\{let (?<folders>${IDENTIFIER})=(?<vscode>${IDENTIFIER})\.workspace\.workspaceFolders\?\.map\((?<folder>${IDENTIFIER})=>\k<folder>\.uri\.fsPath\)\?\?\[\];return (?<isWsl>${IDENTIFIER})\(\)\?\k<folders>\.map\((?<convert>${IDENTIFIER})\):\k<folders>\}`;

export const KNOWN_BUNDLES: Readonly<Record<string, readonly string[]>> =
  Object.freeze(bundleRegistry);
