#!/usr/bin/env node
/**
 * Scaffold a new site project from a template and wire it to this toolkit.
 *
 *   node bin/new-project.mjs --template php-site --dir C:/xprojects/acme \
 *        --key acme --label "Acme Kft" --domain acme.hu [--cpanel-user demousr]
 *
 * The new project gets:
 *   - the template files, with placeholders substituted
 *   - .claude/agents and .claude/skills copied from the toolkit
 *   - .mcp.json pointing at this toolkit's cPanel MCP server (absolute path)
 *   - a cpanel.site.json that inherits the toolkit's shared SSH key and cPanel account
 *
 * The SSH key is deliberately NOT copied into the project. It is declared once in the
 * toolkit's config/sites.json under defaults.ssh and inherited by every project.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = path.join(KIT_ROOT, "templates");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function availableTemplates() {
  return fs.existsSync(TEMPLATES)
    ? fs.readdirSync(TEMPLATES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
}

if (args.help || !args.template || !args.dir || !args.key) {
  console.log(`Scaffold a site project wired to this toolkit.

Usage:
  node bin/new-project.mjs --template <name> --dir <path> --key <site-key> [options]

Required:
  --template     one of: ${availableTemplates().join(", ") || "(none found)"}
  --dir          where to create the project
  --key          site key used in config and remote paths, e.g. "acme"

Options:
  --label        human name (default: the key)
  --domain       live domain, e.g. acme.hu (default: <key>.example)
  --cpanel-user  cPanel account name for remote paths (default: read from the toolkit
                 config's defaults.cpanel.user, else "CPANEL_USER")
  --force        write into a non-empty directory
`);
  process.exit(args.help ? 0 : 2);
}

const templateDir = path.join(TEMPLATES, String(args.template));
if (!fs.existsSync(templateDir)) {
  console.error(`No template "${args.template}". Available: ${availableTemplates().join(", ")}`);
  process.exit(2);
}

const target = path.resolve(String(args.dir));
if (fs.existsSync(target) && fs.readdirSync(target).length && !args.force) {
  console.error(`${target} is not empty. Pass --force if you mean to write into it.`);
  process.exit(2);
}

/** Pull the shared defaults out of the toolkit config so the project inherits them. */
function toolkitDefaults() {
  const f = path.join(KIT_ROOT, "config", "sites.json");
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")).defaults ?? {};
  } catch {
    return {};
  }
}

const defaults = toolkitDefaults();
const siteKey = String(args.key);
const vars = {
  __SITE_KEY__: siteKey,
  __SITE_LABEL__: String(args.label ?? siteKey),
  __DOMAIN__: String(args.domain ?? `${siteKey}.example`),
  __CPANEL_USER__: String(args["cpanel-user"] ?? defaults.cpanel?.user ?? "CPANEL_USER"),
};

function substitute(text) {
  return Object.entries(vars).reduce((acc, [k, v]) => acc.split(k).join(v), text);
}

const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".pdf", ".zip"]);

function copyTree(from, to, { transform = true } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) {
      copyTree(src, dst, { transform });
    } else if (transform && !BINARY.has(path.extname(ent.name).toLowerCase())) {
      fs.writeFileSync(dst, substitute(fs.readFileSync(src, "utf8")), "utf8");
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

copyTree(templateDir, target);

// The agents and skills travel with the project so Claude Code picks them up there.
for (const dir of ["agents", "skills"]) {
  const from = path.join(KIT_ROOT, ".claude", dir);
  if (fs.existsSync(from)) copyTree(from, path.join(target, ".claude", dir), { transform: false });
}

// Absolute path back to the toolkit, because the project runs from its own directory.
const serverPath = path.join(KIT_ROOT, "mcp-servers", "cpanel-mcp", "src", "server.mjs").split(path.sep).join("/");
const mcp = {
  mcpServers: {
    cpanel: { command: "node", args: [serverPath] },
    playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
  },
};
fs.writeFileSync(path.join(target, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n", "utf8");

const identity = defaults.ssh?.identityFile ?? "(not set - add defaults.ssh.identityFile to the toolkit config)";
const sshHost = defaults.ssh?.host ?? "(not set)";

console.log(`Created ${target}

  template      ${args.template}
  site key      ${siteKey}
  domain        ${vars.__DOMAIN__}
  cPanel user   ${vars.__CPANEL_USER__}

Inherited from the toolkit (not copied into the project):
  ssh host      ${sshHost}
  ssh key       ${identity}
  cPanel token  env var named in the toolkit config's defaults.cpanel.apiTokenEnv

Next:
  1. cd ${target}
  2. review cpanel.site.json - the remote paths are guesses until you check them
  3. claude, then run the /test-env-setup skill to build the staging environment
  4. cpanel_preflight site=${siteKey} environment=staging
`);
