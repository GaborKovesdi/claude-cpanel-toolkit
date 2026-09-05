#!/usr/bin/env node
/**
 * Interactive TERMINAL setup wizard: goes from a fresh toolkit clone to a scaffolded,
 * preflight-verified project in one guided run.
 *
 *   node bin/wizard.mjs
 *
 * Prefer a form instead of typing into a terminal? node bin/wizard-gui.mjs runs the
 * same steps as a small local web page. Both are thin frontends over
 * bin/lib/wizard-engine.mjs, which does the actual work - see that file for exactly
 * what is automated and what deliberately is not (importing/authorizing the SSH key
 * in cPanel - see the comment there for why).
 *
 * Safe to re-run: it detects values you already filled in (anything that is not the
 * CHANGEME placeholder) and offers to keep them rather than asking again.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import * as engine from "./lib/wizard-engine.mjs";

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

/* ------------------------------------------------------------------ steps */

function runPrerequisiteCheck() {
  heading("Checking prerequisites");
  const { ok, results } = engine.checkPrerequisites();
  for (const r of results) say(`  ${r.name} ${r.detail}  ${r.ok ? "✓" : "✗"}`);
  if (!ok) fail("Install whatever is missing above, then re-run.");
}

function runInstallDeps() {
  heading("MCP server dependency");
  if (engine.serverDepsInstalled()) { say("  already installed, skipping."); return; }
  say("  running npm install in mcp-servers/cpanel-mcp ...");
  engine.installServerDeps();
}

async function gatherConnection(cfg) {
  heading("Hosting account connection");
  const c = engine.currentConnection(cfg);
  if (c.alreadySet && await askYesNo(`Found existing connection details (${c.user}@${c.host}) - reuse them?`, true)) {
    return c;
  }
  say("This is the account every project scaffolded from this toolkit will share.");
  const host = await ask("cPanel/SSH host (e.g. server42.yourhost.com)", c.host || undefined);
  const user = await ask("cPanel account username", c.user || undefined);
  const port = await ask("SSH port", String(c.port));
  const cpanelPort = await ask("cPanel port", String(c.cpanelPort));
  const identityFile = await ask("SSH private key path", c.identityFile);
  return { host, port: Number(port), cpanelPort: Number(cpanelPort), user, identityFile };
}

async function ensureKeyAuthorized(conn) {
  heading("SSH deploy key");
  const existed = engine.keyExists(conn.identityFile);
  const { generated, publicKey } = engine.ensureSshKey(conn.identityFile);
  if (existed) {
    say(`  found an existing key at ${conn.identityFile} - keeping it.`);
  } else if (generated) {
    say(`  no key at ${conn.identityFile} yet. Generated one.`);
    say("  no passphrase, on purpose: this toolkit's SSH calls run with BatchMode=yes for");
    say("  unattended deploys, which cannot answer a passphrase prompt. Treat this as a");
    say("  single-purpose deploy key - do not reuse it as your personal login key.");
  }

  if (engine.checkKeyAuthorized(conn).ok) {
    say("  connectivity test passed - this key is already authorized on the account.");
    return;
  }

  say(`
  ── ONE MANUAL STEP - this cannot be scripted reliably ──
  cPanel's SSH key import/authorize calls only exist in its legacy "API 2"
  interface; the official docs say no UAPI equivalent exists. Rather than script
  against an old, less-verified surface to change what can log into the account,
  this needs your click:

    1. In cPanel: Security -> SSH Access -> Manage SSH Keys -> Import Key
    2. Paste this public key and import it:

  ${publicKey}

    3. Back on the key list, click "Manage" next to it, then "Authorize".
`);
  await ask("Press Enter once you have imported AND authorized the key above");

  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = engine.checkKeyAuthorized(conn);
    if (r.ok) { say("  ✓ connectivity confirmed - the key is authorized."); return; }
    say(`  ✗ still cannot connect (attempt ${attempt}/3): ${r.detail}`);
    if (attempt < 3 && !(await askYesNo("  Try again?", true))) break;
  }
  if (!(await askYesNo("  Continue without confirmed SSH access? (deploys will fail until this is fixed)", false))) {
    fail("Stopping here. Re-run the wizard once the key is authorized.");
  }
}

async function gatherToken(cfg) {
  heading("cPanel API token");
  const envVarName = engine.apiTokenEnvName(cfg);
  const existing = engine.readEnvVar(envVarName);
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

async function gatherProject(conn) {
  heading("Scaffold a project");
  if (!(await askYesNo("Scaffold a project now?", true))) return null;
  const templates = engine.listTemplates();
  const template = await ask(`Template (${templates.join(" / ")})`, templates.includes("php-site") ? "php-site" : templates[0]);
  const key = await ask("Site key (used in config and remote paths, e.g. acme)");
  if (!key) fail("A site key is required.");
  const label = await ask("Human label", key);
  const domain = await ask("Live domain (e.g. acme.hu)", `${key}.example`);
  const dir = await ask("Directory to create it in", path.join(path.dirname(engine.ROOT), key));
  const standalone = await askYesNo("Standalone mode? (vendors the MCP server in - needed for Claude Code Cloud / its own repo)", false);
  return { template, key, label, domain, dir: path.resolve(dir), cpanelUser: conn.user, standalone };
}

/* ------------------------------------------------------------------- main */

async function main() {
  say("cPanel toolkit - interactive setup\n");
  say("This walks through everything that can be automated: dependencies, the shared");
  say("SSH key, the connection details, scaffolding a project, and a first preflight.");
  say("The one thing it cannot do for you is click Authorize on the key in cPanel.\n");
  say("Prefer a form? Ctrl+C and run: node bin/wizard-gui.mjs\n");

  runPrerequisiteCheck();
  runInstallDeps();

  const cfg = engine.readSitesJson();
  const conn = await gatherConnection(cfg);
  await ensureKeyAuthorized(conn);
  const tokenInfo = await gatherToken(cfg);
  heading("Saving configuration");
  const written = engine.saveConnection(cfg, conn, tokenInfo);
  say(`  wrote ${written.configPath} and ${written.envPath}.`);

  const proj = await gatherProject(conn);
  if (proj) {
    heading("Running the scaffolder");
    const scaffold = engine.scaffoldProject(proj);
    say(scaffold.output);
    if (!scaffold.ok) fail("Scaffolding failed - see the output above.");

    heading("Verifying with a preflight check");
    const pf = engine.runPreflight(proj);
    if (pf.result) say(JSON.stringify(pf.result, null, 2));
    if (pf.ok) {
      say("  ✓ preflight passed. This project is ready to deploy to staging.");
    } else {
      say("\n  Preflight reported problems above - expected the first time, since the remote");
      say("  paths in cpanel.site.json are still guesses. Fix them, then re-run preflight by hand:");
      say(`    cpanel_preflight site=${proj.key} environment=staging`);
    }

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
