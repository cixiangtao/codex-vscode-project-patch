# Changelog

## 0.1.1 - 2026-08-31

- Repair reviewed compatible Codex updates automatically by default while
  preserving explicit `prompt` and `off` modes.
- Retry transient compatibility-registry failures and force-refresh stale data
  before classifying an updated Codex bundle.
- Report unavailable compatibility data as waiting instead of incorrectly
  implying that the official extension was modified.
- Include the companion version in status output and document local VSIX
  installation while Marketplace distribution is unavailable.

## 0.1.0 - 2026-08-24

- Detect official Codex extension updates and recheck the workspace filter.
- Prompt for repair by default, with optional automatic repair for reviewed
  compatible bundles.
- Keep unknown, modified, ambiguous, and unsupported bundles unchanged.
- Provide status, check, repair, restore, and extension-host restart actions.
