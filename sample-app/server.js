const http = require("http");

const port = parseInt(process.env.PORT || "3000", 10);
const message = process.env.HELLO_MESSAGE || "hello from a railpack-built container";
const startedAt = new Date().toISOString();

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify(
      { message, path: req.url, startedAt, hostname: require("os").hostname() },
      null,
      2,
    ),
  );
});

server.listen(port, "0.0.0.0", () => {
  console.log(`sample-app listening on :${port}`);
});

const shutdown = () => {
  console.log("sample-app shutting down");
  server.close(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
