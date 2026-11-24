# Release readiness checklist

This checklist separates automated MVP readiness from the remaining human review required before a formal versioned release.

## 1. Integrate the saved-config work

- [x] Integrate portable saved-config JSON export/import, strict validation, privacy-safe preview, and explicit apply in PR #97.
- [x] Integrate delete/clear confirmations and keyboard focus handling in PR #97.
- [x] Stabilize the import-preview Escape test in PR #98.
- [x] Close the older stacked draft PRs (#59–#65 and #70) as superseded after the current-main integration merged.
- [x] Re-run required checks on the resulting main head.

The older PR stack was based on divergent feature branches and was not merged wholesale. The equivalent changes were applied to current main and validated there.

## 2. Reproducible dependencies and security

- [x] The committed package-lock.json is used by CI and Pages with npm ci.
- [x] The dependency audit gate is enabled; the latest verified main CI run passed.
- [x] Workflow actions are pinned to full commit SHAs and workflow permission checks are enforced.
- [x] Production build and unit tests pass on Node.js 22.
- [ ] Review future Dependabot and GitHub Actions updates before merging them; this is ongoing maintenance.

## 3. Browser and accessibility verification

- [x] Playwright passed on main commit 475bc14a421a9d5d33868253df4cbdda7609c884 in Chromium, Firefox, WebKit, and the iPhone WebKit project.
- [x] Saved-config import/export, delete/clear confirmation, Escape cancellation, focus restoration, and no-auto-run behavior have unit and browser coverage.
- [x] The automated axe-core baseline checks WCAG 2.0 A/AA, WCAG 2.1 A/AA, WCAG 2.2 AA, and selected best-practice rules.
- [ ] Before a formal accessibility certification or versioned release, manually review screen-reader output, keyboard-only navigation beyond the covered flows, color contrast, zoom/reflow, and reduced-motion behavior.

Automated browser and axe checks are a smoke baseline, not a formal WCAG conformance audit.

## 4. Privacy and operational behavior

- [x] The published-site verifier checks the deployed HTML, JavaScript, CSS, responsive resource references, and same-origin dependency policy.
- [x] Fetch/XHR instrumentation remains off by default and is explicitly opt-in.
- [x] Diagnostics export redacts URL paths by default and omits credentials, headers, cookies, bodies, query strings, and fragments.
- [x] Imported diagnostic snapshots remain read-only and separate from live telemetry.
- [x] Saved lab configs remain local, bounded to ten, and have query strings/fragments stripped before persistence.
- [x] Portable saved-config import is limited to 1 MB, schema/workload validated, previewed without endpoint URLs, and applied only after explicit confirmation; imported configs never run automatically.
- [x] README describes browser API, CORS, local-storage, and endpoint-path limitations.

## 5. GitHub Pages deployment

- [x] GitHub Pages is enabled with GitHub Actions as the source.
- [x] The Pages build and deployment succeeded for main commit 475bc14a421a9d5d33868253df4cbdda7609c884.
- [x] The post-deployment resource smoke test passed at https://siddhant034.github.io/network-state/, confirming the page and same-origin assets load.
- [ ] The live Chromium core-flow smoke job is added in PR #99; its post-merge run must pass before final website review.

The Pages workflow deploys only main. The live browser smoke is designed to exercise the published URL itself: refresh/base-path loading, private import preview and cancellation, explicit import, export download, delete/clear confirmations, and no unintended third-party requests.

## 6. Publish

- [x] README status, capabilities, setup, limitations, and privacy documentation are updated.
- [ ] Release notes and a version tag are intentionally deferred until final code/website review and the manual accessibility review above.

## CI resource hygiene

CI cancels superseded runs for the same pull request or branch so stale browser matrices do not consume runners after newer code is pushed. Always verify the latest commit's run; a cancelled older run is not evidence that the current head passed.

## Workflow action pin enforcement

CI runs a dependency-free verifier over every YAML workflow under .github/workflows. Third-party actions must use a full 40-character commit SHA; local composite actions (./...) are allowed. The verifier and its tests run in pull-request CI and again before the Pages build. This prevents a reviewed workflow from silently reverting to mutable action tags.

## Least-privilege workflow permissions

CI audits workflow token permissions and rejects broad presets, workflow-level grants beyond contents: read, and pull_request_target. Job-level permission mappings are checked as complete sets: read-only contents: read is permitted for build jobs, while write access is limited to the Pages deploy job's exact pages: write and id-token: write grants. Duplicate and unsupported entries fail the audit. The policy scanner and its tests run in PR CI and before the Pages build; unsupported syntax must fail closed rather than be skipped. The trigger audit checks the complete top-level on block, including block-sequence event lists and flow-style event collections, so pull_request_target cannot evade the policy by changing YAML representation. YAML anchors, aliases, and merge keys are rejected inside this block because the dependency-free scanner cannot safely resolve their effective event set; use explicit event declarations instead. The scanner also requires exactly one non-empty top-level on block and rejects scalar or ambiguous trigger forms, preventing a workflow from passing the audit without an auditable event declaration.

## GitHub Actions supply-chain maintenance

- Workflow actions are pinned to full commit SHAs, with the upstream release tag retained in a comment for reviewability.
- When updating an action, verify the release tag in the action's official repository, resolve it to its commit SHA, review the upstream changelog and permissions, then update the SHA and version comment together.
- Do not replace a SHA pin with a mutable version tag. Run the complete CI and Pages artifact preflight after every action update.
