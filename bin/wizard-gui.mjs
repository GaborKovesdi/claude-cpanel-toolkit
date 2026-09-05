#!/usr/bin/env node
/**
 * Local web GUI for the setup wizard: same steps as bin/wizard.mjs, as a form instead
 * of typed terminal answers - no more mistyped commands or fiddly interactive prompts.
 *
 *   node bin/wizard-gui.mjs
 *
 * Runs a tiny node:http server bound to 127.0.0.1 ONLY (never reachable from the
 * network), serves bin/gui/wizard.html, and opens it in your default browser. Every
 * /api/* call must carry the random token this run generated (checked via the
 * X-Wizard-Token header) - that stops any other local process or browser tab from
 * quietly calling into a server that can run ssh-keygen and write your config.
 *
 * All the actual work (checking prerequisites, generating the key, writing config,
 * scaffolding) lives in bin/lib/wizard-engine.mjs, shared with the terminal wizard -
 * this file is just the HTTP plumbing around it.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as engine from "./lib/wizard-engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = crypto.randomBytes(16).toString("hex");
const PAGE = fs.readFileSync(path.join(HERE, "gui", "wizard.html"), "utf8").replace("__TOKEN__", TOKEN);

function send(res, status, body, contentType = "application/json") {
  const payload = contentType === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, { "Content-Type": contentType + (contentType === "application/json" ? "; charset=utf-8" : "") });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error("request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

/** Every handler gets the parsed body and returns a plain object - errors are caught centrally. */
const ROUTES = {
  "/api/prereqs": async () => {
    const { ok, results } = engine.checkPrerequisites();
    return { ok, results, depsInstalled: engine.serverDepsInstalled() };
  },
  "/api/install-deps": async () => {
    engine.installServerDeps();
    return { ok: true };
  },
  "/api/connection": async () => engine.currentConnection(engine.readSitesJson()),
  "/api/ensure-key": async (body) => engine.ensureSshKey(body.identityFile),
  "/api/test-connection": async (body) => engine.checkKeyAuthorized(body),
  "/api/token-state": async () => {
    const cfg = engine.readSitesJson();
    const envVarName = engine.apiTokenEnvName(cfg);
    return { envVarName, alreadySet: !!engine.readEnvVar(envVarName) };
  },
  "/api/save-connection": async (body) => {
    const cfg = engine.readSitesJson();
    const envVarName = engine.apiTokenEnvName(cfg);
    const token = body.token || engine.readEnvVar(envVarName);
    if (!token) throw new Error("A token is required (none provided and none already saved).");
    return engine.saveConnection(cfg, body.conn, { envVarName, token });
  },
  "/api/templates": async () => ({ templates: engine.listTemplates() }),
  "/api/scaffold": async (body) => engine.scaffoldProject(body),
  "/api/preflight": async (body) => engine.runPreflight(body),
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      return send(res, 200, PAGE, "text/html");
    }
    if (req.method === "POST" && ROUTES[req.url]) {
      if (req.headers["x-wizard-token"] !== TOKEN) return send(res, 403, { error: "bad or missing token" });
      const body = await readBody(req);
      const result = await ROUTES[req.url](body);
      return send(res, 200, result);
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

function openBrowser(url) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // Non-fatal - the URL is printed either way.
  }
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`cPanel toolkit setup - open in your browser:\n\n  ${url}\n`);
  console.log("(bound to 127.0.0.1 only - not reachable from your network. Ctrl+C to stop.)\n");
  openBrowser(url);
});
