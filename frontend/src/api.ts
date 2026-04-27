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

export type LogEvent = {
  id: number;
  ts: number;
  stream: "build" | "run" | "system";
  level: "info" | "error" | "system";
  line: string;
};

const base = "/api";

export async function listDeployments(): Promise<Deployment[]> {
  const res = await fetch(`${base}/deployments`);
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return res.json();
}

export async function getDeployment(id: string): Promise<Deployment> {
  const res = await fetch(`${base}/deployments/${id}`);
  if (!res.ok) throw new Error(`get failed: ${res.status}`);
  return res.json();
}

export async function createFromGit(
  gitUrl: string,
  name?: string,
): Promise<Deployment> {
  const res = await fetch(`${base}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gitUrl, name }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  return res.json();
}

export async function uploadTarGz(
  file: File,
  name?: string,
): Promise<Deployment> {
  const fd = new FormData();
  fd.append("file", file);
  if (name) fd.append("name", name);
  const res = await fetch(`${base}/deployments`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}

export async function redeploy(id: string): Promise<Deployment> {
  const res = await fetch(`${base}/deployments/${id}/redeploy`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`redeploy failed: ${res.status}`);
  return res.json();
}

export async function deleteDeployment(id: string): Promise<void> {
  const res = await fetch(`${base}/deployments/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}
