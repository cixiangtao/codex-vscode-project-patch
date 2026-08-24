# Codex Patch

Codex Patch is an unofficial companion extension for the official
`openai.chatgpt` VS Code extension. It keeps the workspace task filter patch
active when Codex updates replace the installed extension bundle.

## Behavior

- Watches for installed-extension changes and performs a fallback periodic check.
- Refreshes the reviewed compatibility registry with a short local cache.
- Reuses the CLI's version, SHA-256, structure, backup, atomic-write, syntax, and
  rollback checks.
- Repairs only a clean, explicitly allowlisted bundle.
- Refuses unknown, modified, ambiguous, or unmanaged bundles without changing
  them.
- Offers a single **Restart Extensions** action after a successful repair.

The default repair mode is `prompt`. Select **Always Repair Automatically** once,
or set `codexPatch.repairMode` to `auto`, to repair future compatible updates
without running the CLI manually.

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
