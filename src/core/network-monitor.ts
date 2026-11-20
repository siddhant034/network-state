import type {
  ConnectionSnapshot,
  MonitorOptions,
  NetworkEvent,
  NetworkMonitor,
  NetworkState,
  RequestFailure
} from "./types";

type NetworkInformationLike = EventTarget & {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

type NavigatorWithConnection = Navigator & { connection?: NetworkInformationLike; mozConnection?: NetworkInformationLike; webkitConnection?: NetworkInformationLike };

const now = () => Date.now();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `event-${now()}-${Math.random().toString(36).slice(2)}`;

function readConnection(status: ConnectionSnapshot["status"], since: number): ConnectionSnapshot {
  const nav = navigator as NavigatorWithConnection;
  const info = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  return {
    status,
    effectiveType: info?.effectiveType ?? null,
    downlinkMbps: typeof info?.downlink === "number" ? info.downlink : null,
    rttMs: typeof info?.rtt === "number" ? info.rtt : null,
    saveData: typeof info?.saveData === "boolean" ? info.saveData : null,
    since
  };
}

export function createNetworkMonitor(options: MonitorOptions = {}): NetworkMonitor {
  const maxEvents = options.maxEvents ?? 80;
  const maxFailures = options.maxFailures ?? 30;
  const unstableAfterFailures = options.unstableAfterFailures ?? 3;
  const listeners = new Set<(state: NetworkState) => void>();
  const initialStatus = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
  let state: NetworkState = {
    connection: readConnection(initialStatus, now()),
    events: [],
    failures: [],
    consecutiveFailures: 0
  };
  let started = false;
  let connectionInfo: NetworkInformationLike | undefined;

  const publish = () => {
    for (const listener of listeners) listener(state);
  };

  const addEvent = (kind: NetworkEvent["kind"], title: string, detail: string, timestamp = now()) => {
    const event: NetworkEvent = { id: makeId(), kind, title, detail, timestamp };
    state = { ...state, events: [event, ...state.events].slice(0, maxEvents) };
    publish();
  };

  const setStatus = (status: ConnectionSnapshot["status"], title: string, detail: string) => {
    if (state.connection.status === status) return;
    const timestamp = now();
    state = {
      ...state,
      connection: readConnection(status, timestamp),
      consecutiveFailures: status === "online" ? 0 : state.consecutiveFailures
    };
    addEvent(status === "offline" ? "warning" : "status", title, detail, timestamp);
  };

  const handleOnline = () => {
    state = { ...state, consecutiveFailures: 0 };
    setStatus("online", "Connection restored", "The browser reports that the network is reachable again.");
  };
  const handleOffline = () => setStatus("offline", "Connection lost", "The browser reports navigator.onLine = false.");
  const handleConnectionChange = () => {
    const next = readConnection(state.connection.status, state.connection.since);
    state = { ...state, connection: next };
    addEvent("info", "Connection characteristics changed", describeConnection(next));
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (started || typeof window === "undefined") return;
      started = true;
      const nav = navigator as NavigatorWithConnection;
      connectionInfo = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      connectionInfo?.addEventListener("change", handleConnectionChange);
      addEvent("info", "Monitoring started", "Listening for browser connectivity and connection-quality changes.");
    },
    stop() {
      if (!started || typeof window === "undefined") return;
      started = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      connectionInfo?.removeEventListener("change", handleConnectionChange);
      connectionInfo = undefined;
      addEvent("info", "Monitoring paused", "Browser network event listeners have been removed.");
    },
    recordRequestFailure(failure) {
      const timestamp = failure.timestamp ?? now();
      const item: RequestFailure = { ...failure, id: makeId(), timestamp };
      const consecutiveFailures = state.consecutiveFailures + 1;
      state = {
        ...state,
        failures: [item, ...state.failures].slice(0, maxFailures),
        consecutiveFailures
      };
      addEvent("error", "Request failed", `${item.method.toUpperCase()} ${item.url} — ${item.reason}`, timestamp);
      if (consecutiveFailures >= unstableAfterFailures && state.connection.status !== "offline") {
        setStatus("unstable", "Connection looks unstable", `${consecutiveFailures} consecutive request failures were observed.`);
      }
    },
    recordRequestSuccess() {
      if (state.consecutiveFailures === 0) return;
      state = { ...state, consecutiveFailures: 0 };
      if (state.connection.status === "unstable") {
        setStatus("online", "Connection recovered", "A successful request was observed after consecutive failures.");
      } else {
        publish();
      }
    }
  };
}

function describeConnection(connection: ConnectionSnapshot): string {
  const parts = [
    connection.effectiveType ? connection.effectiveType.toUpperCase() : null,
    connection.downlinkMbps !== null ? `${connection.downlinkMbps} Mbps downlink` : null,
    connection.rttMs !== null ? `${connection.rttMs} ms estimated RTT` : null
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "The browser did not expose additional connection information.";
}