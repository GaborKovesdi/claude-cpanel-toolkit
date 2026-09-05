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
 *   - .mcp.json pointing at this toolkit's cPanel MCP server (absolute path by default)
 *   - a cpanel.site.json that inherits the toolkit's shared SSH key and cPanel account
 *
 * The SSH key is deliberately NOT copied into the project. It is declared once in the
 * toolkit's config/sites.json under defaults.ssh and inherited by every project - this
 * is the right model when one machine manages many client sites from one toolkit clone.
 *
 * --standalone changes that: it vendors a full copy of the MCP server INTO the project
 * and writes .mcp.json with a relative path, and inlines the ssh/cpanel connection
 * details into the project's own cpanel.site.json instead of relying on an external
 * toolkit config to inherit from. Use it for a project that will live in its own git
 * repo and be opened somewhere that does not have this toolkit cloned alongside it -
 * a teammate's machine, or a Claude Code CLOUD session, which starts from a fresh,
 * isolated container containing only what that repo committed. The private SSH key
 * itself still never gets copied or committed; it has to be provisioned into whatever
 * environment opens the project (see the printed instructions and the /ssh-key-setup
 * skill).
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
  --standalone   vendor the MCP server into the project (relative path, own repo,
                 no dependency on this toolkit being cloned elsewhere). Use this for
                 a project that will get its own git repo, or that will be opened in
                 Claude Code Cloud rather than on this machine.
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
const standalone = !!args.standalone;

