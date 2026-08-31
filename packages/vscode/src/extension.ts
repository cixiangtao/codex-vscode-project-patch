import * as vscode from "vscode";

import {
  applyPatch,
  getStatus,
  PatchError,
  restorePatch,
  type ApplyResult,
  type PatchStatus,
} from "../../../src/core.js";
import { KNOWN_BUNDLES } from "../../../src/patch-constants.js";
import {
  PatchGuardian,
  resolveRepairMode,
  type CheckOptions,
  type GuardianOutcome,
  type RepairDecision,
  type RepairMode,
} from "./guardian.js";
import { CompatibilityRegistryClient } from "./registry.js";

const CONFIGURATION_SECTION = "codexPatch";
const OFFICIAL_EXTENSION_ID = "openai.chatgpt";
const CHECK_DEBOUNCE_MS = 2000;
const MINUTE_MS = 60_000;
const RESTART_ACTION = "Restart Extensions";
const STATUS_ACTION = "Show Status";

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIGURATION_SECTION);
}

function repairMode(): RepairMode {
  return resolveRepairMode(configuration().get<unknown>("repairMode"));
}

function checkIntervalMs(): number {
  const configured = configuration().get<number>("checkIntervalMinutes", 10);
  return Math.min(1440, Math.max(1, configured)) * MINUTE_MS;
}

