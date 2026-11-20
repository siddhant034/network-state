export type ConnectionStatus = "online" | "offline" | "unstable" | "unknown";
export type EventKind = "status" | "latency" | "request" | "info" | "warning" | "error";

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  effectiveType: string | null;
  downlinkMbps: number | null;
  rttMs: number | null;
  saveData: boolean | null;
  since: number;
}

export interface NetworkEvent {
  id: string;
  kind: EventKind;
  title: string;
  detail: string;
  timestamp: number;
}

export interface RequestFailure {
  id: string;
  url: string;
  method: string;
  reason: string;
  timestamp: number;
}

export interface NetworkState {
  connection: ConnectionSnapshot;
  events: NetworkEvent[];
  failures: RequestFailure[];
  consecutiveFailures: number;
}

export interface MonitorOptions {
  maxEvents?: number;
  maxFailures?: number;
  unstableAfterFailures?: number;
}

export interface NetworkMonitor {
  getSnapshot(): NetworkState;
  subscribe(listener: (state: NetworkState) => void): () => void;
  start(): void;
  stop(): void;
  recordRequestFailure(failure: Omit<RequestFailure, "id" | "timestamp"> & { timestamp?: number }): void;
  recordRequestSuccess(): void;
}