import { useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type Deployment,
  createFromGit,
  deleteDeployment,
  listDeployments,
  redeploy,
  uploadTarGz,
} from "./api";
import { useLogStream } from "./useLogStream";

export function App() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const deployments = useQuery({
    queryKey: ["deployments"],
    queryFn: listDeployments,
    // While anything is mid-flight, poll the list so the status pill keeps up.
    refetchInterval: (query) => {
      const data = query.state.data as Deployment[] | undefined;
      const active = data?.some((d) =>
        ["pending", "building", "deploying"].includes(d.status),
      );
      return active ? 1500 : 5000;
    },
  });

  const createGit = useMutation({
    mutationFn: ({ url, name }: { url: string; name?: string }) =>
      createFromGit(url, name),
    onSuccess: (d) => {
      setSelected(d.id);
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
  });

  const upload = useMutation({
    mutationFn: ({ file, name }: { file: File; name?: string }) =>
      uploadTarGz(file, name),
    onSuccess: (d) => {
      setSelected(d.id);
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDeployment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });

  const redo = useMutation({
    mutationFn: (id: string) => redeploy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });

  // Keep query cache in sync with terminal status events from SSE so the list
  // updates without waiting for the next poll.
  const { lines, status, connected } = useLogStream(selected);
  useEffect(() => {
    if (status) qc.invalidateQueries({ queryKey: ["deployments"] });
  }, [status, qc]);

  const list = deployments.data ?? [];
  const current = useMemo(
    () => list.find((d) => d.id === selected) ?? null,
    [list, selected],
  );

  return (
    <div className="app">
      <h1>brimble-takehome control plane</h1>
      <div className="sub">
        Push code, get a container fronted by Caddy. Logs stream live.
      </div>

      <section className="panel">
        <h2>New deployment</h2>
        <NewDeployForm
          submitting={createGit.isPending || upload.isPending}
          onGit={(url, name) => createGit.mutate({ url, name })}
          onUpload={(file, name) => upload.mutate({ file, name })}
        />

        <h2 style={{ marginTop: 8 }}>Deployments</h2>
        <div className="deps">
          {list.length === 0 && (
            <div className="empty">No deployments yet.</div>
          )}
          {list.map((d) => (
            <DeploymentRow
              key={d.id}
              dep={d}
              selected={d.id === selected}
              onClick={() => setSelected(d.id)}
              onRedeploy={() => redo.mutate(d.id)}
              onDelete={() => {
                if (confirm(`Delete ${d.name}?`)) remove.mutate(d.id);
              }}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{current ? `Logs · ${current.name}` : "Logs"}</h2>
          <div className="row" style={{ gap: 8 }}>
            {current && (
              <span className="image-tag">
                {current.image_tag ?? "(no image yet)"}
              </span>
            )}
            <span
              className="image-tag"
              title="SSE connection"
              style={{ color: connected ? "var(--accent)" : "var(--muted)" }}
            >
              {selected ? (connected ? "● live" : "○ idle") : ""}
            </span>
          </div>
        </div>
        <LogPane selectedId={selected} lines={lines} />
      </section>
    </div>
  );
}

function NewDeployForm(props: {
  submitting: boolean;
  onGit: (url: string, name?: string) => void;
  onUpload: (file: File, name?: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="col">
      <div className="col">
        <label className="image-tag">Git URL</label>
        <input
          type="url"
          placeholder="https://github.com/your/repo.git"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="col">
        <label className="image-tag">Name (optional)</label>
        <input
          type="text"
          placeholder="my-app"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="row">
        <button
          className="primary"
          disabled={!url || props.submitting}
          onClick={() => props.onGit(url.trim(), name.trim() || undefined)}
        >
          Deploy from Git
        </button>
        <button
          disabled={props.submitting}
          onClick={() => fileRef.current?.click()}
        >
          Upload .tar.gz
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".tar.gz,.tgz,application/gzip,application/x-gzip,application/x-tar"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onUpload(f, name.trim() || undefined);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function DeploymentRow(props: {
  dep: Deployment;
  selected: boolean;
  onClick: () => void;
  onRedeploy: () => void;
  onDelete: () => void;
}) {
  const { dep } = props;
  return (
    <div
      className={`dep ${props.selected ? "selected" : ""}`}
      onClick={props.onClick}
    >
      <div className="row-foot">
        <span className="name">{dep.name}</span>
        <span className={`status ${dep.status}`}>{dep.status}</span>
      </div>
      <div className="meta">
        {dep.source_type === "git" ? dep.source_ref : "(uploaded)"}
      </div>
      <div className="row-foot">
        {dep.url ? (
          <a
            className="url-pill"
            href={dep.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            ↗ {dep.url}
          </a>
        ) : (
          <span className="image-tag">{dep.image_tag ?? "—"}</span>
        )}
        <div className="row" style={{ gap: 6 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onRedeploy();
            }}
          >
            Redeploy
          </button>
          <button
            className="danger"
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete();
            }}
          >
            Delete
          </button>
        </div>
      </div>
      {dep.error && <div className="meta" style={{ color: "var(--err)" }}>{dep.error}</div>}
    </div>
  );
}

function LogPane(props: {
  selectedId: string | null;
  lines: { id: number; ts: number; stream: string; level: string; line: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = dist < 24;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    if (stickToBottom.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [props.lines.length]);

  if (!props.selectedId) {
    return <div className="logs"><div className="empty">Select a deployment to view its logs.</div></div>;
  }
  if (props.lines.length === 0) {
    return <div className="logs"><div className="empty">Waiting for logs…</div></div>;
  }
  return (
    <div className="logs" ref={ref}>
      {props.lines.map((l) => (
        <div key={l.id} className={`l ${l.level}`}>
          <span className="ts">{formatTs(l.ts)}</span>
          <span className="stream">{l.stream}</span>
          {l.line}
        </div>
      ))}
    </div>
  );
}

function formatTs(ms: number) {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, { hour12: false });
}
