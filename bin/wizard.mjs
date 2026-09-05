#!/usr/bin/env node
/**
 * Interactive setup wizard: goes from a fresh toolkit clone to a scaffolded,
 * preflight-verified project in one guided run.
 *
 *   node bin/wizard.mjs
 *
 * What it automates:
 *   - installs the MCP server's dependency
 *   - generates the shared SSH deploy key (if one is not already configured)
 *   - writes real values into config/sites.json (defaults.ssh, defaults.cpanel) and .env
 *   - verifies raw SSH connectivity before going any further
 *   - scaffolds a project with bin/new-project.mjs
 *   - runs cpanel_preflight against the new project's staging environment
 *
 * What it deliberately does NOT automate:
 *   - authorizing the SSH key in cPanel. cPanel's SSH key import/authorize calls are
 *     only exposed through the legacy "cPanel API 2" interface, not UAPI - the official
 *     docs say plainly that no UAPI equivalent exists. Scripting against an old,
 *     less-verified interface to change what can log into the account is exactly the
 *     kind of shortcut this toolkit's own agents are written to refuse. So the wizard
 *     generates the key, prints the public half, and waits for a human to import and
 *     authorize it in the cPanel UI - then verifies the result itself.
 *
 * Safe to re-run: it detects values you already filled in (anything that is not the
 * CHANGEME placeholder) and offers to keep them rather than asking again.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { execSync, execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(ROOT, "mcp-servers", "cpanel-mcp");
const CONFIG_PATH = path.join(ROOT, "config", "sites.json");
const ENV_PATH = path.join(ROOT, ".env");

// A hand-rolled line queue rather than readline/promises' question(): that API has a
// known issue where the second and later question() calls hang forever when stdin is
// piped (not a real TTY) rather than typed interactively - the promise never settles
// because lines that already arrived in one chunk are not replayed to a listener that
// attaches after the fact. Driving everything off the plain "line" event, queued, works
// correctly whether stdin is an interactive terminal or a redirected file.
const rl = readline.createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY === true });
const lineQueue = [];
const waiters = [];
rl.on("line", (line) => {
  if (waiters.length) waiters.shift()(line);
  else lineQueue.push(line);
});
function nextLine() {
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => waiters.push(resolve));
}

const say = (s = "") => console.log(s);
const heading = (s) => say(`\n=== ${s} ===`);

async function ask(question, def) {
  const suffix = def ? ` [${def}]` : "";
  stdout.write(`${question}${suffix}: `);
  const answer = (await nextLine()).trim();
  return answer || def || "";
}

async function askYesNo(question, defYes) {
  const suffix = defYes ? "[Y/n]" : "[y/N]";
  stdout.write(`${question} ${suffix}: `);
  const answer = (await nextLine()).trim().toLowerCase();
  if (!answer) return defYes;
  return answer.startsWith("y");
}

function fail(message) {
  say(`\n✗ ${message}`);
  rl.close();
  process.exit(1);
}

function haveCommand(cmd) {
  const probe = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { stdio: "ignore" });
  return r.status === 0;
}

/* ------------------------------------------------------------------ steps */

function checkPrerequisites() {
  heading("Checking prerequisites");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 20) fail(`Node 20+ required, found ${process.versions.node}.`);
  say(`  node ${process.versions.node}  ✓`);
  for (const cmd of ["git", "ssh", "ssh-keygen", "tar"]) {
    if (!haveCommand(cmd)) fail(`"${cmd}" was not found on PATH. Install it and re-run.`);
    say(`  ${cmd}  ✓`);
  }
}

function installServerDeps() {
  heading("MCP server dependency");
  if (fs.existsSync(path.join(SERVER_DIR, "node_modules"))) {
    say("  already installed, skipping.");
    return;
  }
  say("  running npm install in mcp-servers/cpanel-mcp ...");
  // execSync goes through a shell, which npm's .cmd wrapper needs on Windows
  // (execFileSync without shell:true throws EINVAL for .cmd there). Safe here - the
  // whole command is a fixed literal, nothing from user input is interpolated.
  execSync("npm install --no-audit --no-fund", { cwd: SERVER_DIR, stdio: "inherit" });
}

