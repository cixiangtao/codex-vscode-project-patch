# Release status

This project stopped maintenance on October 20, 2026. No further npm packages,
Codex Patch VSIX builds, compatibility updates, or GitHub Releases are planned.
The last npm CLI release is `0.3.16`; the companion manifest remains at `0.1.1`.
These products retain independent versions. This retirement does not create a
new product version or release.

## Preserved artifacts

The canonical repository is
[https://github.com/cixiangtao/codex-vscode-project-patch](https://github.com/cixiangtao/codex-vscode-project-patch).
Existing source, tags, npm versions, and GitHub Release artifacts are retained
for historical reference and recovery. Use the
[recovery instructions](README.md#remove-the-patch-and-return-to-the-official-extension)
to return to the official extension.

## Retired publication process

GitHub Actions previously owned npm and companion publication. The compatibility
poller and both release workflow definitions have been removed from the active
tree and disabled on GitHub. The Dependabot update configuration has also been
removed. Historical workflow definitions remain available in Git history.

Do not dispatch a release, add compatibility entries, or bump versions as part
of retirement. Local build and packaging commands remain available for people
inspecting the historical source; they do not publish anything.

Independent forks must use their own package, extension, repository, and
publication identities and credentials.
