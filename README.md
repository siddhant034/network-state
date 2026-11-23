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
- A downloadable, versioned diagnostics snapshot with bounded event, probe, latency, and reliability history.
- Up to ten named network-lab configs saved locally and replayed on demand, with endpoint and workload settings validated before storage.
- Portable JSON export/import for saved lab configs, with bounded file size, schema validation, name-based merge, and no automatic execution.
- Request instrumentation distinguishes HTTP errors, transport failures, timeouts, and aborts while preserving original request behavior.

## Development

```bash
npm install
npm run dev
```

Run checks:

```bash
npm test
npm run build
```

## Browser API limitations

- `navigator.onLine` is a hint about network connectivity, not proof that the internet or a specific service is reachable.
- The Network Information API is not supported in every browser. Effective type, downlink, RTT, and data-saver values are optional and may be absent.
- The browser does not expose a universal API for observing every failed request made by every page script. Network State can observe Fetch and XMLHttpRequest only after the user explicitly enables instrumentation; other transports and requests made before enablement are not captured.
- RTT and downlink values are estimates supplied by the browser, not measurements produced by this application.

## Privacy

The app runs diagnostics locally. It does not transmit connection information or request history to an analytics backend. Reachability probes are GET requests with browser credentials omitted, no referrer, and cache disabled. The configured endpoint is not copied into the diagnostic event history; only a generic probe label and outcome are retained locally. A custom cross-origin endpoint must allow this site through CORS. Any HTTP response (including 4xx/5xx) confirms that the endpoint responded; non-2xx responses are shown separately from network failures.

Fetch/XHR instrumentation is off by default and starts only after an explicit user action. It never reads request or response bodies, headers, cookies, or query strings; URL fragments are also removed. The origin and path are retained locally for diagnosis, and paths can themselves contain identifiers, so enable instrumentation only on pages where that is acceptable. Uninstalling instrumentation restores the original methods and removes listeners for pending XHR requests. Latency history stores only response duration, timestamp, and source in a bounded 240-sample in-memory buffer. Reliability history stores only timestamp, source, and outcome in a bounded 500-observation in-memory buffer. Incident correlation derives from those normalized observations and browser connectivity events; it does not add request URLs, headers, or bodies. Both histories are cleared when the page is reloaded. The Export snapshot control creates a local JSON download only; it omits request URLs/paths, query strings, fragments, free-form event details, and testing-lab endpoint configurations/results. Review the downloaded report before sharing it. Named testing-lab configs are saved only after an explicit Save action and remain in this browser's local storage; they include full endpoint URLs (including paths and query strings) to support replay. Do not save URLs containing secrets, and delete saved configs on shared devices. Saving configs does not run requests; loading a config restores its settings for review before the user starts a run. Exported config JSON also contains full endpoint URLs. Import is limited to 1 MB, validates the schema and endpoint/workload bounds, merges by config name, and fails atomically if the ten-config limit would be exceeded. Imported configs are stored locally and never run automatically; review them before replay. The network testing lab sends credential-free GET requests only to endpoints the user enters, with a maximum of six concurrent requests and ten scheduled checks per endpoint per run, with up to two retries per check. It retains only the endpoint host label, result status, timing, and attempt count in its visible run history; endpoint paths and query strings are not copied into result records. Optional latency and failure simulation is applied only inside the lab runner and does not throttle or modify browser-wide traffic. A configured retry budget can increase actual HTTP attempts beyond the scheduled-check count. Use only endpoints you own or are authorized to test; cross-origin endpoints must allow this site through CORS.

## Architecture

- `src/core`: browser-independent state model and monitoring contract.
- `src/adapters`: reachability probes, opt-in Fetch/XHR instrumentation, bounded network-lab execution, validated local config persistence, and portable config transfer.
- `src/analytics`: bounded response-time and reliability histories, percentile summaries, availability rates, recovery calculations, incident correlation, chart coordinates, and privacy-filtered diagnostics export.
- `src/components`: accessible reliability and incident-investigation presentation.
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
- [x] Exportable diagnostics snapshot (versioned JSON, bounded histories, destination/detail redaction)
- [x] Network testing lab: repeatable endpoint comparisons, bounded concurrency, retries, and client-side latency/failure simulation
- [x] Save and replay named testing-lab configurations (explicit local save, versioned storage, bounded count, validated load/delete)
- [ ] Cross-browser verification and accessible interaction polish
- [ ] Public demo deployment

## License

MIT