function readSitesJson() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const example = path.join(ROOT, "config", "sites.example.json");
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const template = JSON.parse(fs.readFileSync(example, "utf8"));
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ defaults: template.defaults, sites: {} }, null, 2) + "\n", "utf8");
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function writeSitesJson(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

function isPlaceholder(v) {
  return !v || /CHANGEME/i.test(v);
}

async function gatherConnection(cfg) {
  heading("Hosting account connection");
  const ssh = cfg.defaults.ssh ?? {};
  const cpanel = cfg.defaults.cpanel ?? {};

  const alreadySet = !isPlaceholder(ssh.host) && !isPlaceholder(cpanel.user);
  if (alreadySet && await askYesNo(`Found existing connection details (${cpanel.user}@${ssh.host}) - reuse them?`, true)) {
    return { host: ssh.host, port: ssh.port ?? 22, cpanelPort: cpanel.port ?? 2083, user: cpanel.user, identityFile: ssh.identityFile ?? "~/.ssh/id_ed25519_cpanel" };
  }

  say("This is the account every project scaffolded from this toolkit will share.");
  const host = await ask("cPanel/SSH host (e.g. server42.yourhost.com)", isPlaceholder(ssh.host) ? undefined : ssh.host);
  const user = await ask("cPanel account username", isPlaceholder(cpanel.user) ? undefined : cpanel.user);
  const port = await ask("SSH port", String(ssh.port ?? 22));
  const cpanelPort = await ask("cPanel port", String(cpanel.port ?? 2083));
  const identityFile = await ask("SSH private key path", ssh.identityFile ?? "~/.ssh/id_ed25519_cpanel");
  return { host, port: Number(port), cpanelPort: Number(cpanelPort), user, identityFile };
}

function expandHome(p) {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

async function ensureSshKey(conn) {
  heading("SSH deploy key");
  const keyPath = expandHome(conn.identityFile);
  const pubPath = `${keyPath}.pub`;

  if (fs.existsSync(keyPath)) {
    say(`  found an existing key at ${conn.identityFile} - keeping it.`);
  } else {
    say(`  no key at ${conn.identityFile} yet. Generating one now.`);
    say("  no passphrase, on purpose: this toolkit's SSH calls run with BatchMode=yes for");
    say("  unattended deploys, which cannot answer a passphrase prompt. Treat this as a");
    say("  single-purpose deploy key - do not reuse it as your personal login key.");
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    execFileSync("ssh-keygen", ["-t", "ed25519", "-a", "100", "-f", keyPath, "-N", "", "-C", `claude-toolkit@${os.hostname()}`]);
  }

  const authorized = await checkKeyAuthorized(conn, keyPath);
  if (authorized) {
    say("  connectivity test passed - this key is already authorized on the account.");
    return { identityFile: conn.identityFile, alreadyAuthorized: true };
  }

  const pub = fs.readFileSync(pubPath, "utf8").trim();
  say(`
  ── ONE MANUAL STEP - this cannot be scripted reliably ──
  cPanel's SSH key import/authorize calls only exist in its legacy "API 2"
  interface; the official docs say no UAPI equivalent exists. Rather than script
  against an old, less-verified surface to change what can log into the account,
  this needs your click:

    1. In cPanel: Security -> SSH Access -> Manage SSH Keys -> Import Key
    2. Paste this public key and import it:

  ${pub}

    3. Back on the key list, click "Manage" next to it, then "Authorize".
`);
  await ask("Press Enter once you have imported AND authorized the key above");

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (await checkKeyAuthorized(conn, keyPath)) {
      say("  ✓ connectivity confirmed - the key is authorized.");
      return { identityFile: conn.identityFile, alreadyAuthorized: false };
    }
    say(`  ✗ still cannot connect (attempt ${attempt}/3).`);
    if (attempt < 3 && !(await askYesNo("  Try again?", true))) break;
  }
  const proceed = await askYesNo(
    "  Continue without confirmed SSH access? (deploys will fail until this is fixed)", false
  );
  if (!proceed) fail("Stopping here. Re-run the wizard once the key is authorized.");
  return { identityFile: conn.identityFile, alreadyAuthorized: false };
}

function checkKeyAuthorized(conn, keyPath) {
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
  return r.status === 0 && (r.stdout || "").includes("cpanel-mcp-ok");
}

async function gatherToken(cfg) {
  heading("cPanel API token");
  const envVarName = cfg.defaults.cpanel?.apiTokenEnv || "CPANEL_TOKEN_MAIN";
  const existing = readEnvVar(envVarName);
  if (existing && await askYesNo(`Found an existing ${envVarName} in .env - reuse it?`, true)) {
    return { envVarName, token: existing };
  }
  say("  cPanel -> Security -> Manage API Tokens -> Create. Not your account password.");
  say("  This is typed in plain text in this terminal and saved only to the local,");
  say("  gitignored .env file - nothing is sent anywhere else.");
  const token = await ask(`Paste the token (stored as ${envVarName} in .env)`);
  if (!token) fail("A token is required to reach the cPanel API.");
  return { envVarName, token };
}

function readEnvVar(name) {
  if (!fs.existsSync(ENV_PATH)) return null;
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const [k, ...rest] = line.split("=");
    if (k?.trim() === name) return rest.join("=").trim() || null;
  }
  return null;
}

