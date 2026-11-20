# Release readiness checklist

This checklist is intentionally separate from feature completion. A passing CI run is necessary, but it does not by itself mean the public demo is ready.

## 1. Integrate the stacked work

- [ ] Review and merge the feature stack in dependency order, beginning with PR #1.
- [ ] After each predecessor is merged, retarget the next stacked PR to `main` and confirm its diff contains only the remaining change.
- [ ] Re-run the required checks on the resulting `main` head.
- [ ] Do not merge a child branch while its base feature is still unmerged.

## 2. Reproducible dependencies and security

- [ ] Commit the generated npm lockfile and switch every CI install step from `npm install` to `npm ci`.
- [ ] Keep the dependency audit gate enabled; release requires a clean audit.
- [ ] Review Dependabot updates and GitHub Actions updates before merging them.
- [ ] Run the production build and unit tests using Node.js 22.12.0 or newer.
- [ ] Re-check the dependency audit immediately before tagging a release.

The dependency baseline workflow currently captures the resolved lockfile and `npm audit --json` output as a short-lived artifact. The lockfile must still be committed to the repository before release so future installs use the exact reviewed dependency tree.

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

The repository already contains `.github/workflows/pages.yml`, but the Pages site must be enabled in repository settings before the workflow can deploy.

1. Open **Settings → Pages** in the repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Merge the release-ready changes to `main`.
4. Confirm the Pages build and deployment workflow completes successfully.
5. Open the exact deployment URL reported by the workflow and verify the dashboard, assets, refresh/deep-link behavior, and base path.
6. Re-run the browser smoke checks against the published URL, not only the local Vite development server.

Do not announce a public demo until the deployment URL has been opened and verified successfully.

## 6. Publish

- [ ] Update the product status, capabilities, known limitations, and setup instructions in the README.
- [ ] Add release notes and a version tag.
- [ ] Verify the final `main` commit, CI run, dependency audit, and Pages deployment all refer to the same release commit.
- [ ] Only then mark Network State ready for final review.
