import assert from "node:assert/strict";
import { test } from "vitest";

import type { ApplyResult, BundleRegistry, PatchStatus } from "../../../src/core.js";
import {
  PatchGuardian,
  resolveRepairMode,
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

test("repair mode defaults to automatic unless the user explicitly opts out", () => {
  assert.equal(resolveRepairMode(undefined), "auto");
  assert.equal(resolveRepairMode("auto"), "auto");
  assert.equal(resolveRepairMode("prompt"), "prompt");
  assert.equal(resolveRepairMode("off"), "off");
  assert.equal(resolveRepairMode("unexpected"), "auto");
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

test("a stale cache is forcibly refreshed before refusing a compatible update", async () => {
  const outcomes: GuardianOutcome[] = [];
  const loadForces: boolean[] = [];
  let applyCount = 0;
  const staleRegistry: BundleRegistry = { "26.818.32112": ["b".repeat(64)] };
  const patchedStatus = status({
    state: "patched",
    patchable: false,
    restorable: true,
    structure: {
      ...status().structure,
      markerCount: 1,
      originalAnchorCount: 0,
      patchedAnchorCount: 1,
      validClean: false,
      validPatched: true,
    },
  });
  const guardian = new PatchGuardian({
    loadRegistry: async (force) => {
      loadForces.push(force);
      return force
        ? { registry: REGISTRY, source: "remote" }
        : { registry: staleRegistry, source: "cache" };
    },
    getStatus: async (registry) =>
      registry[VERSION] == null
        ? status({
            state: "unsupported-version",
            patchable: false,
            versionSupported: false,
            cleanHashSupported: false,
            knownHashes: [],
          })
        : status(),
    apply: async () => {
      applyCount += 1;
      return { changed: true, dryRun: false, status: patchedStatus };
    },
    getRepairMode: () => "auto",
    requestRepair: async () => "repair",
    enableAutomaticRepair: async () => undefined,
    onOutcome: (outcome) => outcomes.push(outcome),
    onRepaired: async () => undefined,
    onError: () => undefined,
  });

  const outcome = await guardian.check({ reason: "startup" });
  assert.deepEqual(loadForces, [false, true]);
  assert.equal(applyCount, 1);
  assert.equal(outcome.kind, "repaired");
  assert.equal(outcomes.at(-1)?.kind, "repaired");
});

test("an unavailable registry reports waiting instead of claiming the bundle was modified", async () => {
  const loadForces: boolean[] = [];
  const uncertainStatus = status({
    state: "modified-or-unknown-hash",
    patchable: false,
    cleanHashSupported: false,
  });
  const guardian = new PatchGuardian({
    ...serviceHarness({ currentStatus: uncertainStatus }).services,
    loadRegistry: async (force) => {
      loadForces.push(force);
      return {
        registry: REGISTRY,
        source: "cache",
        warning: "Could not refresh compatibility data: offline",
      };
    },
  });

  const outcome = await guardian.check({ reason: "startup" });
  assert.deepEqual(loadForces, [false, true]);
  assert.equal(outcome.kind, "waiting");
  assert.match(outcome.warning ?? "", /offline/);
});

test("a remotely confirmed unknown hash still requires attention", async () => {
  const harness = serviceHarness({
    currentStatus: status({
      state: "modified-or-unknown-hash",
      patchable: false,
      cleanHashSupported: false,
    }),
  });
  const guardian = new PatchGuardian(harness.services);

  const outcome = await guardian.check({ reason: "manual", forceRegistry: true });
  assert.equal(outcome.kind, "attention");
  assert.equal(harness.getApplyCount(), 0);
});
