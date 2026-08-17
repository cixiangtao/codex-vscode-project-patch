import { Command, CommanderError } from "commander";
import pc from "picocolors";

import {
  applyPatch,
  getStatus,
  PatchError,
  restorePatch,
  type ApplyResult,
  type Editor,
  type PatchStatus,
  type RestoreResult,
} from "./core.js";
import { TOOL_NAME, TOOL_VERSION } from "./constants.js";

type CommandName = "status" | "doctor" | "apply" | "restore";
type ColorPalette = Pick<
  typeof pc,
  "bold" | "dim" | "green" | "cyan" | "yellow" | "magenta" | "red"
>;
type ColorTone = "green" | "cyan" | "yellow" | "magenta";

interface OutputCapture {
  stdout: string;
  stderr: string;
}

interface CliOptions {
  extensionDir?: string | undefined;
  editor: Editor;
  stateDir?: string | undefined;
  json: boolean;
  dryRun: boolean;
}

interface ParsedArguments {
  handled: boolean;
  output: string;
  command: string | undefined;
  options: CliOptions;
}

interface HumanFormatOptions {
  platform?: NodeJS.Platform | undefined;
  colors?: ColorPalette | undefined;
}

interface NormalizedError {
  code?: string | undefined;
  message: string;
  details?: unknown;
}

const COMMANDS = new Set<string>(["status", "doctor", "apply", "restore"]);
const NPX_APPLY = `npx -y ${TOOL_NAME}`;
const NPX_RESTORE = `${NPX_APPLY} restore`;
const NPX_STATUS = `${NPX_APPLY} status --json`;

function createProgram(capture: OutputCapture): Command {
  return new Command()
    .name(TOOL_NAME)
    .description(
      "Patch the installed OpenAI Codex VS Code task list to show the current workspace.",
    )
    .usage("[command] [options]")
    .argument("[command]", "apply (default), status, doctor, or restore")
    .option("--extension-dir <path>", "use an exact openai.chatgpt installation directory")
    .option("--editor <name>", "vscode, cursor, or auto", "vscode")
    .option("--state-dir <path>", "override backup and manifest storage")
    .option("--json", "emit stable machine-readable JSON", false)
    .option("--dry-run", "validate apply without writing files", false)
    .version(TOOL_VERSION, "-v, --version", "show version")
    .helpOption("-h, --help", "show help")
    .addHelpText(
      "after",
      `
Examples:
  $ ${NPX_APPLY}
  $ ${NPX_STATUS}
  $ ${NPX_RESTORE}

Running without a command safely applies the patch. Unknown versions, hashes,
or bundle structures are refused. The official VSIX is never redistributed.
`,
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        capture.stdout += text;
      },
      writeErr: (text) => {
        capture.stderr += text;
      },
    });
}

function usageError(error: CommanderError, capture: OutputCapture): PatchError {
  const codeByCommanderCode: Partial<Record<string, string>> = {
    "commander.excessArguments": "UNEXPECTED_ARGUMENT",
    "commander.missingArgument": "MISSING_OPTION_VALUE",
    "commander.optionMissingArgument": "MISSING_OPTION_VALUE",
    "commander.unknownOption": "UNKNOWN_OPTION",
  };
  return new PatchError(
    codeByCommanderCode[error.code] ?? "CLI_USAGE_ERROR",
    error.message.replace(/^error:\s*/i, ""),
    capture.stderr.trim().length > 0 ? { usage: capture.stderr.trim() } : undefined,
  );
}

export function parseArguments(argv: string[]): ParsedArguments {
  const capture = { stdout: "", stderr: "" };
  const program = createProgram(capture);
  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === "commander.helpDisplayed" || error.code === "commander.version")
    ) {
      return {
        handled: true,
        output: capture.stdout,
        command: undefined,
        options: program.opts<CliOptions>(),
      };
    }
    if (error instanceof CommanderError) throw usageError(error, capture);
    throw error;
  }
  return {
    handled: false,
    output: "",
    command: program.processedArgs[0],
    options: program.opts<CliOptions>(),
  };
}

export function resolveCommand(command: string | undefined): string {
  return command ?? "apply";
}

function detailRow(label: string, value: string, colors: ColorPalette): string {
  return `  ${colors.dim(label.padEnd(12))}${value}`;
}

function sectionHeading(label: string, tone: ColorTone, colors: ColorPalette): string {
  return colors.bold(colors[tone](label));
}

function reloadInstructions(platform: NodeJS.Platform, colors: ColorPalette): string[] {
  const shortcut = platform === "darwin" ? "⌘⇧P" : "Ctrl+Shift+P";
  return [
    `  ${colors.bold("1. Reload VS Code")}`,
    `     Press ${colors.cyan(shortcut)}, then run ${colors.cyan("Developer: Reload Window")}`,
    `  ${colors.bold("2. Reopen the Codex task list")}`,
    "     It will be filtered to the current workspace folders.",
  ];
}

function formatApply(result: ApplyResult, platform: NodeJS.Platform, colors: ColorPalette): string {
  const status = result.status;
  if (result.dryRun) {
    return [
      `${colors.green("✓")} ${colors.bold("Preflight passed — no files changed")}`,
      "",
      sectionHeading("Extension", "cyan", colors),
      detailRow("Version", `openai.chatgpt@${status.version}`, colors),
      detailRow("State", status.state, colors),
      detailRow("SHA-256", status.currentHash, colors),
      "",
      sectionHeading("Apply", "green", colors),
      `  ${colors.green(NPX_APPLY)}`,
    ].join("\n");
  }

  const title = result.changed
    ? "Workspace task filter enabled"
    : "Workspace task filter is already enabled";
  return [
    `${colors.green("✓")} ${colors.bold(title)}`,
    "",
    sectionHeading("Extension", "cyan", colors),
    detailRow("Version", `openai.chatgpt@${status.version}`, colors),
    detailRow("State", status.state, colors),
    detailRow("Filter", "current workspace folders", colors),
    detailRow("Backup", status.backupPath ?? result.backupPath ?? "not available", colors),
    "",
    sectionHeading("Next steps — reload required", "yellow", colors),
    ...reloadInstructions(platform, colors),
    "",
    sectionHeading("Restore the official file", "magenta", colors),
    `  ${colors.magenta(NPX_RESTORE)}`,
    "",
    colors.dim(`Inspect details: ${NPX_STATUS}`),
  ].join("\n");
}

