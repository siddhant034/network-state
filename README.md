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
- A responsive dashboard with a manual same-origin connectivity check.

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
- The browser does not expose a universal API for observing every failed request made by every page script. The monitor accepts explicit request outcomes from integrations; automatic interception is not implied.
- RTT and downlink values are estimates supplied by the browser, not measurements produced by this application.

## Privacy

The app runs diagnostics locally. It does not transmit connection information or request history to an analytics backend.

## Architecture

- `src/core`: browser-independent state model and monitoring contract.
- `src/App.tsx`: React dashboard and user interactions.
- `src/styles.css`: responsive visual system.

The core is intentionally framework-agnostic so it can be reused by a browser extension, a React app, or another UI.

## Roadmap

- [x] Connectivity state and event timeline foundation
- [x] Request failure ingestion and instability heuristic
- [ ] Reliable active reachability probe with configurable endpoint
- [ ] Fetch/XHR integration adapter with opt-in instrumentation
- [ ] Latency history and trend visualization
- [ ] Exportable diagnostics snapshot
- [ ] Cross-browser verification and accessible interaction polish
- [ ] Public demo deployment

## License

MIT