# Network State

A browser-based network diagnostics tool for monitoring connectivity, detecting unstable connections, tracking request failures, and visualizing network events in real time.

> **Status:** Early development · v0.1

## What it does

Network State turns browser network signals into a readable activity stream. It is designed to answer three practical questions:

- Does the browser currently believe it is online?
- Has the connection become unreliable based on recent request outcomes?
- What changed, and when?

### Current capabilities

- Online/offline transitions from browser events.
- Optional connection characteristics from the Network Information API.
- A framework-agnostic monitoring core with subscriptions.
- Request-failure recording and consecutive-failure instability detection.
- Bounded event and failure history.
- A responsive dashboard with configurable, automatically repeated HTTP reachability probes.
- Separate reporting for successful responses, HTTP errors, timeouts, invalid endpoints, and transport failures.
- Bounded probe deadlines, request cancellation, and credential-free/no-referrer requests.
- Opt-in Fetch and XMLHttpRequest instrumentation with response status, transport, method, and duration.
- Bounded latency history with 5-minute, 30-minute, and 2-hour views, source filters, median, p95, average, and a trend chart.
- HTTP response availability, 2xx success rates, transport-failure rates, and per-source recovery-time analytics.
- A correlated incident timeline that groups overlapping browser, reachability-probe, Fetch, and XHR outages, with source, severity, status, time-window, and text filters.
- A repeatable network testing lab for comparing up to five endpoints with bounded concurrency, per-request timeouts, retries, and explicitly labelled client-side latency/failure simulation.
- Up to ten named network-lab configurations that can be saved, loaded, updated, and deleted locally, with query strings and fragments stripped before persistence.
- Portable JSON diagnostics snapshots and spreadsheet-safe CSV exports covering bounded event, request, probe, latency, reliability, incident, and network-lab histories.
- Validated read-only import of prior snapshots so incident timelines can be reopened without merging historical data into the live session.
- Request instrumentation distinguishes HTTP errors, transport failures, timeouts, and aborts while preserving original request behavior.

## Development

Requires Node.js 22.12.0 or newer. See the [production release checklist](docs/RELEASE_CHECKLIST.md) for dependency, accessibility, privacy, and GitHub Pages release gates.

```bash
npm install
npm run dev
```

Run checks:

```bash
npm test
npm run build
npm run test:e2e
node --test scripts/pages-smoke-test.test.mjs
```

## Long-running session safeguards

Telemetry retained by the live dashboard is deliberately bounded: 80 browser events, 30 request failures, 20 reachability results, 100 visible Fetch/XHR events, 240 latency samples, and 500 reliability observations. The network testing lab also caps endpoint count, concurrency, scheduled checks, retries, and named configurations. A sustained-failure unit test exercises thousands of updates against the core and analytics buffers, while a browser test sends a burst of page requests and verifies the UI retains only its configured request-history limit.

## Cross-browser and accessibility checks

The Playwright suite runs the dashboard in Chromium, Firefox, and WebKit. It covers the initial reachability flow, monitoring controls, saved lab configuration privacy and replay, lab execution, keyboard skip navigation, and diagnostics downloads. An axe-core smoke audit checks WCAG 2.0 A and WCAG 2.1 A rules on the rendered dashboard.

Install the browser binaries before running the suite locally:

```bash
npx playwright install chromium firefox webkit
npm run test:e2e
```

The automated audit is a baseline, not a complete accessibility certification. Manual keyboard and screen-reader review, plus WCAG AA color-contrast verification, remain release checks.

## Browser API limitations

- `navigator.onLine` is a hint about network connectivity, not proof that the internet or a specific service is reachable.
- The Network Information API is not supported in every browser. Effective type, downlink, RTT, and data-saver values are optional and may be absent.
- The browser does not expose a universal API for observing every failed request made by every page script. Network State can observe Fetch and XMLHttpRequest only after the user explicitly enables instrumentation; other transports and requests made before enablement are not captured.
- RTT and downlink values are estimates supplied by the browser, not measurements produced by this application.

## Privacy

The app runs diagnostics locally. It does not transmit connection information or request history to an analytics backend, and it loads no third-party fonts, scripts, images, or analytics resources. Typography uses system font stacks so opening the dashboard does not contact a font CDN. A site-wide `no-referrer` policy also prevents the app URL from being sent as a referrer. The post-deployment smoke check resolves resource-bearing HTML elements, responsive `srcset` candidates, JavaScript/CSS entry assets, and inline CSS against the document's first valid `<base href>` (when present), matching browser URL resolution before validating their origins. Entry asset discovery is limited to script sources and stylesheet/script preload links, so ordinary navigation links are not mistaken for files to fetch. It validates responsive image candidates (including SVG references, embedded objects, `srcset`, and image preloads) against the published origin, while allowing ordinary external navigation links. It scans inline `<style>` blocks, `style` attributes, and fetched CSS `url()`, `@import`, and `image-set()` string candidates for third-party origins after decoding HTML entities and CSS escape sequences in resource identifiers, so escaped function names and host characters cannot bypass the origin check. Literal outbound URLs in JavaScript `fetch()`, XHR `open()`, `WebSocket`, `EventSource`, and `sendBeacon()` calls are checked against the published origin, including inline event-handler code; dynamic user-configured endpoints remain runtime inputs and are not mistaken for hard-coded third-party dependencies. Same-origin JavaScript static imports, re-exports, literal dynamic imports, worker scripts, service-worker registrations, and `importScripts()` dependencies are also fetched and recursively scanned; module URLs must remain HTTPS and same-origin, and unresolved bare or non-literal dynamic imports fail closed. The verifier checks `new URL(asset, import.meta.url)` references for external origins and applies depth, module-count, token, and aggregate byte budgets to prevent unbounded traversal. Same-origin CSS `@import` dependencies are fetched and recursively scanned (with a maximum of five imported stylesheet levels (rejecting a sixth before requesting it), a 20-import cap, bounded response sizes, manually validated same-origin redirects (off-origin redirects are rejected before following), and canonical URL cycle detection that strips fragments from fetch identities and records same-origin redirect destinations to avoid duplicate fetches; resource URLs containing embedded username/password credentials are rejected even when their origin matches) so a clean entry stylesheet cannot hide a third-party request in a nested stylesheet. Ordinary external navigation links are allowed. Reachability probes are GET requests with browser credentials omitted, no referrer, and cache disabled. The configured endpoint is not copied into the diagnostic event history; only a generic probe label and outcome are retained locally. A custom cross-origin endpoint must allow this site through CORS. Any HTTP response (including 4xx/5xx) confirms that the endpoint responded; non-2xx responses are shown separately from network failures.

