# Release contract

This repository is configured for local validation but is not yet connected to
a public GitHub repository or npm trusted publisher.

- **Version owner:** `package.json`
- **Version policy:** Semantic Versioning
- **Release gate:** `pnpm release:check`
- **Package artifact:** `.artifacts/*.tgz`, produced by `pnpm pack:check`
- **Runtime support:** Node.js 20 and newer
- **Build runtime:** Node.js 24.11 or newer
- **Publication authority:** GitHub Actions only, after the repository and npm
  trusted-publishing identity are configured
- **Local publication:** not supported; local commands validate and pack only

Before enabling publication:

1. Create the canonical GitHub repository and add its real repository, issues,
   and homepage metadata to `package.json`.
2. Enable branch protection or a ruleset requiring the CI checks on `main`.
3. Enable GitHub private vulnerability reporting.
4. Confirm ownership and availability of the npm package name.
5. Configure npm trusted publishing for the exact GitHub repository and release
   workflow.
6. Add one explicit Actions-owned release entry point. Do not publish on every
   branch push and do not keep a competing local `npm publish` path.
7. Verify the registry artifact and a fresh `npx` consumer after publication.
