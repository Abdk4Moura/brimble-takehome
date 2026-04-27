import { appendLog } from "./repo.js";
import { emitLog } from "./events.js";

// Persist + broadcast. Splits chunks into lines so the UI shows complete
// lines even when the producer (railpack/docker) emits partial buffers.
export class LogSink {
  private buffer = "";
  constructor(
    private readonly deploymentId: string,
    private readonly stream: "build" | "run" | "system",
  ) {}

  write(chunk: string | Buffer, level: "info" | "error" = "info") {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.buffer += text;
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length === 0) continue;
      const row = appendLog({
        deploymentId: this.deploymentId,
        stream: this.stream,
        level,
        line,
      });
      emitLog(row);
    }
  }

  flush() {
    if (this.buffer.length > 0) {
      const row = appendLog({
        deploymentId: this.deploymentId,
        stream: this.stream,
        level: "info",
        line: this.buffer,
      });
      emitLog(row);
      this.buffer = "";
    }
  }

  system(line: string) {
    const row = appendLog({
      deploymentId: this.deploymentId,
      stream: "system",
      level: "system",
      line,
    });
    emitLog(row);
  }
}
