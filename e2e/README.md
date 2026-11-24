# Browser smoke tests

Install dependencies and browser engines:

```bash
npm ci
npx playwright install chromium firefox webkit
npm run test:e2e
```

Run only the mobile WebKit flow:

```bash
npm run test:e2e -- --project=webkit-iphone
```

The desktop projects cover Chromium, Firefox, and WebKit. The separate
`webkit-iphone` project uses Playwright's iPhone 13 profile to verify touch
input, a 390×844 emulated screen, responsive bounds, and browser-local saved
configuration save/load.

The mobile smoke test observes an actual `touchstart` on the Save control
rather than treating a successful click as touch coverage. It checks the
coarse-pointer media query and the effective WebKit viewport separately from
the emulated screen height because browser chrome can reduce
`window.innerHeight`.

The desktop dashboard suite also opens two same-origin tabs and verifies
saved-config save/update propagation, corrupt-storage recovery without losing
the last valid list, and cross-tab clear behavior. Storage events do not start
diagnostic requests; the test never presses **Run test**.

All fixtures use reserved `.test` endpoints. The test checks that query
strings are stripped before persistence and never presses **Run test** or
sends a request to the fixture endpoint. It does not prove behavior on a
physical iPhone or iPad; a real-device pass and manual accessibility review
remain release checks.
