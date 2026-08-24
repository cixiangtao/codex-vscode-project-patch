---
name: codex-vscode-project-patch
description: Safely inspect, dry-run, apply, or restore the local workspace-filter patch for the installed OpenAI Codex VS Code extension. Use whenever the user asks about codex-vscode-project-patch, project-scoped Codex task history, the local openai.chatgpt bundle patch, patch compatibility, or restoring the official entry bundle.
compatibility: Requires Node.js 20+ and npm/npx.
---

# Codex VS Code project patch

Use the installed CLI as the source of truth. It validates the official
extension version, bundle hash, patch anchors, backup, and restored content.

## Safe order

1. For a read-only inspection, resolve the latest published CLI explicitly:

   ```bash
   npx --yes --prefer-online codex-vscode-project-patch@latest status --json
   ```

2. If the user asked to assess or prepare the patch, dry-run it:

   ```bash
   npx --yes --prefer-online codex-vscode-project-patch@latest apply --dry-run --json
   ```

3. Run `apply` only when the user explicitly asked to patch or enable the
   workspace-filtered task list. In that case the intended one-command path is
   `npx --yes --prefer-online codex-vscode-project-patch@latest`; no subcommand
   defaults to the same apply transaction. Run `restore` only when they
   explicitly asked to remove the patch or recover the official entry.

4. After a write, preserve the CLI's result summary: tell the user to run
   `Developer: Reload Window`, include the printed restore command, and use
   `status --json` if verification details are needed.

## Rules

- Stop on `unsupported-version`, `modified-or-unknown-hash`, `inconsistent`, or
  `patched-unmanaged`. Do not hand-edit the bundle or bypass the allowlist.
- Prefer the default VS Code discovery. Use `--extension-dir` only when the user
  has identified a specific installation or discovery selected the wrong one.
- No authentication is required; the tool works only on local files.
- There is no raw or force escape hatch by design. A new extension build needs
  a reviewed patch strategy and allowlist update.
- Do not publish, download, repack, or redistribute an official OpenAI VSIX.

## Common commands

```bash
# Read-only compatibility report
npx --yes --prefer-online codex-vscode-project-patch@latest status --json

# Read-only apply validation
npx --yes --prefer-online codex-vscode-project-patch@latest apply --dry-run --json

# Explicitly requested one-command apply without global installation
npx --yes --prefer-online codex-vscode-project-patch@latest

# Explicitly requested recovery
npx --yes --prefer-online codex-vscode-project-patch@latest restore --json
```
