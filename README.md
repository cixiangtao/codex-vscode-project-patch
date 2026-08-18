# codex-vscode-project-patch

Filter the official Codex VS Code task list to the active workspace, without
redistributing OpenAI's extension or VSIX.

## Use

Requires Node.js 20 or newer and an installed `openai.chatgpt` VS Code extension.

```bash
npx -y codex-vscode-project-patch
```

The default command discovers the extension, checks its version and bundle hash,
creates a verified backup, applies the patch atomically, and verifies the result.
It refuses unknown or ambiguous builds instead of guessing.

After a successful run, reload VS Code:

1. Press `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux.
2. Run `Developer: Reload Window`.
3. Reopen the Codex task list.

Restore the official file at any time:

```bash
npx -y codex-vscode-project-patch restore
```

Inspect the installation without changing it:

```bash
npx -y codex-vscode-project-patch status
npx -y codex-vscode-project-patch status --json
```

Supported extension versions and bundle hashes are deliberately allowlisted.
An official extension update may remove the patch; rerun the same `npx` command.
If the new bundle is unknown, the CLI exits without modifying it.

The repository checks the official macOS ARM64/x64 Marketplace builds every six
hours. A compatible new build is fully validated, committed through a protected
pull request, merged after required CI, and published through the Actions-owned
npm/GitHub Release workflow. Changed request structure or
`ThreadListParams.cwd` semantics stop the automation and create a review issue.

See the [full documentation](https://github.com/cixiangtao/codex-vscode-project-patch/blob/main/.github/README.md),
[contribution guide](https://github.com/cixiangtao/codex-vscode-project-patch/blob/main/CONTRIBUTING.md),
and [security policy](https://github.com/cixiangtao/codex-vscode-project-patch/security/policy).

MIT licensed. This is an unofficial project and is not affiliated with or
endorsed by OpenAI.
