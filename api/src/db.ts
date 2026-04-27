import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

const dbPath = `${config.dataDir}/state.sqlite`;
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    image_tag TEXT,
    container_id TEXT,
    container_name TEXT,
    port INTEGER,
    url TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    stream TEXT NOT NULL,
    level TEXT NOT NULL,
    line TEXT NOT NULL,
    FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_logs_deployment ON logs(deployment_id, id);
`);

export type Deployment = {
  id: string;
  name: string;
  status:
    | "pending"
    | "building"
    | "deploying"
    | "running"
    | "failed"
    | "stopped";
  source_type: "git" | "upload";
  source_ref: string;
  image_tag: string | null;
  container_id: string | null;
  container_name: string | null;
  port: number | null;
  url: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type LogRow = {
  id: number;
  deployment_id: string;
  ts: number;
  stream: "build" | "run" | "system";
  level: "info" | "error" | "system";
  line: string;
};
