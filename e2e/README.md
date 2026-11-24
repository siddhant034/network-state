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
checks that saved endpoint URLs remain local, delete cancellation does not
mutate storage, and imported endpoint details are not shown in the preview.
The import fixture is only written to local storage after explicit
**Apply import** confirmation.

A failure in one engine does not cancel the other matrix jobs, so CI reports
browser-specific compatibility results rather than hiding later failures.
