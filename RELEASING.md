# Release contract

The canonical public repository is
`https://github.com/cixiangtao/codex-vscode-project-patch`. GitHub Actions is the
only publication authority; local commands validate and pack but never publish.

- **Version owner:** `package.json`
- **Version policy:** Semantic Versioning
- **Release gate:** `pnpm release:check`
- **Package artifact:** `.artifacts/*.tgz`, produced by `pnpm pack:check`
- **Runtime support:** Node.js 20 and newer
- **Build runtime:** Node.js 24.11 or newer
- **Publication authority:** `.github/workflows/release.yml` on GitHub Actions
- **Local publication:** not supported; local commands validate and pack only

## Release procedure

1. Update `package.json` and `pnpm-lock.yaml` to the intended version through a
   reviewed pull request.
2. Wait for all required CI checks on `main` to pass.
3. Run the `Release npm package` workflow manually and enter the exact version
   from `package.json`.
4. The workflow re-runs the release gate, verifies the version and commit,
   creates or verifies `v<version>`, publishes the packed tarball, and creates a
   GitHub Release with the tarball and checksum.
5. Verify npm metadata, provenance, the GitHub Release, and a fresh `npx`
   consumer before announcing the release.

The workflow is retry-aware: an existing tag must point at the same commit, an
existing npm version is skipped, and an existing GitHub Release is updated with
the verified assets. A conflicting tag fails closed.

## npm authentication

Use npm trusted publishing for owner `cixiangtao`, repository
`codex-vscode-project-patch`, workflow file `release.yml`, environment `npm`,
and the `npm publish` action. The workflow grants only `contents: write` and
`id-token: write`.

For the first publication, npm cannot attach a trusted publisher until the
package exists. A short-lived granular publish token may therefore be stored as
the `NPM_TOKEN` repository secret for the bootstrap run only. Immediately after
the first successful release, configure the trusted publisher in npm, delete
that secret, and disallow token-based package publishing. All later releases
use GitHub OIDC and npm provenance.
