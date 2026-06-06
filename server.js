const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.FRONTEND_PORT || 3000);
const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const PUBLIC_DIR = __dirname;
const ALLOWED_STATIC_FILES = new Set([
  "/index.html",
  "/dashboard.html",
  "/styles.css",
  "/app.js",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = pathname === "/" ? "/index.html" : pathname;

  if (!ALLOWED_STATIC_FILES.has(safePath)) {
    send(res, 404, "Not found");
    return;
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath);
    send(res, 200, content, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
  });
}

async function proxyApi(req, res) {
  const target = `${API_BASE_URL}${req.url}`;
  const chunks = [];

  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    try {
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const response = await fetch(target, {
        method: req.method,
        headers: {
          "Content-Type": req.headers["content-type"] || "application/json",
        },
        body,
      });
      const responseBody = Buffer.from(await response.arrayBuffer());
      send(res, response.status, responseBody, {
        "Content-Type": response.headers.get("content-type") || "application/json",
      });
    } catch (error) {
      send(
        res,
        502,
        JSON.stringify({
          error: "Backend unavailable",
          detail: "Start FastAPI on port 8000 or set API_BASE_URL.",
        }),
        { "Content-Type": "application/json" }
      );
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Frontend running at http://127.0.0.1:${PORT}`);
  console.log(`Proxying API requests to ${API_BASE_URL}`);
});
