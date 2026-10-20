# Contributing

This project stopped maintenance on October 20, 2026. Issues, pull requests,
compatibility data, and release requests are no longer reviewed. Independent
forks are welcome under the MIT license. The development notes below are kept
for historical reference and do not describe an active contribution process.

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
pnpm vscode:check
pnpm vscode:package
```

## Pull requests

- Keep each change focused and explain the user-visible behavior.
- Add or update tests when changing discovery, compatibility checks, patching,
  backup, restore, output, or package contracts.
- Keep editor UI in `packages/vscode/src/extension.ts`; guardian policy and the
  compatibility client must remain testable without a running VS Code process.
- Do not duplicate patch or restore logic in the companion extension. Add shared
  behavior to `src/core.ts` and exercise it through both surfaces.
- Keep CLI and extension releases independent. The root manifest owns the npm
  CLI version; `packages/vscode/package.json` owns the Marketplace version.
- Run `pnpm release:check` before requesting review.
- Do not add a newly observed extension build to the allowlist without tracing
  the request bridge, validating the `cwd` contract, and testing a copied
  installation first.
- Do not include an official OpenAI VSIX, extension bundle, or extracted
  proprietary assets in commits, fixtures, issues, or pull requests.

The scheduled compatibility and release workflows have been retired. The
compatibility allowlist is frozen; do not bypass it to target newer builds.

## Reporting compatibility data

For independent forks, use hashes, extension versions, structural anchors, and
reduced synthetic fixtures. Do not upload the official bundle itself. Redact
usernames and local paths from logs before sharing them publicly.
