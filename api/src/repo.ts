import { db, type Deployment, type LogRow } from "./db.js";
import { randomUUID } from "node:crypto";

const insertDeployment = db.prepare(`
  INSERT INTO deployments
    (id, name, status, source_type, source_ref, image_tag, container_id, container_name, port, url, error, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
`);

const updateDeployment = db.prepare(`
  UPDATE deployments
  SET status = COALESCE(?, status),
      image_tag = COALESCE(?, image_tag),
      container_id = COALESCE(?, container_id),
      container_name = COALESCE(?, container_name),
      port = COALESCE(?, port),
      url = COALESCE(?, url),
      error = ?,
      updated_at = ?
  WHERE id = ?
`);

const selectDeployment = db.prepare(`SELECT * FROM deployments WHERE id = ?`);
const selectAllDeployments = db.prepare(
  `SELECT * FROM deployments ORDER BY created_at DESC`,
);
const deleteDeployment = db.prepare(`DELETE FROM deployments WHERE id = ?`);

const insertLog = db.prepare(`
  INSERT INTO logs (deployment_id, ts, stream, level, line)
  VALUES (?, ?, ?, ?, ?)
`);
const selectLogs = db.prepare(`
  SELECT * FROM logs
  WHERE deployment_id = ? AND id > ?
  ORDER BY id ASC
  LIMIT 5000
`);

export function createDeployment(input: {
  name: string;
  sourceType: "git" | "upload";
  sourceRef: string;
}): Deployment {
  const id = shortId();
  const now = Date.now();
  insertDeployment.run(
    id,
    input.name,
    "pending",
    input.sourceType,
    input.sourceRef,
    now,
    now,
  );
  return getDeployment(id)!;
}

export function getDeployment(id: string): Deployment | null {
  const row = selectDeployment.get(id) as Deployment | undefined;
  return row ?? null;
}

export function listDeployments(): Deployment[] {
  return selectAllDeployments.all() as Deployment[];
}

export function patchDeployment(
  id: string,
  patch: Partial<Pick<Deployment,
    | "status"
    | "image_tag"
    | "container_id"
    | "container_name"
    | "port"
    | "url"
    | "error"
  >>,
) {
  updateDeployment.run(
    patch.status ?? null,
    patch.image_tag ?? null,
    patch.container_id ?? null,
    patch.container_name ?? null,
    patch.port ?? null,
    patch.url ?? null,
    patch.error ?? null,
    Date.now(),
    id,
  );
}

export function removeDeployment(id: string) {
  deleteDeployment.run(id);
}

export function appendLog(input: {
  deploymentId: string;
  stream: "build" | "run" | "system";
  level: "info" | "error" | "system";
  line: string;
}): LogRow {
  const ts = Date.now();
  const result = insertLog.run(
    input.deploymentId,
    ts,
    input.stream,
    input.level,
    input.line,
  );
  return {
    id: Number(result.lastInsertRowid),
    deployment_id: input.deploymentId,
    ts,
    stream: input.stream,
    level: input.level,
    line: input.line,
  };
}

export function readLogsSince(
  deploymentId: string,
  sinceId: number,
): LogRow[] {
  return selectLogs.all(deploymentId, sinceId) as LogRow[];
}

function shortId() {
  // 8 chars from a UUID, readable and DNS-safe.
  return randomUUID().replace(/-/g, "").slice(0, 8);
}
