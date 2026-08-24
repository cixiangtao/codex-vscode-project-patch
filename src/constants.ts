import { readFileSync } from "node:fs";

export {
  CLEAN_REQUEST_ANCHOR_SOURCE,
  KNOWN_BUNDLES,
  LEGACY_PATCHED_REQUEST_ANCHOR,
  PATCH_CWD_VARIABLE,
  PATCH_ID,
  PATCH_MARKER,
  PATCH_REVISION,
  PATCHED_REQUEST_ANCHOR_SOURCE,
  WORKSPACE_HELPER_SOURCE,
} from "./patch-constants.js";

export const TOOL_NAME = "codex-vscode-project-patch";
export const TOOL_VERSION = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