function statusTitle(status: PatchStatus, colors: ColorPalette): string {
  if (status.state === "patched") {
    return `${colors.green("✓")} ${colors.bold("Workspace task filter is enabled")}`;
  }
  if (status.state === "clean" || status.state === "restored") {
    return `${colors.cyan("●")} ${colors.bold("Workspace task filter is not enabled")}`;
  }
  return `${colors.yellow("!")} ${colors.bold("Workspace task filter needs attention")}`;
}

function formatStatus(status: PatchStatus, colors: ColorPalette): string {
  const lines = [
    statusTitle(status, colors),
    "",
    sectionHeading("Extension", "cyan", colors),
    detailRow("Version", `openai.chatgpt@${status.version}`, colors),
    detailRow("State", status.state, colors),
    detailRow("SHA-256", status.currentHash, colors),
    detailRow("Entry", status.bundlePath, colors),
  ];
  if (status.backupPath) lines.push(detailRow("Backup", status.backupPath, colors));

  const actionTone: ColorTone = status.state === "patched" ? "magenta" : "green";
  lines.push("", sectionHeading("Available action", actionTone, colors));
  if (status.state === "patched") lines.push(`  ${colors.magenta(NPX_RESTORE)}`);
  else if (status.patchable) lines.push(`  ${colors.green(NPX_APPLY)}`);
  else lines.push("  No safe automatic action is available for this bundle.");
  return lines.join("\n");
}

function formatRestore(
  result: RestoreResult,
  platform: NodeJS.Platform,
  colors: ColorPalette,
): string {
  const status = result.status;
  const title = result.changed
    ? "Official Codex extension file restored"
    : "Official Codex extension file is already restored";
  return [
    `${colors.green("✓")} ${colors.bold(title)}`,
    "",
    sectionHeading("Extension", "cyan", colors),
    detailRow("Version", `openai.chatgpt@${status.version}`, colors),
    detailRow("State", status.state, colors),
    detailRow("SHA-256", status.currentHash, colors),
    "",
    sectionHeading("Next step — reload required", "yellow", colors),
    `  ${colors.bold("Reload VS Code")}`,
    `  Press ${colors.cyan(platform === "darwin" ? "⌘⇧P" : "Ctrl+Shift+P")}, then run ${colors.cyan("Developer: Reload Window")}`,
    "",
    sectionHeading("Enable the filter again", "green", colors),
    `  ${colors.green(NPX_APPLY)}`,
  ].join("\n");
}

export function formatHuman(
  command: CommandName,
  result: PatchStatus | ApplyResult | RestoreResult,
  { platform = process.platform, colors = pc }: HumanFormatOptions = {},
): string {
  if (command === "status" || command === "doctor") {
    return formatStatus(result as PatchStatus, colors);
  }
  if (command === "apply") return formatApply(result as ApplyResult, platform, colors);
  if (command === "restore") return formatRestore(result as RestoreResult, platform, colors);
  throw new PatchError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
}

export function formatHumanError(
  error: NormalizedError,
  { colors = pc }: Pick<HumanFormatOptions, "colors"> = {},
): string {
  return [
    `${colors.red("✖")} ${colors.bold("Command could not be completed")}`,
    "",
    colors.bold("Reason"),
    `  ${error.message}`,
    "",
    colors.bold("Inspect the current state"),
    `  ${colors.cyan(NPX_STATUS)}`,
    "",
    colors.dim("Safety checks refuse unknown versions, hashes, and modified bundles."),
  ].join("\n");
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export async function runCli(argv: string[]): Promise<void> {
  let parsed: ParsedArguments | undefined;
  let effectiveCommand: string | undefined;
  try {
    parsed = parseArguments(argv);
    if (parsed.handled) {
      process.stdout.write(parsed.output);
      return;
    }

    const { command, options } = parsed;
    effectiveCommand = resolveCommand(command);
    if (!COMMANDS.has(effectiveCommand)) {
      throw new PatchError("UNKNOWN_COMMAND", `Unknown command: ${effectiveCommand}`);
    }
    if (options.dryRun && effectiveCommand !== "apply") {
      throw new PatchError("INVALID_OPTION", "--dry-run is only valid with apply.");
    }

    let result: PatchStatus | ApplyResult | RestoreResult;
    if (effectiveCommand === "status" || effectiveCommand === "doctor") {
      result = await getStatus(options);
    } else if (effectiveCommand === "apply") {
      result = await applyPatch(options);
    } else {
      result = await restorePatch(options);
    }

    if (options.json) printJson({ ok: true, command: effectiveCommand, result });
    else process.stdout.write(`${formatHuman(effectiveCommand as CommandName, result)}\n`);
  } catch (error) {
    const normalized = {
      code: error instanceof PatchError ? error.code : "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof PatchError && error.details !== undefined
        ? { details: error.details }
        : {}),
    };
    if (parsed?.options?.json || argv.includes("--json")) {
      printJson({ ok: false, error: normalized });
    } else {
      process.stderr.write(`${formatHumanError(normalized)}\n`);
    }
    process.exitCode = 1;
  }
}
