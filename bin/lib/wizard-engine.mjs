/**
 * The setup wizard's actual work, with no UI attached.
 *
 * Every function here is plain: it takes arguments, does the work (check something,
 * write a file, run a command), and returns or throws - it never prints, prompts, or
 * knows whether it is being driven by a terminal or a browser. bin/wizard.mjs (the
 * interactive CLI) and bin/wizard-gui.mjs (the local web GUI) are both thin frontends
 * over this module, so the two can never drift into behaving differently.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SERVER_DIR = path.join(ROOT, "mcp-servers", "cpanel-mcp");
export const CONFIG_PATH = path.join(ROOT, "config", "sites.json");
export const ENV_PATH = path.join(ROOT, ".env");

export function haveCommand(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { stdio: "ignore" });
  return r.status === 0;
}

/** No side effects - safe to call as often as a GUI page wants to re-check itself. */
export function checkPrerequisites() {
  const results = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  results.push({ name: "node", ok: nodeMajor >= 20, detail: process.versions.node });
  for (const cmd of ["git", "ssh", "ssh-keygen", "tar"]) {
    results.push({ name: cmd, ok: haveCommand(cmd), detail: haveCommand(cmd) ? "found" : "not on PATH" });
  }
  return { ok: results.every((r) => r.ok), results };
}

export function serverDepsInstalled() {
  return fs.existsSync(path.join(SERVER_DIR, "node_modules"));
}

/** Throws on failure - npm's own error is the useful message, nothing to add. */
export function installServerDeps() {
  if (serverDepsInstalled()) return { alreadyInstalled: true };
  // execSync goes through a shell, which npm's .cmd wrapper needs on Windows
  // (execFileSync without shell:true throws EINVAL for .cmd there). Safe here - the
  // whole command is a fixed literal, nothing from user input is interpolated.
  execSync("npm install --no-audit --no-fund", { cwd: SERVER_DIR, stdio: "pipe" });
  return { alreadyInstalled: false };
}

export function readSitesJson() {
  if (!fs.existsSync(CONFIG_PATH)) {
    // Seed from sites.starter.json (genuine CHANGEME placeholders), never
    // sites.example.json - that file's defaults are a worked illustration
    // (demousr@server42...) for a human to read, not values to adopt as real.
    const starter = path.join(ROOT, "config", "sites.starter.json");
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const template = JSON.parse(fs.readFileSync(starter, "utf8"));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ defaults: template.defaults, sites: {} }, null, 2) + "\n", "utf8");
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

export function writeSitesJson(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function isPlaceholder(v) {
  return !v || /CHANGEME/i.test(v);
}

export function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** What to pre-fill a connection form with, and whether it looks like real, saved values. */
export function currentConnection(cfg) {
  const ssh = cfg.defaults.ssh ?? {};
  const cpanel = cfg.defaults.cpanel ?? {};
  const alreadySet = !isPlaceholder(ssh.host) && !isPlaceholder(cpanel.user);
  return {
    alreadySet,
    host: isPlaceholder(ssh.host) ? "" : ssh.host,
    user: isPlaceholder(cpanel.user) ? "" : cpanel.user,
    port: ssh.port ?? 22,
    cpanelPort: cpanel.port ?? 2083,
    identityFile: ssh.identityFile || "~/.ssh/id_ed25519_cpanel",
  };
}

export function keyExists(identityFile) {
  return fs.existsSync(expandHome(identityFile));
}

/**
 * Generates the shared deploy key if it does not already exist. No passphrase, on
 * purpose: this toolkit's SSH calls run with BatchMode=yes for unattended deploys,
 * which cannot answer a passphrase prompt - treat this as a single-purpose deploy
 * key, never a personal login key. Returns the public key text either way.
 */
export function ensureSshKey(identityFile) {
  const keyPath = expandHome(identityFile);
  const pubPath = `${keyPath}.pub`;
  let generated = false;
  if (!fs.existsSync(keyPath)) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    execFileSync("ssh-keygen", ["-t", "ed25519", "-a", "100", "-f", keyPath, "-N", "", "-C", `claude-toolkit@${os.hostname()}`]);
    generated = true;
  }
  return { generated, keyPath, publicKey: fs.readFileSync(pubPath, "utf8").trim() };
}

/** Raw connectivity probe. Never throws - a failed connection is a normal, expected result. */
export function checkKeyAuthorized(conn) {
  const keyPath = expandHome(conn.identityFile);
  const r = spawnSync(
    "ssh",
    [
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=12",
      "-p", String(conn.port),
      "-i", keyPath,
      `${conn.user}@${conn.host}`,
      "echo cpanel-mcp-ok",
    ],
    { encoding: "utf8" }
  );
  const ok = r.status === 0 && (r.stdout || "").includes("cpanel-mcp-ok");
  return { ok, detail: ok ? "connected" : (r.stderr || r.error?.message || `exit ${r.status}`).trim() };
}

export function apiTokenEnvName(cfg) {
  return cfg.defaults.cpanel?.apiTokenEnv || "CPANEL_TOKEN_MAIN";
}

export function readEnvVar(name) {
  if (!fs.existsSync(ENV_PATH)) return null;
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name) return rest.join("=").trim() || null;
  }
  return null;
}

export function writeEnvVar(name, value) {
  let lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  let found = false;
  lines = lines.map((line) => {
    if (line.split("=")[0]?.trim() === name) { found = true; return `${name}=${value}`; }
    return line;
  });
  if (!found) lines.push(`${name}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n").replace(/\n+$/, "\n"), "utf8");
}

/** Commits the gathered connection + key + token to disk. The point of no return. */
export function saveConnection(cfg, conn, tokenInfo) {
  cfg.defaults.ssh = { host: conn.host, port: Number(conn.port), user: conn.user, identityFile: conn.identityFile };
  cfg.defaults.cpanel = { host: conn.host, port: Number(conn.cpanelPort), user: conn.user, apiTokenEnv: tokenInfo.envVarName, insecureTLS: false };
  writeSitesJson(cfg);
  writeEnvVar(tokenInfo.envVarName, tokenInfo.token);
  return { configPath: path.relative(ROOT, CONFIG_PATH), envPath: path.relative(ROOT, ENV_PATH) };
}

export function listTemplates() {
  return fs.readdirSync(path.join(ROOT, "templates"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
}

/** Spawns bin/new-project.mjs. Captures output rather than inheriting stdio, so a
 *  GUI can show it; the CLI frontend prints it itself. */
export function scaffoldProject(proj) {
  const args = [
    path.join(ROOT, "bin", "new-project.mjs"),
    "--template", proj.template, "--dir", proj.dir, "--key", proj.key,
    "--label", proj.label, "--domain", proj.domain, "--cpanel-user", proj.cpanelUser,
  ];
  if (proj.standalone) args.push("--standalone");
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { ok: r.status === 0, output: (r.stdout || "") + (r.stderr || "") };
}

export function runPreflight(proj) {
  const cpanelctl = proj.standalone
    ? path.join(proj.dir, "mcp-servers", "cpanel-mcp", "bin", "cpanelctl.mjs")
    : path.join(SERVER_DIR, "bin", "cpanelctl.mjs");
  const r = spawnSync(process.execPath, [cpanelctl, "cpanel_preflight", `site=${proj.key}`, "environment=staging"], {
    cwd: proj.dir, encoding: "utf8",
  });
  try {
    return { ok: r.status === 0, result: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, result: null, raw: (r.stdout || "") + (r.stderr || "") };
  }
}
