# Browser smoke tests

Run the real-browser smoke suite locally:

```sh
npm install
npx playwright install chromium firefox webkit
npm run test:e2e
# Run only the iPhone WebKit touch smoke test
npm run test:e2e -- --project=webkit-iphone
```

Playwright runs the desktop suite in Chromium, Firefox, and WebKit. A separate
`webkit-iphone` project uses Playwright's iPhone 13 device profile to exercise
mobile Safari-style viewport and touch behavior. The browser workflow runs four
independent jobs: the three desktop engines plus the iPhone WebKit project. It
installs the WebKit engine once per job and reports each project independently.

The Vitest suite remains the fast unit/component check; these tests exercise
browser storage, keyboard interactions, and mobile touch behavior in actual
browser engines.

The suite uses reserved `.test` hostnames and never presses **Run test**. It
checks saved-config persistence and same-origin cross-tab save, delete, clear,
and malformed-storage recovery, keyboard confirmation focus and cancellation,
import preview privacy, and a 320px mobile viewport check for saved-config
controls and horizontal overflow. The iPhone project additionally verifies
coarse-pointer/touch support, a 390×844 emulated screen, no horizontal overflow,
and saving/loading a config through touch taps. The iPhone device profile reports a 390×844 emulated screen; WebKit's `window.innerHeight` may be smaller while browser chrome is reserved. The test checks the emulated screen height and bounds the effective layout viewport instead of assuming they are identical. Cross-tab clear removes the saved
list in other open tabs without exposing endpoint paths or query values. When
another tab writes malformed storage, the receiving tab preserves its last
valid list and shows a generic error without exposing raw storage or endpoint
details. Delete and clear confirmations focus Cancel first and restore focus to
their trigger after Escape. Import preview focuses Cancel first and returns
focus to the file input after Escape or Apply import.

Saved endpoint URLs remain in local storage and are not printed into the
preview. The import fixture is only written to local storage after explicit
**Apply import** confirmation. Imported configs never run automatically.

A failure in one engine/project does not cancel the other matrix jobs, so CI
reports browser-specific compatibility results rather than hiding later
failures. All mobile fixtures use reserved `.test` endpoints; the touch test
only saves and loads browser-local settings and does not issue a diagnostic
request.
