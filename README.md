# codex-vscode-project-patch

Filter the official Codex VS Code task list to the active workspace, without
redistributing OpenAI's extension or VSIX.

## Use

Requires Node.js 20 or newer and an installed `openai.chatgpt` VS Code extension.

```bash
npx --yes --prefer-online codex-vscode-project-patch@latest
```

The explicit `@latest` selects npm's current release tag, while
`--prefer-online` forces an immediate freshness check. `--yes` only accepts
npm's install prompt; it does not update an already available command by itself.

The default command discovers the extension, checks its version and bundle hash,
creates a verified backup, applies the patch atomically, and verifies the result.
It refuses unknown or ambiguous builds instead of guessing.

After a successful run, reload VS Code:

1. Press `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux.
2. Run `Developer: Reload Window`.
3. Reopen the Codex task list.

Restore the official file at any time:

```bash
npx --yes --prefer-online codex-vscode-project-patch@latest restore
```

Inspect the installation without changing it:

```bash
npx --yes --prefer-online codex-vscode-project-patch@latest status
npx --yes --prefer-online codex-vscode-project-patch@latest status --json
```

Supported extension versions and bundle hashes are deliberately allowlisted.
An official extension update may remove the patch; rerun the same `npx` command.
If the new bundle is unknown, the CLI exits without modifying it.

## Automatic update repair

Visual Studio Marketplace distribution is currently unavailable. From this
repository checkout, build and install the unofficial **Codex Patch** companion:

```bash
pnpm install --frozen-lockfile
pnpm vscode:package
code --install-extension .artifacts/codex-patch.vsix
```

It detects official Codex extension updates, refreshes the reviewed
compatibility registry, and reuses the same fail-closed Core to repair a
compatible clean bundle before the user restarts extensions. Unknown or
modified bundles are never changed.

The default repair mode automatically repairs reviewed Codex updates. Future
compatible updates require only a single **Restart Extensions**.
The CLI remains available for diagnostics, recovery, and headless use.

The repository checks the official macOS ARM64/x64 Marketplace builds every
hour, preferring stable releases over pre-releases. A compatible new build is
fully validated, committed through a protected pull request, merged after
required CI, and published through the Actions-owned
npm/GitHub Release workflow. Changed request structure or
`ThreadListParams.cwd` semantics stop the automation and create a review issue.
The companion extension reads the reviewed registry from `main`, so it receives
new compatibility data without requiring a Marketplace version bump for every
Codex release.

See the [full documentation](https://github.com/cixiangtao/codex-vscode-project-patch/blob/main/.github/README.md),
[contribution guide](https://github.com/cixiangtao/codex-vscode-project-patch/blob/main/CONTRIBUTING.md),
and [security policy](https://github.com/cixiangtao/codex-vscode-project-patch/security/policy).

MIT licensed. This is an unofficial project and is not affiliated with or
endorsed by OpenAI.
