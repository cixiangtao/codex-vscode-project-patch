# codex-vscode-project-patch

A minimal, version-aware npm CLI that locally patches the installed official
`openai.chatgpt` VS Code extension. The patch adds the active workspace folder
paths to Webview-originated `thread/list` requests, so Codex task history is
filtered by exact session `cwd`.

This package does **not** contain, download, repack, or redistribute OpenAI's
VSIX or bundle. It modifies the user's existing local installation only.

## Supported build

The first prototype deliberately has a narrow allowlist:

| Extension version | Clean `out/extension.js` SHA-256                                   |
| ----------------- | ------------------------------------------------------------------ |
| `26.810.41047`    | `5669921cf77b0de7e49c8e6c6ac6283baa593ccf131bef7b2eac3e1b8eeaf859` |
| `26.810.52044`    | `5669921cf77b0de7e49c8e6c6ac6283baa593ccf131bef7b2eac3e1b8eeaf859` |

Both extension versions currently ship the same entry bundle. Unknown versions,
unknown hashes, already modified bundles, missing workspace helpers, and
ambiguous patch anchors are refused.

## One-command use

After the package is published to npm, applying the patch is one command:

```bash
npx -y codex-vscode-project-patch
```

No global installation and no separate status or dry-run step are required.
With no subcommand, the CLI defaults to `apply` and performs discovery,
compatibility checks, backup, atomic patching, and post-patch verification as
one transaction. Running it again is safe: an already managed patch is reported
without rewriting the bundle.

Successful output keeps the result and follow-up actions together:

```text
✓ Workspace task filter enabled

Extension
  Version     openai.chatgpt@26.810.52044
  State       patched
  Filter      current workspace folders
  Backup      ~/.codex-vscode-project-patch/backups/<sha256>/extension.js

Next steps — reload required
  1. Reload VS Code
     Press ⌘⇧P, then run Developer: Reload Window
  2. Reopen the Codex task list
     It will be filtered to the current workspace folders.

Restore the official file
  npx -y codex-vscode-project-patch restore

Inspect details: npx -y codex-vscode-project-patch status --json
```

The same guidance is printed when the patch is already active, so rerunning the
one-command workflow never leaves the user guessing about reload or recovery.
In an interactive terminal, the three information types are visually distinct:
`Extension` is cyan, `Next steps` is yellow, and `Restore` is magenta. Color is
automatically omitted for non-interactive output and when `NO_COLOR` is set.

Reload the VS Code window after the command completes. An official extension
update normally replaces the modified installation; run the same `npx` command
again. If the new build is not allowlisted, it stops without modifying anything.

To remove the patch without installing the CLI globally:

```bash
npx -y codex-vscode-project-patch restore
```

## Development and advanced use

The source is TypeScript and the package is built with tsdown. Development uses
pnpm, Oxlint, Oxfmt, and Vitest. Node.js 24.11 or newer is required to run the
current build toolchain; the generated CLI targets Node.js 20 and newer.

Bootstrap a checkout:

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm link --global
codex-vscode-project-patch apply
codex-vscode-project-patch status
codex-vscode-project-patch restore
```

The quality commands are intentionally composable:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

`pnpm release:check` runs the complete local gate without publishing. The
project has no local publication command; a future public release must be owned
by one explicit GitHub Actions workflow after the real GitHub repository and
npm trusted-publishing identity are configured.

The main source boundaries are:

- `src/bin.ts`: executable entry point
- `src/cli.ts`: arguments, human output, and JSON output
- `src/core.ts`: discovery, compatibility, patch, backup, and restore logic
- `src/index.ts`: public package exports
- `test/core.test.ts`: synthetic bundle and CLI contract tests

The default target is the newest valid `openai.chatgpt` directory under VS Code's
extension folders. Override it when needed:

```bash
codex-vscode-project-patch status \
  --extension-dir /absolute/path/to/openai.chatgpt-<version>-darwin-arm64
