# Contributing

Thanks for helping improve `codex-vscode-project-patch`.

## Prerequisites

- Node.js 24.11 or newer for development and builds
- pnpm 10.17.1, as pinned in `package.json`
- VS Code only when manually testing extension discovery

The published CLI targets Node.js 20 and newer. Build tooling has a newer Node.js
requirement than the runtime package.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm check
```

Useful focused commands:

```bash
pnpm format
pnpm lint:fix
pnpm typecheck
pnpm test
pnpm build
pnpm pack:check
```

## Pull requests

- Keep each change focused and explain the user-visible behavior.
- Add or update tests when changing discovery, compatibility checks, patching,
  backup, restore, output, or package contracts.
- Run `pnpm release:check` before requesting review.
- Do not add a newly observed extension build to the allowlist without tracing
  the request bridge, validating the `cwd` contract, and testing a copied
  installation first.
- Do not include an official OpenAI VSIX, extension bundle, or extracted
  proprietary assets in commits, fixtures, issues, or pull requests.

Routine macOS compatibility updates are proposed, checked, merged, and released
by the scheduled workflow. Branch protection and all required CI still apply;
the workflow cannot approve or bypass its own checks. A failed scheduled check
is evidence that the patch or protocol needs manual analysis, not a reason to
bypass the allowlist.

## Reporting compatibility data

Hashes, extension versions, structural anchors, and reduced synthetic fixtures
are welcome. Do not upload the official bundle itself. Redact usernames and
local paths from logs before sharing them publicly.
