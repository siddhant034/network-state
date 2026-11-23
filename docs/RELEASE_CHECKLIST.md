# Release readiness checklist

This checklist is intentionally separate from feature completion. A passing CI run is necessary, but it does not by itself mean the public demo is ready.

## 1. Integrate the stacked work

- [ ] Review and merge the feature stack in dependency order, beginning with PR #1.
- [ ] After each predecessor is merged, retarget the next stacked PR to `main` and confirm its diff contains only the remaining change.
- [ ] Re-run the required checks on the resulting `main` head.
- [ ] Do not merge a child branch while its base feature is still unmerged.

## CI resource hygiene

- CI cancels superseded runs for the same pull request or branch so stale browser matrices do not consume runners after newer code is pushed.
- Always verify the latest commit's run; a cancelled older run is not evidence that the current head passed.

## Workflow action pin enforcement

CI runs a dependency-free verifier over every YAML workflow under `.github/workflows`. Third-party actions must use a full 40-character commit SHA; local composite actions (`./...`) are allowed. The verifier and its tests run in pull-request CI and again before the Pages build. This prevents a reviewed workflow from silently reverting to mutable action tags.


## Least-privilege workflow permissions

CI audits workflow token permissions and rejects broad presets, workflow-level grants beyond `contents: read`, and `pull_request_target`. Job-level permission mappings are checked as complete sets: read-only `contents: read` is permitted for build jobs, while write access is limited to the Pages deploy job's exact `pages: write` and `id-token: write` grants. Duplicate and unsupported entries fail the audit. The policy scanner and its tests run in PR CI and before the Pages build; unsupported syntax must fail closed rather than be skipped. The trigger audit checks the complete top-level `on` block, including block-sequence event lists and flow-style event collections, so `pull_request_target` cannot evade the policy by changing YAML representation. YAML anchors, aliases, and merge keys are rejected inside this block because the dependency-free scanner cannot safely resolve their effective event set; use explicit event declarations instead.

## 2. Reproducible dependencies and security

- [ ] Integrate the committed npm lockfile and `npm ci` workflows from PR #14 into `main`.
- [ ] Keep the dependency audit gate enabled; release requires a clean audit.
- [ ] Review Dependabot updates and GitHub Actions updates before merging them.
- [ ] Run the production build and unit tests using Node.js 22.12.0 or newer.
- [ ] Re-check the dependency audit immediately before tagging a release.

PR #14 commits the resolved `package-lock.json` and switches both CI and the Pages build to `npm ci`. Keep this gate open until that change is integrated into `main`; the audit JSON remains available as a short-lived artifact for each CI run.

## 3. Browser and accessibility verification

- [ ] Confirm Playwright passes in Chromium, Firefox, and WebKit on the exact release commit.
- [ ] Manually verify keyboard-only navigation, visible focus, skip navigation, and all interactive controls.
- [ ] Review screen-reader names, roles, status announcements, and form errors.
- [ ] Check WCAG AA contrast for text, controls, charts, and status colors.
- [ ] Verify reduced-motion preferences and narrow/mobile layouts.

Automated axe checks are a smoke baseline, not a substitute for manual accessibility review or a formal WCAG conformance audit.

## 4. Privacy and operational behavior

- [ ] Confirm no third-party requests are made by the published app.
- [ ] Confirm Fetch/XHR instrumentation remains off by default and clearly opt-in.
- [ ] Confirm reports redact URL paths by default and never include credentials, headers, cookies, request bodies, query strings, or fragments.
- [ ] Verify imported snapshots remain read-only and separate from live telemetry.
- [ ] Re-check bounded in-memory retention and local-storage limits.
- [ ] Confirm documentation accurately describes browser API and CORS limitations.

## 5. Enable and verify GitHub Pages

The repository contains `.github/workflows/pages.yml`, but the Pages site must be enabled in repository settings before the workflow can deploy.

1. Open **Settings → Pages** in the repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Merge the release-ready changes to `main`.
4. Confirm the Pages build and deployment workflow completes successfully.
5. Open the exact deployment URL reported by the workflow and verify the dashboard, assets, refresh/deep-link behavior, and base path.
6. Re-run the browser smoke checks against the published URL, not only the local Vite development server.

The Pages workflow now gates artifact upload on unit tests, published-site verifier tests, the production build, the built-artifact preflight, and `npm audit --audit-level=low`. Its deploy job is restricted to `main`; a manual dispatch from a feature branch cannot publish that branch. The post-deployment smoke test remains mandatory because the published host can still differ from the local artifact.

Do not announce a public demo until the deployment URL has been opened and verified successfully.

## 6. Publish

- [ ] Update the product status, capabilities, known limitations, and setup instructions in the README.
- [ ] Add release notes and a version tag.
- [ ] Verify the final `main` commit, CI run, dependency audit, and Pages deployment all refer to the same release commit.
- [ ] Only then mark Network State ready for final review.

## Pre-deployment artifact check

CI runs the same resource-origin and static network-dependency audit against the generated `dist` artifact before the dependency audit and browser matrix finish. This catches broken project-base asset paths, missing build output, and unexpected external resource references before deployment. The Pages workflow also runs the check before uploading its deployment artifact. The post-deployment smoke test remains required.

## GitHub Actions supply-chain maintenance

- Workflow actions are pinned to full commit SHAs, with the upstream release tag retained in a comment for reviewability.
- When updating an action, verify the release tag in the action's official repository, resolve it to its commit SHA, review the upstream changelog and permissions, then update the SHA and version comment together.
- Do not replace a SHA pin with a mutable version tag. Run the complete CI and Pages artifact preflight after every action update.