function errorMessage(error: unknown): string {
  if (error instanceof PatchError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

class CodexPatchExtension implements vscode.Disposable {
  readonly #output = vscode.window.createOutputChannel("Codex Patch");
  readonly #statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 25);
  readonly #registry: CompatibilityRegistryClient;
  readonly #guardian: PatchGuardian;
  readonly #extensionVersion: string;
  readonly #disposables: vscode.Disposable[] = [];
  #lastOutcome: GuardianOutcome | undefined;
  #lastNoticeKey: string | undefined;
  #checkTimer: NodeJS.Timeout | undefined;
  #debounceTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    const version = context.extension.packageJSON.version;
    this.#extensionVersion = typeof version === "string" ? version : "unknown";
    this.#registry = new CompatibilityRegistryClient({
      embeddedRegistry: KNOWN_BUNDLES,
      store: context.globalState,
    });
    this.#guardian = new PatchGuardian({
      loadRegistry: (force) => this.#registry.load(force),
      getStatus: (registry) => getStatus({ editor: "vscode", registry }),
      apply: (status, registry) => applyPatch({ extensionDir: status.extensionDir, registry }),
      getRepairMode: repairMode,
      requestRepair: (status) => this.#requestRepair(status),
      enableAutomaticRepair: () =>
        configuration().update("repairMode", "auto", vscode.ConfigurationTarget.Global),
      onOutcome: (outcome) => this.#handleOutcome(outcome),
      onRepaired: (result) => this.#showRestartPrompt(result),
      onError: (error, options) => this.#handleError(error, options),
    });
  }

  activate(): void {
    this.#output.appendLine(`Codex Patch ${this.#extensionVersion} activated.`);
    this.#statusBar.command = "codexPatch.showStatus";
    this.#statusBar.name = "Codex Patch";
    this.#statusBar.show();
    this.#disposables.push(
      this.#output,
      this.#statusBar,
      vscode.commands.registerCommand("codexPatch.checkNow", () =>
        this.#runCheck({ reason: "manual", action: "observe", forceRegistry: true }, true),
      ),
      vscode.commands.registerCommand("codexPatch.repairNow", () =>
        this.#runCheck({ reason: "manual", action: "repair", forceRegistry: true }, true),
      ),
      vscode.commands.registerCommand("codexPatch.restore", () => this.#restore()),
      vscode.commands.registerCommand("codexPatch.showStatus", () => this.#showStatus()),
      vscode.extensions.onDidChange(() => this.#scheduleCheck("extension-change", true)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(CONFIGURATION_SECTION)) return;
        this.#restartInterval();
        this.#scheduleCheck("manual", false);
      }),
    );
    this.#restartInterval();
    void this.#runCheck({ reason: "startup", action: "respect-mode" });
  }

  dispose(): void {
    if (this.#checkTimer != null) clearInterval(this.#checkTimer);
    if (this.#debounceTimer != null) clearTimeout(this.#debounceTimer);
    for (const disposable of this.#disposables) disposable.dispose();
  }

  #restartInterval(): void {
    if (this.#checkTimer != null) clearInterval(this.#checkTimer);
    this.#checkTimer = setInterval(() => {
      void this.#runCheck({ reason: "interval", action: "respect-mode" });
    }, checkIntervalMs());
  }

  #scheduleCheck(reason: "extension-change" | "manual", forceRegistry: boolean): void {
    if (this.#debounceTimer != null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined;
      void this.#runCheck({ reason, action: "respect-mode", forceRegistry });
    }, CHECK_DEBOUNCE_MS);
  }

  async #runCheck(options: CheckOptions, revealStatus = false): Promise<void> {
    this.#statusBar.text = "$(sync~spin) Codex Patch";
    this.#statusBar.tooltip = "Checking the Codex workspace filter patch";
    try {
      await this.#guardian.check(options);
      if (revealStatus) this.#showStatus();
    } catch (error) {
      if (revealStatus) void vscode.window.showErrorMessage(`Codex Patch: ${errorMessage(error)}`);
    }
  }

  async #requestRepair(status: PatchStatus): Promise<RepairDecision> {
    const choice = await vscode.window.showInformationMessage(
      `Codex ${status.version} is compatible. Repair the workspace filter before restarting extensions?`,
      "Repair Now",
      "Always Repair Automatically",
      "Not Now",
    );
    if (choice === "Repair Now") return "repair";
    if (choice === "Always Repair Automatically") return "always";
    return "skip";
  }

  async #showRestartPrompt(result: ApplyResult): Promise<void> {
    if (!result.changed) return;
    const choice = await vscode.window.showInformationMessage(
      `Codex Patch repaired the workspace filter for Codex ${result.status.version}. Restart extensions to load it.`,
      RESTART_ACTION,
      STATUS_ACTION,
    );
    if (choice === RESTART_ACTION) {
      try {
        await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
      } catch (error) {
        this.#output.appendLine(`Could not restart the extension host: ${errorMessage(error)}`);
        void vscode.window.showWarningMessage(
          "Run “Developer: Restart Extension Host” from the Command Palette.",
        );
      }
    } else if (choice === STATUS_ACTION) {
      this.#showStatus();
    }
  }

  #handleOutcome(outcome: GuardianOutcome): void {
    this.#lastOutcome = outcome;
    const status = outcome.status;
    if (outcome.warning != null) this.#output.appendLine(outcome.warning);

    switch (outcome.kind) {
      case "healthy":
      case "repaired":
        this.#statusBar.text = "$(shield) Codex Patch";
        this.#statusBar.tooltip = `Workspace filter active for Codex ${status?.version ?? "unknown"}`;
        break;
      case "repair-available":
        this.#statusBar.text = "$(warning) Codex Patch";
        this.#statusBar.tooltip = `Compatible Codex ${status?.version ?? "update"} is ready to repair`;
        break;
      case "waiting":
        this.#statusBar.text = "$(clock) Codex Patch";
        this.#statusBar.tooltip = `Waiting for compatibility with Codex ${status?.version ?? "update"}`;
        this.#notifyOnce(
          `waiting:${status?.version}:${status?.currentHash}`,
          `Codex ${status?.version ?? "update"} is not yet verified. No files were changed.`,
        );
        break;
      case "attention":
        this.#statusBar.text = "$(error) Codex Patch";
        this.#statusBar.tooltip = `Codex Patch needs attention: ${status?.state ?? "unknown state"}`;
        this.#notifyOnce(
          `attention:${status?.version}:${status?.currentHash}`,
          `Codex Patch refused state “${status?.state ?? "unknown"}”. No files were changed.`,
        );
        break;
      case "missing":
        this.#statusBar.text = "$(circle-slash) Codex Patch";
        this.#statusBar.tooltip = "The official OpenAI Codex extension is not installed";
        break;
    }
  }

  #notifyOnce(key: string, message: string): void {
    if (this.#lastNoticeKey === key) return;
    this.#lastNoticeKey = key;
    void vscode.window.showWarningMessage(message, STATUS_ACTION).then((choice) => {
      if (choice === STATUS_ACTION) this.#showStatus();
    });
  }

  #handleError(error: unknown, options: CheckOptions): void {
    this.#output.appendLine(
      `[${new Date().toISOString()}] ${options.reason} check failed: ${errorMessage(error)}`,
    );
    this.#statusBar.text = "$(error) Codex Patch";
    this.#statusBar.tooltip = `Check failed: ${errorMessage(error)}`;
  }

  #showStatus(): void {
    this.#output.clear();
    this.#output.appendLine("Codex Patch status");
    this.#output.appendLine(`Codex Patch version: ${this.#extensionVersion}`);
    this.#output.appendLine(`Repair mode: ${repairMode()}`);
    this.#output.appendLine(`Official extension: ${OFFICIAL_EXTENSION_ID}`);
    if (this.#lastOutcome == null) {
      this.#output.appendLine("No check has completed yet.");
    } else {
      this.#output.appendLine(`Guardian state: ${this.#lastOutcome.kind}`);
      this.#output.appendLine(`Compatibility source: ${this.#lastOutcome.registrySource}`);
      if (this.#lastOutcome.status != null) {
        const { status } = this.#lastOutcome;
        this.#output.appendLine(`Codex version: ${status.version}`);
        this.#output.appendLine(`Patch state: ${status.state}`);
        this.#output.appendLine(`Bundle: ${status.bundlePath}`);
        this.#output.appendLine(`SHA-256: ${status.currentHash}`);
        this.#output.appendLine(`Backup: ${status.backupPath ?? "not created"}`);
      }
      if (this.#lastOutcome.warning != null) {
        this.#output.appendLine(`Warning: ${this.#lastOutcome.warning}`);
      }
    }
    this.#output.show(true);
  }

  async #restore(): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      "Restore the official Codex extension file and disable the workspace filter?",
      { modal: true },
      "Restore",
    );
    if (confirmation !== "Restore") return;

    try {
      const { registry } = await this.#registry.load(true);
      const result = await restorePatch({ editor: "vscode", registry });
      await this.#runCheck({ reason: "manual", action: "observe" });
      const choice = await vscode.window.showInformationMessage(
        result.changed
          ? "The official Codex extension file was restored. Restart extensions to load it."
          : "The official Codex extension file is already restored.",
        ...(result.changed ? [RESTART_ACTION] : []),
      );
      if (choice === RESTART_ACTION) {
        await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
      }
    } catch (error) {
      this.#handleError(error, { reason: "manual", action: "observe", forceRegistry: true });
      void vscode.window.showErrorMessage(`Codex Patch: ${errorMessage(error)}`);
    }
  }
}

let extension: CodexPatchExtension | undefined;

/** Activates the Codex Patch update guardian. */
export function activate(context: vscode.ExtensionContext): void {
  extension = new CodexPatchExtension(context);
  context.subscriptions.push(extension);
  extension.activate();
}

/** Releases timers and UI resources owned by the guardian. */
export function deactivate(): void {
  extension?.dispose();
  extension = undefined;
}
