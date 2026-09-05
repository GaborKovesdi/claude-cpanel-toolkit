#!/usr/bin/env node
/**
 * One-command setup after cloning the toolkit.
 *
 *   node bin/setup.mjs
 *
 * - installs the cPanel MCP server's dependency
 * - creates config/sites.json from the example if it does not exist
 * - creates .env from the example if it does not exist
 * - prints exactly what you still need to fill in
 *
 * Idempotent: safe to run more than once. It never overwrites a config or .env
 * you have already edited.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");

function copyIfMissing(from, to, label) {
  if (fs.existsSync(to)) return `kept existing ${rel(to)}`;
  if (!fs.existsSync(from)) return `SKIPPED ${label}: ${rel(from)} not found`;
  fs.copyFileSync(from, to);
  return `created ${rel(to)} from ${rel(from)}`;
}

console.log("cPanel toolkit setup\n");

// 1. MCP server dependency
const serverDir = path.join(ROOT, "mcp-servers", "cpanel-mcp");
try {
  console.log("Installing the cPanel MCP server dependency (npm)...");
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: serverDir,
    stdio: "inherit",
    shell: process.platform === "win32", // npm is a .cmd on Windows
  });
  console.log("  dependency installed.\n");
} catch (e) {
  console.error(`  npm install failed in ${rel(serverDir)}: ${e.message}`);
  console.error("  Run it by hand: cd mcp-servers/cpanel-mcp && npm install\n");
}

// 2 & 3. Config and env scaffolds
console.log(copyIfMissing(
  path.join(ROOT, "config", "sites.example.json"),
  path.join(ROOT, "config", "sites.json"),
  "site config"
));
console.log(copyIfMissing(
  path.join(ROOT, ".env.example"),
  path.join(ROOT, ".env"),
  "env file"
));

// 4. Verify the toolkit runs
console.log("\nVerifying the MCP server starts...");
try {
  execFileSync(process.execPath, ["--check", path.join(serverDir, "src", "server.mjs")]);
  console.log("  server.mjs OK.");
} catch (e) {
  console.error(`  server.mjs failed --check: ${e.message}`);
}

console.log(`
Next steps:

  1. Edit config/sites.json - fill in the three CHANGEME values under "defaults"
     (your cPanel/SSH host, username, and the SSH key path).
  2. Edit .env - put your cPanel API token in CPANEL_TOKEN_MAIN.
  3. Create and authorise the shared SSH key:  see the /ssh-key-setup skill.
  4. Verify:  node mcp-servers/cpanel-mcp/bin/cpanelctl.mjs cpanel_list_sites

Then scaffold a project:
  node bin/new-project.mjs --template php-site --dir ../my-site --key my-site --domain my-site.hu

Or open this folder in Claude Code and run /start.
`);