function copyTree(from, to, { transform = true, skip = () => false } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(ent.name)) continue;
    const src = path.join(from, ent.name);
    const dst = path.join(to, ent.name);
    if (ent.isDirectory()) {
      copyTree(src, dst, { transform, skip });
    } else if (transform && !BINARY.has(path.extname(ent.name).toLowerCase())) {
      fs.writeFileSync(dst, substitute(fs.readFileSync(src, "utf8")), "utf8");
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

copyTree(templateDir, target);

// The agents and skills travel with the project so Claude Code picks them up there,
// on this machine or any other.
for (const dir of ["agents", "skills"]) {
  const from = path.join(KIT_ROOT, ".claude", dir);
  if (fs.existsSync(from)) copyTree(from, path.join(target, ".claude", dir), { transform: false });
}

let mcp;
let npmInstallNote = "";

if (standalone) {
  // Vendor the whole MCP server into the project. node_modules is excluded (regenerated
  // by npm install below) so the copy is small and the lockfile stays the source of truth.
  const serverSrc = path.join(KIT_ROOT, "mcp-servers", "cpanel-mcp");
  const serverDst = path.join(target, "mcp-servers", "cpanel-mcp");
  copyTree(serverSrc, serverDst, { transform: false, skip: (name) => name === "node_modules" });

  mcp = {
    mcpServers: {
      cpanel: { command: "node", args: ["mcp-servers/cpanel-mcp/src/server.mjs"] },
      playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
    },
  };

  try {
    // execSync always goes through a shell, which is what a .cmd file needs on Windows
    // (execFileSync without shell:true throws EINVAL for .cmd there). Safe here because
    // the whole command is a fixed literal - nothing from user input is interpolated.
    execSync("npm install --no-audit --no-fund", { cwd: serverDst, stdio: "pipe" });
    npmInstallNote = "  npm install ran automatically inside mcp-servers/cpanel-mcp.";
  } catch (e) {
    npmInstallNote =
      `  npm install could NOT run automatically (${e.message.split("\n")[0]}).\n` +
      `  Run it yourself before first use:  cd mcp-servers/cpanel-mcp && npm install`;
  }

  // A standalone project has no external toolkit config to inherit defaults.ssh /
  // defaults.cpanel from, so inline them directly into this project's own site config -
  // copied from the toolkit's current defaults if it has any, CHANGEME otherwise. This
  // repo is then self-describing: clone it anywhere and the connection details travel
  // with it (the actual key and token still do not - see the printed notes below).
  const siteConfigPath = path.join(target, "cpanel.site.json");
  const siteConfig = JSON.parse(fs.readFileSync(siteConfigPath, "utf8"));
  siteConfig.ssh = defaults.ssh ?? {
    host: "CHANGEME.hosting.example", port: 22, user: vars.__CPANEL_USER__, identityFile: "~/.ssh/id_ed25519_cpanel",
  };
  siteConfig.cpanel = defaults.cpanel ?? {
    host: "CHANGEME.hosting.example", port: 2083, user: vars.__CPANEL_USER__, apiTokenEnv: "CPANEL_TOKEN_MAIN",
  };
  fs.writeFileSync(siteConfigPath, JSON.stringify(siteConfig, null, 2) + "\n", "utf8");

  // Nested node_modules (this vendored server's own) needs its own ignore rule.
  const gitignorePath = path.join(target, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    fs.appendFileSync(gitignorePath, "\nmcp-servers/*/node_modules/\n", "utf8");
  }
} else {
  // Default: reference this toolkit's own install by absolute path. Simplest for
  // managing many client sites from one machine with one shared config.
  const serverPath = path.join(KIT_ROOT, "mcp-servers", "cpanel-mcp", "src", "server.mjs").split(path.sep).join("/");
  mcp = {
    mcpServers: {
      cpanel: { command: "node", args: [serverPath] },
      playwright: { command: "npx", args: ["-y", "@playwright/mcp@latest"] },
    },
  };
}

fs.writeFileSync(path.join(target, ".mcp.json"), JSON.stringify(mcp, null, 2) + "\n", "utf8");

const identity = defaults.ssh?.identityFile ?? "~/.ssh/id_ed25519_cpanel (not yet set in the toolkit config)";
const sshHost = defaults.ssh?.host ?? "CHANGEME - not yet set in the toolkit config";

console.log(`Created ${target}

  template      ${args.template}
  site key      ${siteKey}
  domain        ${vars.__DOMAIN__}
  cPanel user   ${vars.__CPANEL_USER__}
  mode          ${standalone ? "standalone (MCP server vendored, portable)" : "toolkit-linked (references this clone by absolute path)"}
`);

if (standalone) {
  console.log(`${npmInstallNote}

This project is self-contained: it can be pushed to its own git repo and opened
anywhere - another machine, a teammate, or a Claude Code CLOUD session - without
this toolkit being present there too.

What still needs to be provisioned in whatever environment opens it (never commit
these - they are already gitignored):
  - .env with your cPanel API token (copy .env.example)
  - the private SSH key at the path named in cpanel.site.json's ssh.identityFile
    (${identity})

Cloud sessions start from a fresh container each time, so both of the above need
setting up per session unless your cloud environment offers persistent secrets.
SSH out to an arbitrary host on a non-standard port may also be restricted by a
cloud sandbox's network policy - test it early and cheaply:
  cpanel_ssh_exec site=${siteKey} command="echo ok"
If that fails in a cloud session but works locally, do design/build/test work in
the cloud and run actual deploys (cpanel_deploy, cpanel_rollback) from a session
that has real network access to the host.
`);
} else {
  console.log(`Inherited from the toolkit (not copied into the project):
  ssh host      ${sshHost}
  ssh key       ${identity}
  cPanel token  env var named in the toolkit config's defaults.cpanel.apiTokenEnv

This project depends on the toolkit staying cloned at ${KIT_ROOT} - fine for
managing several sites from this machine, but it will NOT work if this project
is opened somewhere that toolkit clone is not present (a teammate's machine, or
a Claude Code Cloud session). For a project that needs to stand on its own,
re-run with --standalone.
`);
}

console.log(`This project ships with BOTH a staging and a production environment, on purpose.
Keep the staging block - a test environment alongside production is strongly
recommended, and the tooling warns when a production site has none.

Next:
  1. cd ${target}
  2. review cpanel.site.json - the remote paths are guesses until you check them
  3. claude, then run the /test-env-setup skill to build the staging environment first
  4. cpanel_preflight site=${siteKey} environment=staging   (verify staging before prod)
  5. deploy to staging, verify, and only then cut a production release
`);
