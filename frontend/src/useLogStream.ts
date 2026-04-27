import { useEffect, useRef, useState } from "react";
import type { LogEvent } from "./api";

export type LogLine = LogEvent;

// Wraps EventSource so each component instance owns its connection. We cap
// the in-memory log buffer so the DOM doesn't blow up on long builds.
export function useLogStream(deploymentId: string | null, max = 5000) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setLines([]);
    setStatus(null);
    setConnected(false);
    if (!deploymentId) return;

    const es = new EventSource(`/api/deployments/${deploymentId}/logs`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("log", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as LogLine;
      setLines((prev) => {
        const next = prev.concat(data);
        return next.length > max ? next.slice(next.length - max) : next;
      });
    });
    es.addEventListener("status", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { status: string };
      setStatus(data.status);
    });
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [deploymentId, max]);

  return { lines, status, connected };
}