```

`--editor cursor` and `--editor auto` are available for discovery, but no Cursor
bundle is allowlisted in this first release.

## Safety model

`apply` performs these checks and writes in this order:

1. Validate `package.json` is `openai.chatgpt` and resolve its real `main` entry.
2. Require an allowlisted extension version and clean entry SHA-256.
3. Require exactly one clean request-bridge anchor and the existing
   `workspaceFolders`/WSL path helper.
4. Write and hash-verify an original backup under
   `~/.codex-vscode-project-patch/backups/<sha256>/extension.js`.
5. Atomically replace the entry bundle.
6. Verify the marker, transformed anchor, patched hash, and JavaScript syntax.
7. Write an installation-specific manifest. A failed apply automatically rolls
   the bundle back from memory; the verified backup remains available.

`restore` only overwrites the bundle when its current hash exactly matches the
hash recorded immediately after apply. This prevents restore from erasing a
later official update or an unrelated local edit.

Set `CODEX_VSCODE_PROJECT_PATCH_HOME` or pass `--state-dir` to change backup and
manifest storage.

An optional companion Codex skill is included at
`skill/codex-vscode-project-patch/SKILL.md`. Copy that directory into your Codex
skills folder only if you want agents to follow the same safe command ordering;
the npm install does not modify global Codex configuration.

## JSON contract

Use `--json` for automation:

```bash
codex-vscode-project-patch status --json
codex-vscode-project-patch apply --dry-run --json
```

Human output uses `picocolors`, which automatically respects non-interactive
terminals and `NO_COLOR`. JSON output never contains ANSI styling. CLI argument
parsing and help are provided by `commander`; patching, backup, and verification
remain implemented in this package.

Success:

```json
{
  "ok": true,
  "command": "status",
  "result": {
    "state": "clean",
    "patchable": true,
    "restorable": false
  }
}
```

Failure is JSON on stdout with a non-zero exit code:

```json
{
  "ok": false,
  "error": {
    "code": "UNSUPPORTED_BUNDLE",
    "message": "Refusing to patch an unknown bundle."
  }
}
```

Useful states are `clean`, `patched`, `restored`, `patched-unmanaged`,
`inconsistent`, `modified-or-unknown-hash`, and `unsupported-version`.

## Patch point

The Webview's recent-task store calls `thread/list` without `cwd`. Its request is
forwarded by the extension entry's `mcp-request` case. The patch intercepts that
single bridge case and, only for `thread/list`, adds:

```js
cwd: Cb();
```

`Cb()` is already provided by the official entry bundle. It reads all
`vscode.workspace.workspaceFolders` paths and converts them for WSL when the
extension is configured to run Codex there. The bundled Codex app-server schema
accepts `cwd` as either one string or an array and performs exact session-cwd
matching.

The patch intentionally does not alter the two separate native conversation
preview/chat-session `thread/list` calls in `out/extension.js`; it targets the
Codex Webview task list.

## Compatibility risks

- Minified identifiers and bridge layout can change in any extension update.
- The app-server `ThreadListParams.cwd` contract can change with the bundled
  Codex binary.
- Multi-root workspaces match any exact root; tasks started in nested folders do
  not match unless their recorded cwd equals one of those roots.
- No workspace folder means no filter is injected, preserving the official list.
- The primary Webview task list is filtered, but other VS Code-native conversation
  history surfaces remain global.
- VS Code may report that extension files were modified, and official updates
  will normally remove the patch.

For each new official build, regenerate the bundled app-server schema, confirm
the `cwd` contract, trace the request bridge again, test against a copied
installation, and only then add the new version/hash to the allowlist.

## License and status

MIT licensed. This is an unofficial proof of concept and is not affiliated with
or endorsed by OpenAI. Contribution and security-reporting expectations are
documented in `CONTRIBUTING.md` and `SECURITY.md`; release ownership and the
remaining public-host setup are documented in `RELEASING.md`.
