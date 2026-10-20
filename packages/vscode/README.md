# Codex Patch

> **No longer maintained as of October 20, 2026.** No further compatibility
> reviews, bug fixes, security fixes, or releases are planned. The compatibility
> registry is frozen. Existing installations do not disable themselves.

## Remove the companion and patch

1. Set `codexPatch.repairMode` to `off` to prevent automatic reapplication.
2. Run **Codex Patch: Restore Official Extension** from the Command Palette.
3. Uninstall **Codex Patch** (`cixiangtao.codex-patch`) and run
   **Developer: Reload Window**.

If the companion is unavailable, use the
[CLI recovery instructions](https://github.com/cixiangtao/codex-vscode-project-patch#remove-the-patch-and-return-to-the-official-extension).
If restore refuses a changed bundle, keep the companion disabled or uninstalled
and reinstall the official `openai.chatgpt` extension through VS Code. Do not
overwrite a newer official bundle with an old backup.

## Historical behavior

Codex Patch is an unofficial companion extension for the official
`openai.chatgpt` VS Code extension. It keeps the workspace task filter patch
active when Codex updates replace the installed extension bundle.

- Watches for installed-extension changes and performs a fallback periodic check.
- Refreshes the reviewed compatibility registry with a short local cache.
- Reuses the CLI's version, SHA-256, structure, backup, atomic-write, syntax, and
  rollback checks.
- Repairs only a clean, explicitly allowlisted bundle.
- Refuses unknown, modified, ambiguous, or unmanaged bundles without changing
  them.
- Offers a single **Restart Extensions** action after a successful repair.

The default repair mode is `auto`. Set `codexPatch.repairMode` to `prompt` to ask
before each compatible update, or `off` to report status without writing.

Visual Studio Marketplace distribution is currently unavailable. Build and
install the local VSIX from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm vscode:package
code --install-extension .artifacts/codex-patch.vsix
```

## Commands

- `Codex Patch: Check Now`
- `Codex Patch: Repair Now`
- `Codex Patch: Restore Official Extension`
- `Codex Patch: Show Status`

## Boundaries

This extension does not contain or redistribute OpenAI's extension. It modifies
only the user's existing local installation and is not affiliated with or
endorsed by OpenAI. A restart of the extension host is still required because an
already loaded JavaScript bundle cannot be replaced in memory safely.
