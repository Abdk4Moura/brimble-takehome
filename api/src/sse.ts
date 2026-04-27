import type { FastifyReply, FastifyRequest } from "fastify";
import { busFor } from "./events.js";
import { readLogsSince } from "./repo.js";
import type { LogRow } from "./db.js";

export async function streamLogs(
  req: FastifyRequest,
  reply: FastifyReply,
  deploymentId: string,
) {
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Replay history first. The client-supplied Last-Event-ID lets reconnects
  // skip what they already have.
  const lastEventIdHeader = req.headers["last-event-id"];
  const lastIdNum = parseInt(
    typeof lastEventIdHeader === "string" ? lastEventIdHeader : "0",
    10,
  );
  let cursor = Number.isFinite(lastIdNum) ? lastIdNum : 0;

  // Drain in pages of 5000 — see selectLogs LIMIT.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = readLogsSince(deploymentId, cursor);
    if (page.length === 0) break;
    for (const row of page) {
      reply.raw.write(`id: ${row.id}\n`);
      send("log", rowToWire(row));
      cursor = row.id;
    }
    if (page.length < 5000) break;
  }
  send("ready", { cursor });

  const bus = busFor(deploymentId);
  const onLog = (row: LogRow) => {
    if (row.id <= cursor) return;
    reply.raw.write(`id: ${row.id}\n`);
    send("log", rowToWire(row));
    cursor = row.id;
  };
  const onStatus = (s: { status: string }) => send("status", s);

  bus.on("log", onLog);
  bus.on("status", onStatus);

  // Heartbeat keeps proxies from timing the connection out.
  const heartbeat = setInterval(() => {
    reply.raw.write(`: ping ${Date.now()}\n\n`);
  }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    bus.off("log", onLog);
    bus.off("status", onStatus);
  };
  req.raw.on("close", cleanup);
  req.raw.on("error", cleanup);
}

function rowToWire(row: LogRow) {
  return {
    id: row.id,
    ts: row.ts,
    stream: row.stream,
    level: row.level,
    line: row.line,
  };
}
