/**
 * Single source of truth for what this server can do.
 *
 * Every tool is a plain object with a JSON Schema and an async handler, so the
 * same registry drives both frontends: src/server.mjs (MCP over stdio) and
 * bin/cpanelctl.mjs (a human CLI). Nothing here imports the MCP SDK.
 */
import path from "node:path";
import { listSites, getSite, getEnvironment, loadConfig } from "./config.mjs";
import { sshExec, assertSafeCommand, shq } from "./ssh.mjs";
import { uapi } from "./uapi.mjs";
import {
  preflight,
  deploy,
  rollback,
  backup,
  listBackups,
  listReleases,
  httpCheck,
  restartNodeApp,
  nodeInstall,
  testEnvironmentStatus,
} from "./deploy.mjs";

const str = (description) => ({ type: "string", description });
const bool = (description, def) => ({ type: "boolean", description, ...(def !== undefined ? { default: def } : {}) });
const int = (description, def) => ({ type: "integer", description, ...(def !== undefined ? { default: def } : {}) });

const SITE = str("Site key from config/sites.json (use cpanel_list_sites to see them).");
const ENVV = str('Environment key, e.g. "staging" or "production".');

function schema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

export const TOOLS = [
  /* ------------------------------------------------------------- discovery */
  {
    name: "cpanel_list_sites",
    description:
      "List every site and environment configured in this toolkit, with its kind (php/node), cPanel user and SSH host. Start here when you do not know the site key.",
    inputSchema: schema({}),
    handler: async () => {
      const cfg = loadConfig();
      // `sources` shows which files were merged - the toolkit config that carries the
      // shared SSH key, plus any project-local cpanel.site.json overlaid on top of it.
      const sites = listSites();
      // Flag any site that has a production environment but no separate test/staging one.
      const warnings = [];
      for (const s of sites) {
        const status = testEnvironmentStatus(getSite(s.name));
        s.hasTestEnv = status.hasTestEnv;
        if (!status.hasTestEnv) {
          warnings.push(
            `${s.name}: no test/staging environment - strongly recommended alongside production (see the test-env-setup skill).`
          );
        }
      }
      return { sources: cfg.sources, defaults: cfg.defaults, sites, warnings };
    },
  },
  {
    name: "cpanel_describe_site",
    description:
      "Full resolved configuration for one site: paths, deploy strategy per environment, PHP/Node settings. Secrets are never included - only the names of the env vars that hold them.",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: async ({ site }) => {
      const s = getSite(site);
      return {
        name: s.name,
        label: s.label,
        kind: s.kind,
        repo: s.repo,
        phpVersion: s.phpVersion ?? null,
        cpanel: s.cpanel ? { host: s.cpanel.host, port: s.cpanel.port ?? 2083, user: s.cpanel.user, apiTokenEnv: s.cpanel.apiTokenEnv } : null,
        ssh: s.ssh ? { host: s.ssh.host, port: s.ssh.port ?? 22, user: s.ssh.user, identityFile: s.ssh.identityFile } : null,
        node: s.node ?? null,
        database: s.database ? { ...s.database, password: undefined } : null,
        environments: Object.fromEntries(
          Object.keys(s.environments ?? {}).map((e) => [e, getEnvironment(site, e).env])
        ),
      };
    },
  },

  /* ------------------------------------------------------------- releasing */
  {
    name: "cpanel_preflight",
    description:
      "Run every pre-deploy check for a site/environment without changing anything: local source present, git worktree clean, SSH reachable, remote paths writable, disk space, PHP/Node runtime present, site currently responding. Always run this before cpanel_deploy.",
    inputSchema: schema({ site: SITE, environment: ENVV }, ["site", "environment"]),
    handler: ({ site, environment }) => preflight(site, environment),
  },
  {
    name: "cpanel_deploy",
    description:
      "Deploy the local source to a site/environment. Backs up first, uploads over SSH (tar stream), then either swaps an atomic symlink (strategy=symlink) or syncs into the docroot and prunes files that no longer exist (strategy=sync). Restarts a Passenger Node app when configured, then health-checks the URL. WRITES TO A LIVE SERVER - environments marked requireApproval refuse to run without confirm:true.",
    inputSchema: schema(
      {
        site: SITE,
        environment: ENVV,
        confirm: bool("Required for environments marked requireApproval. Set only after a human has approved this release.", false),
        note: str("Short release note recorded in the result, e.g. the changelog headline."),
        skipBackup: bool("Skip the pre-deploy backup. Only for throwaway environments.", false),
        prune: bool("sync strategy only: delete remote files that are no longer in the source.", true),
      },
      ["site", "environment"]
    ),
    destructive: true,
    handler: ({ site, environment, ...rest }) => deploy(site, environment, rest),
  },
  {
    name: "cpanel_rollback",
    description:
      "Put the previous version back. symlink strategy: repoints the current link at the previous release (near-instant). sync strategy: restores the newest pre-deploy backup tarball. Health-checks afterwards. WRITES TO A LIVE SERVER - requires confirm:true.",
    inputSchema: schema(
      {
        site: SITE,
        environment: ENVV,
        to: str("Specific release id or backup filename. Omit to go back exactly one step."),
        confirm: bool("Must be true.", false),
      },
      ["site", "environment"]
    ),
    destructive: true,
    handler: ({ site, environment, ...rest }) => rollback(site, environment, rest),
  },
  {
    name: "cpanel_releases",
    description: "List releases on the server for a symlink-strategy environment and show which one is currently live.",
    inputSchema: schema({ site: SITE, environment: ENVV }, ["site", "environment"]),
    handler: ({ site, environment }) => listReleases(site, environment),
  },
  {
    name: "cpanel_backup",
    description: "Take an on-demand tar.gz backup of what is currently live for an environment.",
    inputSchema: schema(
      { site: SITE, environment: ENVV, label: str('Short label folded into the filename, e.g. "before-php84".') },
      ["site", "environment"]
    ),
    handler: ({ site, environment, label }) => backup(site, environment, { label: label ?? "manual" }),
  },
  {
    name: "cpanel_list_backups",
    description: "List backup archives on the server for an environment, newest first.",
    inputSchema: schema({ site: SITE, environment: ENVV }, ["site", "environment"]),
    handler: ({ site, environment }) => listBackups(site, environment),
  },

  /* ---------------------------------------------------------------- health */
  {
    name: "cpanel_health",
    description:
      "HTTP-check one environment's health URL (or any URL you pass) and report status, latency, server headers and a body snippet.",
    inputSchema: schema({
      site: SITE,
      environment: ENVV,
      url: str("Check this URL instead of the configured one."),
      expectStatus: int("Expected HTTP status.", 200),
      expectText: str("Fail unless the body contains this string."),
    }),
    handler: async ({ site, environment, url, expectStatus, expectText }) => {
      let target = url;
      let expect = expectStatus;
      if (!target) {
        if (!site || !environment) throw new Error("Pass either url, or both site and environment.");
        const { env } = getEnvironment(site, environment);
        if (!env.url) throw new Error(`${site}/${environment} has no url configured.`);
        target = env.url.replace(/\/$/, "") + (env.healthPath ?? "/");
        expect = expectStatus ?? env.expectStatus ?? 200;
      }
      return httpCheck(target, { expectStatus: expect ?? 200, expectText: expectText ?? null });
    },
  },
  {
    name: "cpanel_error_log",
    description:
      "Tail the most useful log files for a site over SSH: the domain error_log, ~/logs/*, and the Passenger/Node stderr log. The fastest way to find out why a deploy went wrong.",
    inputSchema: schema(
      { site: SITE, lines: int("Lines per log file.", 40), grep: str("Only show lines matching this (case-insensitive) pattern.") },
      ["site"]
    ),
    handler: async ({ site, lines = 40, grep }) => {
      const s = getSite(site);
      const candidates = [];
      for (const e of Object.values(s.environments ?? {})) {
        if (e.docroot) candidates.push(path.posix.join(e.docroot, "error_log"));
        if (e.currentLink) candidates.push(path.posix.join(e.currentLink, "error_log"));
      }
      if (s.node?.appRoot) candidates.push(path.posix.join(s.node.appRoot, "stderr.log"));
      candidates.push("$HOME/logs/error_log", "$HOME/error_log");

      const filter = grep ? ` | grep -i -- ${shq(grep)}` : "";
      const parts = [...new Set(candidates)].map(
        (f) => `if [ -f ${f.startsWith("$") ? f : shq(f)} ]; then echo "===== ${f} ====="; tail -n ${Number(lines)} ${f.startsWith("$") ? f : shq(f)}${filter}; fi`
      );
      const r = await sshExec(site, parts.join("; "), { timeoutMs: 60000 });
      return { ok: r.ok, checked: [...new Set(candidates)], output: r.stdout.trim() || "(all candidate log files were empty or absent)", stderr: r.stderr };
    },
  },

  /* ------------------------------------------------------------------- ssh */
  {
    name: "cpanel_ssh_exec",
    description:
      "Run a shell command on the hosting account over SSH and return stdout/stderr/exit code. Obviously destructive patterns (rm -rf, mkfs, curl|sh, reboot, DROP DATABASE) are refused. Use this for anything the dedicated tools do not cover.",
    inputSchema: schema(
      { site: SITE, command: str("Command to run, as you would type it in the cPanel shell."), timeoutMs: int("Kill the command after this long.", 120000) },
      ["site", "command"]
    ),
    handler: async ({ site, command, timeoutMs = 120000 }) => {
      assertSafeCommand(command);
      const r = await sshExec(site, command, { timeoutMs });
      return { exitCode: r.code, ok: r.ok, stdout: r.stdout, stderr: r.stderr };
    },
  },
  {
    name: "cpanel_list_files",
    description: "List a remote directory with sizes, permissions and modification times.",
    inputSchema: schema({ site: SITE, remotePath: str("Absolute remote path."), all: bool("Include dotfiles.", true) }, ["site", "remotePath"]),
    handler: async ({ site, remotePath, all = true }) => {
      const r = await sshExec(site, `ls -l${all ? "A" : ""}h --time-style=long-iso ${shq(remotePath)}`);
      return { path: remotePath, ok: r.ok, listing: r.stdout.trim(), error: r.ok ? null : r.stderr };
    },
  },
  {
    name: "cpanel_read_file",
    description: "Read a remote text file (capped, so it is safe on logs). Use for .htaccess, config files, crontabs.",
    inputSchema: schema({ site: SITE, remotePath: str("Absolute remote path."), maxBytes: int("Byte cap.", 65536) }, ["site", "remotePath"]),
    handler: async ({ site, remotePath, maxBytes = 65536 }) => {
      const r = await sshExec(site, `head -c ${Number(maxBytes)} ${shq(remotePath)}`);
      return { path: remotePath, ok: r.ok, content: r.stdout, error: r.ok ? null : r.stderr };
    },
  },

  /* ----------------------------------------------------------- cPanel UAPI */
  {
    name: "cpanel_uapi",
    description:
      'Call any cPanel UAPI function with the account API token. Escape hatch for everything not wrapped by a dedicated tool - e.g. module "Email", function "list_pops". See https://api.docs.cpanel.net/ for modules and parameters.',
    inputSchema: schema(
      {
        site: SITE,
        module: str('UAPI module, e.g. "DomainInfo", "Cron", "Mysql", "Quota", "SSL", "Backup".'),
        func: str('UAPI function, e.g. "list_domains".'),
        params: { type: "object", description: "Query parameters for the function.", additionalProperties: true },
      },
      ["site", "module", "func"]
    ),
    handler: ({ site, module, func, params }) => uapi(site, module, func, params ?? {}),
  },
  {
    name: "cpanel_domains",
    description: "List the main domain, addon domains, subdomains and parked domains on the account (UAPI DomainInfo::list_domains).",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: async ({ site }) => (await uapi(site, "DomainInfo", "list_domains")).data,
  },
  {
    name: "cpanel_disk_usage",
    description: "Account disk quota and inode usage (UAPI Quota::get_quota_info) - check this before a big deploy or backup.",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: async ({ site }) => (await uapi(site, "Quota", "get_quota_info")).data,
  },
  {
    name: "cpanel_list_databases",
    description: "List MySQL databases and their users on the account (UAPI Mysql::list_databases).",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: async ({ site }) => (await uapi(site, "Mysql", "list_databases")).data,
  },
  {
    name: "cpanel_list_cron",
    description: "List the account's cron jobs (UAPI Cron::list_lines).",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: async ({ site }) => (await uapi(site, "Cron", "list_lines")).data,
  },
  {
    name: "cpanel_add_cron",
    description: "Add a cron job to the account (UAPI Cron::add_line). WRITES TO THE ACCOUNT - requires confirm:true.",
    inputSchema: schema(
      {
        site: SITE,
        command: str("Command to run. Use absolute paths - cron has a minimal PATH."),
        minute: str("Cron minute field.", ), hour: str("Cron hour field."),
        day: str("Cron day-of-month field."), month: str("Cron month field."), weekday: str("Cron day-of-week field."),
        confirm: bool("Must be true.", false),
      },
      ["site", "command", "minute", "hour", "day", "month", "weekday"]
    ),
    destructive: true,
    handler: async ({ site, command, minute, hour, day, month, weekday, confirm }) => {
      if (!confirm) throw new Error("Adding a cron job changes the live account. Re-run with confirm:true.");
      return (await uapi(site, "Cron", "add_line", { command, minute, hour, day, month, weekday })).data;
    },
  },
  {
    name: "cpanel_ssl_status",
    description: "Installed SSL certificates and their expiry dates (UAPI SSL::installed_hosts) - catch a certificate before it lapses.",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: async ({ site }) => {
      const d = (await uapi(site, "SSL", "installed_hosts")).data ?? [];
      const now = Date.now();
      return d.map((h) => ({
        domains: h.domains ?? h.servername,
        issuer: h.certificate?.issuer?.organizationName ?? null,
        notAfter: h.certificate?.not_after ? new Date(Number(h.certificate.not_after) * 1000).toISOString() : null,
        daysLeft: h.certificate?.not_after
          ? Math.round((Number(h.certificate.not_after) * 1000 - now) / 86400000)
          : null,
      }));
    },
  },

  /* ------------------------------------------------------- Passenger / Node */
  {
    name: "cpanel_node_restart",
    description: "Restart a cPanel Passenger Node.js app by touching tmp/restart.txt in its app root.",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: ({ site }) => restartNodeApp(site),
  },
  {
    name: "cpanel_node_install",
    description:
      "Run the install command (default: npm ci --omit=dev) inside the app's cPanel Node virtualenv. Needed after package.json changes; can take minutes.",
    inputSchema: schema({ site: SITE }, ["site"]),
    handler: ({ site }) => nodeInstall(site),
  },
];

export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** Validate args against a tool's schema just enough to give a helpful error. */
export function checkArgs(tool, args = {}) {
  const props = tool.inputSchema.properties ?? {};
  for (const req of tool.inputSchema.required ?? []) {
    if (args[req] === undefined || args[req] === "") throw new Error(`${tool.name}: missing required argument "${req}".`);
  }
  for (const key of Object.keys(args)) {
    if (!(key in props)) {
      throw new Error(`${tool.name}: unknown argument "${key}". Accepted: ${Object.keys(props).join(", ") || "(none)"}.`);
    }
  }
  return args;
}
