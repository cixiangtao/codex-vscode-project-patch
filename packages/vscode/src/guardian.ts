import type { ApplyResult, BundleRegistry, PatchStatus } from "../../../src/core.js";
import type { RegistryLoadResult } from "./registry.js";

export type RepairMode = "prompt" | "auto" | "off";
export type CheckReason = "startup" | "extension-change" | "interval" | "manual";
export type CheckAction = "respect-mode" | "observe" | "repair";
export type RepairDecision = "repair" | "always" | "skip";

export interface CheckOptions {
  reason: CheckReason;
  action?: CheckAction;
  forceRegistry?: boolean;
}

export type GuardianOutcomeKind =
  | "healthy"
  | "repaired"
  | "repair-available"
  | "waiting"
  | "attention"
  | "missing";

export interface GuardianOutcome {
  kind: GuardianOutcomeKind;
  reason: CheckReason;
  registrySource: RegistryLoadResult["source"];
  status?: PatchStatus;
  warning?: string;
}

export interface GuardianServices {
  loadRegistry(force: boolean): Promise<RegistryLoadResult>;
  getStatus(registry: BundleRegistry): Promise<PatchStatus>;
  apply(status: PatchStatus, registry: BundleRegistry): Promise<ApplyResult>;
  getRepairMode(): RepairMode;
  requestRepair(status: PatchStatus): Promise<RepairDecision>;
  enableAutomaticRepair(): PromiseLike<void>;
  onOutcome(outcome: GuardianOutcome): void;
  onRepaired(result: ApplyResult): Promise<void>;
  onError(error: unknown, options: CheckOptions): void;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingExtension(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EXTENSION_NOT_FOUND" || code === "BUNDLE_NOT_FOUND";
}

/** Coordinates update checks while keeping all editor UI behind injected services. */
export class PatchGuardian {
  readonly #services: GuardianServices;
  readonly #promptedTargets = new Set<string>();
  #inFlight: Promise<GuardianOutcome> | undefined;

  constructor(services: GuardianServices) {
    this.#services = services;
  }

  check(options: CheckOptions): Promise<GuardianOutcome> {
    if (this.#inFlight != null) return this.#inFlight;
    const operation = this.#performCheck(options).finally(() => {
      if (this.#inFlight === operation) this.#inFlight = undefined;
    });
    this.#inFlight = operation;
    return operation;
  }

  async #performCheck({
    reason,
    action = "respect-mode",
    forceRegistry = false,
  }: CheckOptions): Promise<GuardianOutcome> {
    let registryResult: RegistryLoadResult | undefined;
    try {
      registryResult = await this.#services.loadRegistry(forceRegistry);
      const status = await this.#services.getStatus(registryResult.registry);
      if (status.state === "patched") {
        return this.#emit({
          kind: "healthy",
          reason,
          registrySource: registryResult.source,
          status,
          ...(registryResult.warning == null ? {} : { warning: registryResult.warning }),
        });
      }

      if (!status.patchable) {
        return this.#emit({
          kind: status.state === "unsupported-version" ? "waiting" : "attention",
          reason,
          registrySource: registryResult.source,
          status,
          ...(registryResult.warning == null ? {} : { warning: registryResult.warning }),
        });
      }

      if (
        action === "observe" ||
        (action === "respect-mode" && this.#services.getRepairMode() === "off")
      ) {
        return this.#emit({
          kind: "repair-available",
          reason,
          registrySource: registryResult.source,
          status,
        });
      }

      let shouldRepair = action === "repair" || this.#services.getRepairMode() === "auto";
      if (!shouldRepair) {
        const promptKey = `${status.extensionDir}:${status.currentHash}`;
        if (this.#promptedTargets.has(promptKey)) {
          return this.#emit({
            kind: "repair-available",
            reason,
            registrySource: registryResult.source,
            status,
          });
        }
        this.#promptedTargets.add(promptKey);
        const decision = await this.#services.requestRepair(status);
        shouldRepair = decision === "repair" || decision === "always";
        if (decision === "always") await this.#services.enableAutomaticRepair();
      }

      if (!shouldRepair) {
        return this.#emit({
          kind: "repair-available",
          reason,
          registrySource: registryResult.source,
          status,
        });
      }

      const result = await this.#services.apply(status, registryResult.registry);
      await this.#services.onRepaired(result);
      return this.#emit({
        kind: result.changed ? "repaired" : "healthy",
        reason,
        registrySource: registryResult.source,
        status: result.status,
      });
    } catch (error) {
      if (isMissingExtension(error)) {
        return this.#emit({
          kind: "missing",
          reason,
          registrySource: registryResult?.source ?? "embedded",
          ...(registryResult?.warning == null ? {} : { warning: registryResult.warning }),
        });
      }
      this.#services.onError(error, { reason, action, forceRegistry });
      throw error;
    }
  }

  #emit(outcome: GuardianOutcome): GuardianOutcome {
    this.#services.onOutcome(outcome);
    return outcome;
  }
}
