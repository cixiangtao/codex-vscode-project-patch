import { readFileSync } from "node:fs";

export const TOOL_NAME = "codex-vscode-project-patch";
export const TOOL_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
export const PATCH_ID = "workspace-thread-filter";
export const PATCH_REVISION = 1;
export const PATCH_MARKER = `codex-vscode-project-patch:${PATCH_ID}@${PATCH_REVISION}`;

export const ORIGINAL_REQUEST_ANCHOR =
  'case"mcp-request":{let{id:n,method:o,params:i}=r.request;this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(L1,String(n),o,i);';

export const PATCHED_REQUEST_ANCHOR =
  'case"mcp-request":{let{id:n,method:o,params:i}=r.request,s=Cb();o==="thread/list"&&s.length>0&&(i={...i,cwd:s});' +
  `/*${PATCH_MARKER}*/` +
  "this.pendingMcpRequests.set(String(n),e),this.codexMcpConnection.sendRequest(L1,String(n),o,i);";

export const WORKSPACE_HELPER_ANCHORS = [
  "function Cb(){",
  ".workspace.workspaceFolders?.map(",
  "return fr()?",
];

export const KNOWN_BUNDLES = Object.freeze({
  "26.810.41047": ["5669921cf77b0de7e49c8e6c6ac6283baa593ccf131bef7b2eac3e1b8eeaf859"],
  "26.810.52044": ["5669921cf77b0de7e49c8e6c6ac6283baa593ccf131bef7b2eac3e1b8eeaf859"],
});
