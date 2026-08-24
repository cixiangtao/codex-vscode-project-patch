import assert from "node:assert/strict";
import { test } from "vitest";

import type { ApplyResult, BundleRegistry, PatchStatus } from "../../../src/core.js";
import {
  PatchGuardian,
  type GuardianOutcome,
  type GuardianServices,
  type RepairDecision,
  type RepairMode,
} from "../src/guardian.js";

const VERSION = "26.818.41705";
const HASH = "a".repeat(64);
const REGISTRY: BundleRegistry = { [VERSION]: [HASH] };

function status(overrides: Partial<PatchStatus> = {}): PatchStatus {
  return {
    state: "clean",
    patchable: true,
    restorable: false,
    editor: "vscode",
    extensionDir: "/extensions/openai.chatgpt-test",
    version: VERSION,
    entry: "out/extension.js",
    bundlePath: "/extensions/openai.chatgpt-test/out/extension.js",
    currentHash: HASH,
    versionSupported: true,
    cleanHashSupported: true,
    knownHashes: [HASH],
    structure: {
      markerCount: 0,
      originalAnchorCount: 1,
      patchedAnchorCount: 0,
      workspaceHelperPresent: true,
      validClean: true,
      validPatched: false,
    },
    stateDir: "/state",
    manifestPath: "/state/install.json",
    backupPath: null,
    ...overrides,
  };
}

interface ServiceHarness {
  services: GuardianServices;
  outcomes: GuardianOutcome[];
  getApplyCount(): number;
  getAutoEnabled(): boolean;
}

function serviceHarness({
  currentStatus = status(),
  mode = "auto",
  decision = "repair",
}: {
  currentStatus?: PatchStatus;
  mode?: RepairMode;
  decision?: RepairDecision;
} = {}): ServiceHarness {
  const outcomes: GuardianOutcome[] = [];
  let applyCount = 0;
  let autoEnabled = false;
  const patchedStatus = status({
    ...currentStatus,
    state: "patched",
    patchable: false,
    restorable: true,
    structure: {
      ...currentStatus.structure,
      markerCount: 1,
      originalAnchorCount: 0,
      patchedAnchorCount: 1,
      validClean: false,
      validPatched: true,
    },
  });
  return {
    outcomes,
    getApplyCount: () => applyCount,
    getAutoEnabled: () => autoEnabled,
    services: {
      loadRegistry: async () => ({ registry: REGISTRY, source: "remote" }),
      getStatus: async () => currentStatus,
      apply: async (): Promise<ApplyResult> => {
        applyCount += 1;
        return { changed: true, dryRun: false, status: patchedStatus };
      },
      getRepairMode: () => mode,
      requestRepair: async () => decision,
      enableAutomaticRepair: async () => {
        autoEnabled = true;
      },
      onOutcome: (outcome) => outcomes.push(outcome),
      onRepaired: async () => undefined,
      onError: () => undefined,
    },
  };
}

test("automatic mode repairs a compatible clean extension", async () => {
  const harness = serviceHarness();
  const guardian = new PatchGuardian(harness.services);
  const outcome = await guardian.check({ reason: "extension-change" });

  assert.equal(outcome.kind, "repaired");
  assert.equal(harness.getApplyCount(), 1);
  assert.equal(harness.outcomes.at(-1)?.kind, "repaired");
});

test("prompt mode can enable automatic repair while applying the current update", async () => {
  const harness = serviceHarness({ mode: "prompt", decision: "always" });
  const guardian = new PatchGuardian(harness.services);
  const outcome = await guardian.check({ reason: "startup" });

  assert.equal(outcome.kind, "repaired");
  assert.equal(harness.getApplyCount(), 1);
  assert.equal(harness.getAutoEnabled(), true);
});

test("observe mode reports an available repair without writing", async () => {
  const harness = serviceHarness();
  const guardian = new PatchGuardian(harness.services);
  const outcome = await guardian.check({ reason: "manual", action: "observe" });

  assert.equal(outcome.kind, "repair-available");
  assert.equal(harness.getApplyCount(), 0);
});

test("unsupported versions remain unchanged", async () => {
  const harness = serviceHarness({
    currentStatus: status({
      state: "unsupported-version",
      patchable: false,
      versionSupported: false,
      cleanHashSupported: false,
      knownHashes: [],
    }),
  });
  const guardian = new PatchGuardian(harness.services);
  const outcome = await guardian.check({ reason: "interval" });

  assert.equal(outcome.kind, "waiting");
  assert.equal(harness.getApplyCount(), 0);
});