Fetch/XHR instrumentation is off by default and starts only after an explicit user action. It never reads request or response bodies, headers, cookies, or query strings; URL fragments are also removed. The origin and path are retained locally for diagnosis, and paths can themselves contain identifiers, so enable instrumentation only on pages where that is acceptable. Uninstalling instrumentation restores the original methods and removes listeners for pending XHR requests. Latency history stores only response duration, timestamp, and source in a bounded 240-sample in-memory buffer. Reliability history stores only timestamp, source, and outcome in a bounded 500-observation in-memory buffer. Incident correlation derives from those normalized observations and browser connectivity events; it does not add request URLs, headers, or bodies. Both histories are cleared when the page is reloaded. The network testing lab sends credential-free GET requests only to endpoints the user enters, with a maximum of six concurrent requests and ten scheduled checks per endpoint per run, with up to two retries per check. It retains only the endpoint host label, result status, timing, and attempt count in its visible run history; endpoint paths and query strings are not copied into result records. Optional latency and failure simulation is applied only inside the lab runner and does not throttle or modify browser-wide traffic. A configured retry budget can increase actual HTTP attempts beyond the scheduled-check count. Named lab configurations are stored in this browser's local storage only; up to ten configurations are retained. Query strings and fragments are stripped before saving, but endpoint paths are kept so health-check routes can be replayed and may contain identifiers. Clear saved configurations from the lab UI or clear this site's browser storage to remove them. Use only endpoints you own or are authorized to test; cross-origin endpoints must allow this site through CORS.

Diagnostics exports are generated locally and are not uploaded. URL paths are redacted by default because path segments can contain identifiers; users must explicitly opt in to include paths. Even with that option enabled, credentials, query strings, and fragments are always removed. JSON imports are limited to 1 MB, require the supported schema version, and are validated against bounded record counts before display. Imported sessions are read-only and remain separate from the current live session. Reports include locale and time-zone metadata, but omit user-agent strings and IP addresses. CSV cells are quoted and protected against spreadsheet formula injection.

## Architecture

- `src/core`: browser-independent state model and monitoring contract.
- `src/adapters`: reachability probes, opt-in Fetch/XHR instrumentation, bounded network-lab execution, and validated local configuration persistence.
- `src/analytics`: bounded response-time and reliability histories, percentile summaries, availability rates, recovery calculations, incident correlation, and chart coordinates.
- `src/components`: accessible reliability, incident-investigation, and diagnostics export/import presentation.
- `src/diagnostics`: versioned snapshot creation, URL redaction, bounded import validation, and spreadsheet-safe CSV serialization.
- `src/App.tsx`: React dashboard and user interactions.
- `src/styles.css`: responsive visual system.

The core is intentionally framework-agnostic so it can be reused by a browser extension, a React app, or another UI.

## Roadmap

- [x] Connectivity state and event timeline foundation
- [x] Request failure ingestion and instability heuristic
- [x] Reliable active reachability probe with configurable endpoint, interval, and timeout
- [x] Fetch/XHR integration adapter with opt-in instrumentation
- [x] Latency history and trend visualization (in-memory, bounded, source- and time-filtered)
- [x] Request success/failure rates, HTTP availability, and per-source recovery analytics (bounded, in-memory)
- [x] Correlated incident timeline and investigation filters (source, severity, status, time window, and text)
- [x] Exportable JSON diagnostics snapshot, CSV history, redaction, and validated read-only import
- [x] Network testing lab: repeatable endpoint comparisons, bounded concurrency, retries, and client-side latency/failure simulation
- [x] Save and replay named testing-lab configurations (bounded local storage; query strings and fragments stripped)
- [x] Cross-browser verification (Chromium, Firefox, WebKit) and keyboard/accessibility smoke checks
- [ ] Public demo deployment (GitHub Pages enabled and published-site resource-origin smoke test passing)

## Dependency maintenance

Dependabot checks npm dependencies weekly and GitHub Actions monthly. The committed `package-lock.json` pins the dependency tree used by CI and the Pages build; all automated installs use `npm ci`. Run `npm install` only when intentionally adding or updating dependencies, and commit the resulting lockfile with the manifest. CI uploads a short-lived machine-readable `npm audit` report and fails if any known vulnerability is present.

## License

MIT