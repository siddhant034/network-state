# Browser smoke tests

Run the real-browser smoke suite locally:

```sh
npm install
npx playwright install chromium firefox webkit
npm run test:e2e
```

Playwright runs the same tests in Chromium, Firefox, and WebKit. The browser
workflow uses a three-browser matrix on pull requests and pushes to `main`,
installing each browser with its required Linux system dependencies. The
Vitest suite remains the fast unit/component check; these tests exercise
browser storage and keyboard interactions in actual browser engines.

The suite uses reserved `.test` hostnames and never presses **Run test**. It
checks saved-config persistence and same-origin cross-tab save, delete, clear, and malformed-storage recovery, keyboard
confirmation focus and cancellation, import preview privacy, and a 320px mobile viewport check for saved-config controls and horizontal overflow. Cross-tab clear removes the saved list in other open tabs without exposing endpoint paths or query values. When another tab writes malformed storage, the receiving tab preserves its last valid list and shows a generic error without exposing raw storage or endpoint details. Delete and clear confirmations focus Cancel first
and restore focus to their trigger after Escape. Import preview focuses Cancel
first and returns focus to the file input after Escape or Apply import.

Saved endpoint URLs remain in local storage and are not printed into the
preview. The import fixture is only written to local storage after explicit
**Apply import** confirmation. Imported configs never run automatically.

A failure in one engine does not cancel the other matrix jobs, so CI reports
browser-specific compatibility results rather than hiding later failures.
