#!/usr/bin/env node
/**
 * cpanelctl - human CLI over the same tool registry the MCP server exposes.
 * Useful for testing the toolkit outside Claude and for CI.
 *
 *   node bin/cpanelctl.mjs --help
 *   node bin/cpanelctl.mjs cpanel_list_sites
 *   node bin/cpanelctl.mjs cpanel_preflight site=demo-php environment=staging
 *   node bin/cpanelctl.mjs cpanel_deploy site=demo-php environment=production confirm=true note="v1.4.0"
 */
import { TOOLS, TOOL_BY_NAME, checkArgs } from "../src/tools.mjs";
import { redact, loadDotEnv } from "../src/config.mjs";

loadDotEnv();

const argv = process.argv.slice(2);

function usage() {
  const lines = [
    "cpanelctl - cPanel hosting operations",
    "",
    "Usage: cpanelctl <tool> [key=value ...] [--json]",
    "",
    "Tools:",
  ];
  const width = Math.max(...TOOLS.map((t) => t.name.length));
  for (const t of TOOLS) {
    const first = t.description.split(". ")[0];
    lines.push(`  ${t.name.padEnd(width)}  ${t.destructive ? "[writes] " : ""}${first}.`);
  }
  lines.push("", "Arguments for one tool:  cpanelctl <tool> --help");
  return lines.join("\n");
}

function toolHelp(tool) {
  const props = tool.inputSchema.properties ?? {};
  const req = new Set(tool.inputSchema.required ?? []);
  const lines = [`${tool.name}${tool.destructive ? "  [writes to a live server]" : ""}`, "", tool.description, "", "Arguments:"];
  if (!Object.keys(props).length) lines.push("  (none)");
  for (const [k, v] of Object.entries(props)) {
    lines.push(`  ${k}${req.has(k) ? " (required)" : ""}: ${v.description ?? v.type}`);
  }
  return lines.join("\n");
}

function parseValue(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

const name = argv[0];
if (!name || name === "--help" || name === "-h" || name === "help") {
  console.log(usage());
  process.exit(0);
}

const tool = TOOL_BY_NAME[name];
if (!tool) {
  console.error(`Unknown tool "${name}".\n`);
  console.error(usage());
  process.exit(2);
}
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(toolHelp(tool));
  process.exit(0);
}

const asJson = argv.includes("--json");
const args = {};
for (const raw of argv.slice(1)) {
  if (raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq < 1) {
    console.error(`Arguments must be key=value pairs; got "${raw}".`);
    process.exit(2);
  }
  args[raw.slice(0, eq)] = parseValue(raw.slice(eq + 1));
}

try {
  checkArgs(tool, args);
  const result = await tool.handler(args);
  const text = redact(JSON.stringify(result, null, 2));
  if (asJson) {
    console.log(text);
  } else {
    console.log(text);
    if (result && result.ok === false) process.exitCode = 1;
  }
} catch (err) {
  console.error(`error: ${redact(err?.message ?? String(err))}`);
  process.exit(1);
}
