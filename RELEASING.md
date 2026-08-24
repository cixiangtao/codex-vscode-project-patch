# Release contract

The canonical public repository is
`https://github.com/cixiangtao/codex-vscode-project-patch`. GitHub Actions is the
only publication authority; local commands validate and pack but never publish.

- **Version owner:** `package.json`
- **Version policy:** Semantic Versioning
- **Release gate:** `pnpm release:check`
- **Package artifact:** `.artifacts/*.tgz`, produced by `pnpm pack:check`
- **Companion artifact:** `.artifacts/codex-patch.vsix`, produced by
  `pnpm vscode:package` (the embedded manifest retains its exact version)
- **Runtime support:** Node.js 20 and newer
- **Build runtime:** Node.js 24.11 or newer
- **Publication authority:** `.github/workflows/release.yml` on GitHub Actions
- **Local publication:** not supported; local commands validate and pack only

The npm CLI and Codex Patch extension have independent manifests, versions,
tags, and delivery workflows. Do not bump or publish one product merely because
the other changed.

## Codex Patch extension release

- **Version owner:** `packages/vscode/package.json`
- **Tag:** `codex-patch-v<version>`
- **Marketplace identity:** `cixiangtao.codex-patch`
- **Publication authority:** `.github/workflows/release-vscode.yml`
- **Credential boundary:** `VSCE_PAT` in the protected
  `vscode-marketplace` GitHub environment
- **GitHub Release:** non-latest release containing the verified VSIX and
  checksum

To release an admitted version from `main`, run **Release Codex Patch
extension** with the exact manifest version. The workflow reruns the complete
repository gate, packages and inspects the VSIX, creates or verifies the
product-specific tag, publishes through `vsce`, downloads the public
Marketplace artifact, compares its extension payload, and then creates the
GitHub Release.

The current stable `@vscode/vsce` publisher uses a Marketplace PAT. Scope it to
Marketplace management, store it only in the protected environment, and rotate
it before Microsoft's global PAT retirement deadline. Migrate the workflow to
short-lived trusted publishing when that support is available in a stable
`@vscode/vsce` release and the publisher policy has been configured.

## Automated compatibility release

1. The scheduled compatibility workflow validates an unknown official macOS
   build and increments the package patch version.
2. It commits the constrained update to an automation branch, opens a pull
   request, explicitly runs every required CI check, and squash-merges only
   after branch protection accepts it.
3. It dispatches `Release npm package` against the exact merge commit and waits
   for completion.
4. The release workflow re-runs the release gate, verifies the version and
   commit, creates or verifies `v<version>`, publishes the packed tarball, and
   creates a GitHub Release with the tarball and checksum.
5. The release succeeds only after a fresh public npm command works and the npm
   tarball, GitHub Release tarball, checksum, and tag commit all agree.

## Manual recovery

If automation fails after its pull request has merged, rerun `Release npm
package` manually with the exact version in `package.json`. The workflow's
identity and retry checks prevent a conflicting tag or artifact from being
accepted.

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
