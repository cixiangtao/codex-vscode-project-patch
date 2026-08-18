export {
  applyPatch,
  defaultStateDir,
  getStatus,
  inspectPatchStructure,
  patchBundle,
  PatchError,
  resolveExtension,
  restorePatch,
  sha256,
} from "./core.js";
export { KNOWN_BUNDLES } from "./constants.js";

export type {
  ApplyOptions,
  ApplyResult,
  BundleRegistry,
  Editor,
  PatchState,
  PatchStatus,
  PatchStructure,
  RestoreOptions,
  RestoreResult,
  StatusOptions,
} from "./core.js";
