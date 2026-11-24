# Browser smoke tests

Run the real-browser smoke suite locally:

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

CI installs Chromium with its Linux system dependencies and runs this suite on pull
requests and pushes to `main`. The existing Vitest suite remains the fast unit
and component-level check; these tests cover browser storage and keyboard
interaction in an actual Chromium page.

The suite uses reserved `.test` hostnames and never presses **Run test**. It
checks that saved endpoint URLs remain local, that delete cancellation does not
mutate storage, and that imported endpoint details are not shown in the preview.
The import fixture is only written to the page's local storage after explicit
**Apply import** confirmation.
