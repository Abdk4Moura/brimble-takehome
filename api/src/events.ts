import { EventEmitter } from "node:events";
import type { LogRow } from "./db.js";

// One bus per deployment id. SSE handlers subscribe; the pipeline emits.
const buses = new Map<string, EventEmitter>();

export function busFor(deploymentId: string): EventEmitter {
  let bus = buses.get(deploymentId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(0);
    buses.set(deploymentId, bus);
  }
  return bus;
}

export function emitLog(log: LogRow) {
  busFor(log.deployment_id).emit("log", log);
}

export function emitStatus(deploymentId: string, status: string) {
  busFor(deploymentId).emit("status", { status });
}
