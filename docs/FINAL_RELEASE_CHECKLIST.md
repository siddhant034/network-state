# Final release checklist

This checklist is the release gate for the public Network State demo. A green unit suite alone is not a release: the shipped static app, browser behavior, and privacy boundaries must be verified.

## Integration and CI

- [ ] Integrate the stacked feature branches into `main` in dependency order; do not merge a child branch before its base changes are present.
- [ ] Keep every merge fast-forward/ancestry-safe and inspect conflicts rather than accepting generated or lockfile conflicts blindly.
- [ ] Run the latest `npm ci`, `npm test`, and `npm run build` on the final `main` commit.
- [ ] Run the full Playwright matrix (Chromium, Firefox, desktop WebKit, and iPhone WebKit) against the exact release commit.
- [ ] Confirm CI workflows have least-privilege permissions, immutable action pins, and deployment only from the intended branch.
- [ ] Confirm the Pages artifact contains the built app and resolves all assets under the configured repository base path.

## Product flows

- [ ] Verify online/offline state and the activity timeline update when browser connectivity changes.
- [ ] Verify active reachability probes distinguish HTTP responses, non-2xx responses, timeouts, invalid endpoints, aborts, and transport failures.
- [ ] Verify Fetch/XHR instrumentation is off by default, requires explicit enablement, and can be cleanly removed.
- [ ] Verify latency, reliability, and incident filters produce consistent results and bounded histories.
- [ ] Verify the network testing lab honors concurrency, timeout, retry, and simulation limits; never run tests against a fixture endpoint.
- [ ] Verify named configs save, load, export, import-preview, apply, delete, and clear correctly; imported configs never run automatically.
- [ ] Verify cross-tab save/delete/clear updates and malformed-storage recovery preserve the last valid state.
- [ ] Verify keyboard focus, Escape cancellation, accessible labels, and screen-reader status messages for destructive and import dialogs.
- [ ] Verify the 320px layout and the iPhone WebKit touch save/load flow without horizontal overflow.

## Privacy and safety

- [ ] Inspect the production bundle and published HTML/CSS for third-party requests, unsafe resource origins, and unexpected inline handlers.
- [ ] Confirm diagnostic snapshots omit endpoint URLs, paths, query strings, fragments, and free-form sensitive details.
- [ ] Confirm saved configs remain browser-local, clearly warn that URLs may contain sensitive values, and are never sent to an analytics backend.
- [ ] Confirm probes use credential-free requests and no referrer, and all test endpoints are reserved `.test` fixtures.
- [ ] Review documentation for accurate browser API limitations and explain that `navigator.onLine` is not proof of internet reachability.

## Production deployment and acceptance

- [ ] Enable GitHub Pages and verify the deployment workflow has the required Pages permissions and environment configuration.
- [ ] Confirm the production build and deployment workflow succeeded for the final `main` SHA; verify the uploaded artifact and deployment URL.
- [ ] Open the actual public site in a clean browser session and confirm it loads without console errors, failed assets, or horizontal overflow.
- [ ] Exercise the core diagnostic, saved-config, and lab flows on the deployed site—not only on localhost or in CI.
- [ ] Complete a manual accessibility/privacy review and at least one physical mobile-device pass; record any known limitations.
- [ ] Update the README status, roadmap, and release notes only after the above gates pass.

## Release decision

Mark the product ready for final review only when all required automated and production gates above pass. Physical-device testing and manual accessibility review must be explicitly recorded; do not imply that emulation substitutes for a real device. If a gate cannot be completed, document the blocker and keep the release status as not ready.
