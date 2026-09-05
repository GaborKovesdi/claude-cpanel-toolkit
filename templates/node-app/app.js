"use strict";

/**
 * cPanel Passenger entrypoint.
 *
 * Passenger chooses the port and starts this file itself - there is no `npm start`
 * in production. Listening on a hard-coded port is the single most common reason a
 * cPanel Node app returns 503.
 */
const http = require("http");

const app = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "ok", node: process.version, uptime: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!doctype html><meta charset=utf-8><title>__SITE_LABEL__</title><h1>__SITE_LABEL__</h1>");
});

// Passenger sets PORT. The fallback is for local development only.
app.listen(process.env.PORT || 3000);
