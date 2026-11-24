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

Fetch/XHR instrumentation is off by default and starts only after an explicit user action. It never reads request or response bodies, headers, cookies, or query strings; URL fragments are also removed. The origin and path are retained locally for diagnosis, and paths can themselves contain identifiers, so enable instrumentation only on pages where that is acceptable. Uninstalling instrumentation restores the original methods and removes listeners for pending XHR requests.

## Architecture

- `src/core`: browser-independent state model and monitoring contract.
- `src/adapters`: reachability probes and opt-in Fetch/XHR instrumentation.
- `src/App.tsx`: React dashboard and user interactions.
- `src/styles.css`: responsive visual system.

The core is intentionally framework-agnostic so it can be reused by a browser extension, a React app, or another UI.

## Roadmap

- [x] Connectivity state and event timeline foundation
- [x] Request failure ingestion and instability heuristic
- [x] Reliable active reachability probe with configurable endpoint, interval, and timeout
- [x] Fetch/XHR integration adapter with opt-in instrumentation
- [ ] Latency history and trend visualization
- [ ] Exportable diagnostics snapshot
- [ ] Cross-browser verification and accessible interaction polish
- [ ] Public demo deployment

## License

MIT