function writeEnvVar(name, value) {
  let lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  let found = false;
  lines = lines.map((line) => {
    if (line.split("=")[0]?.trim() === name) { found = true; return `${name}=${value}`; }
    return line;
  });
  if (!found) lines.push(`${name}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n").replace(/\n+$/, "\n"), "utf8");
}

function saveConnection(cfg, conn, keyInfo, tokenInfo) {
  heading("Saving configuration");
  cfg.defaults.ssh = { host: conn.host, port: conn.port, user: conn.user, identityFile: keyInfo.identityFile };
  cfg.defaults.cpanel = { host: conn.host, port: conn.cpanelPort, user: conn.user, apiTokenEnv: tokenInfo.envVarName, insecureTLS: false };
  writeSitesJson(cfg);
  writeEnvVar(tokenInfo.envVarName, tokenInfo.token);
  say(`  wrote ${path.relative(ROOT, CONFIG_PATH)} and ${path.relative(ROOT, ENV_PATH)}.`);
}

async function gatherProject(conn) {
  heading("Scaffold a project");
  if (!(await askYesNo("Scaffold a project now?", true))) return null;

  const templates = fs.readdirSync(path.join(ROOT, "templates"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  const template = await ask(`Template (${templates.join(" / ")})`, templates.includes("php-site") ? "php-site" : templates[0]);
  const key = await ask("Site key (used in config and remote paths, e.g. acme)");
  if (!key) fail("A site key is required.");
  const label = await ask("Human label", key);
  const domain = await ask("Live domain (e.g. acme.hu)", `${key}.example`);
  const dir = await ask("Directory to create it in", path.join(path.dirname(ROOT), key));
  const standalone = await askYesNo("Standalone mode? (vendors the MCP server in - needed for Claude Code Cloud / its own repo)", false);

  return { template, key, label, domain, dir: path.resolve(dir), cpanelUser: conn.user, standalone };
}

function scaffoldProject(proj) {
  heading("Running the scaffolder");
  const args = [
    path.join(ROOT, "bin", "new-project.mjs"),
    "--template", proj.template, "--dir", proj.dir, "--key", proj.key,
    "--label", proj.label, "--domain", proj.domain, "--cpanel-user", proj.cpanelUser,
  ];
  if (proj.standalone) args.push("--standalone");
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) fail("Scaffolding failed - see the output above.");
}

function verifyProject(proj) {
  heading("Verifying with a preflight check");
  const cpanelctl = proj.standalone
    ? path.join(proj.dir, "mcp-servers", "cpanel-mcp", "bin", "cpanelctl.mjs")
    : path.join(SERVER_DIR, "bin", "cpanelctl.mjs");
  const r = spawnSync(process.execPath, [cpanelctl, "cpanel_preflight", `site=${proj.key}`, "environment=staging"], {
    cwd: proj.dir, stdio: "inherit",
  });
  if (r.status !== 0) {
    say("\n  Preflight reported problems above - expected the first time, since the remote");
    say("  paths in cpanel.site.json are still guesses. Fix them, then re-run preflight by hand:");
    say(`    cpanel_preflight site=${proj.key} environment=staging`);
  } else {
    say("  ✓ preflight passed. This project is ready to deploy to staging.");
  }
}

/* ------------------------------------------------------------------- main */

async function main() {
  say("cPanel toolkit - interactive setup\n");
  say("This walks through everything that can be automated: dependencies, the shared");
  say("SSH key, the connection details, scaffolding a project, and a first preflight.");
  say("The one thing it cannot do for you is click Authorize on the key in cPanel.\n");

  checkPrerequisites();
  installServerDeps();

  const cfg = readSitesJson();
  const conn = await gatherConnection(cfg);
  const keyInfo = await ensureSshKey(conn);
  const tokenInfo = await gatherToken(cfg);
  saveConnection(cfg, conn, keyInfo, tokenInfo);

  const proj = await gatherProject(conn);
  if (proj) {
    scaffoldProject(proj);
    verifyProject(proj);
    say(`
Done. Open Claude Code in the new project and run /start:

  CLI:      cd ${proj.dir} && claude
  Desktop:  File -> Open Folder -> ${proj.dir}
`);
  } else {
    say(`
Connection configured. Scaffold a project any time with:
  node bin/new-project.mjs --template php-site --dir <path> --key <key> --domain <domain>
`);
  }

  rl.close();
}

main().catch((err) => {
  say(`\n✗ ${err.message}`);
  rl.close();
  process.exit(1);
});
