# codex-vscode-project-patch

> **No longer maintained as of October 20, 2026.** Development, compatibility
> reviews, bug fixes, security fixes, and releases have ended. Existing source
> and releases remain available for reference and recovery. Compatibility with
> future official Codex extension versions is not supported.

Filter the official Codex VS Code task list to the active workspace, without
redistributing OpenAI's extension or VSIX.

## Remove the patch and return to the official extension

1. If the **Codex Patch** companion is installed, set
   `codexPatch.repairMode` to `off` first so it cannot reapply the patch.
2. Run **Codex Patch: Restore Official Extension** from the Command Palette,
   or use the last released CLI (Node.js 20 or newer):

   ```bash
   npx --yes --prefer-online codex-vscode-project-patch@0.3.16 restore
   ```

3. Uninstall **Codex Patch** (`cixiangtao.codex-patch`), then run
   **Developer: Reload Window** in VS Code.

To inspect the installation without changing it:

```bash
npx --yes --prefer-online codex-vscode-project-patch@0.3.16 status --json
```

Restore refuses to overwrite an official update or an unrelated local edit.
If it refuses, do not force the old backup onto the current extension. With
the companion disabled or uninstalled, reinstall the official `openai.chatgpt`
extension through VS Code instead.

## Archived project

The compatibility registry is frozen. Compatibility polling, automatic
compatibility pull requests, dependency updates, and npm/VSIX release workflows
have been retired. Already installed companions retain their existing behavior
until disabled or uninstalled; repository archival does not turn them off.

The last npm CLI release is `0.3.16`. Source, tags, and release artifacts are
retained; no new releases are planned. Issues and pull requests are no longer
maintained. Forks may continue independently under the MIT license.

See the [full documentation](https://github.com/cixiangtao/codex-vscode-project-patch/blob/main/.github/README.md),
[contribution guide](https://github.com/cixiangtao/codex-vscode-project-patch/blob/main/CONTRIBUTING.md),
and [security policy](https://github.com/cixiangtao/codex-vscode-project-patch/security/policy).

MIT licensed. This is an unofficial project and is not affiliated with or
endorsed by OpenAI.
