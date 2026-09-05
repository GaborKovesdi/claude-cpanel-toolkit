import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT_ROOT = path.resolve(HERE, "..", "..", "..");

/** Minimal .env reader - no dependency, no export side effects beyond process.env. */
export function loadDotEnv(file = path.join(KIT_ROOT, ".env")) {
  if (!fs.existsSync(file)) return 0;
  let n = 0;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) { process.env[key] = val; n++; }
  }
  return n;
}

export function configPath() {
  if (process.env.CPANEL_SITES_FILE) return path.resolve(process.env.CPANEL_SITES_FILE);
  const local = path.join(KIT_ROOT, "config", "sites.json");
  if (fs.existsSync(local)) return local;
  const cwdLocal = path.resolve(process.cwd(), ".cpanel", "sites.json");
  if (fs.existsSync(cwdLocal)) return cwdLocal;
  return local; // reported as missing by loadConfig
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

/**
 * A project created from templates/site-project carries a cpanel.site.json describing
 * only itself. It is overlaid on the toolkit config, so the shared SSH key and cPanel
 * account declared once in the toolkit's defaults apply to it without being repeated.
 */
export function projectConfigPath() {
  if (process.env.CPANEL_PROJECT_FILE) return path.resolve(process.env.CPANEL_PROJECT_FILE);
  const p = path.resolve(process.cwd(), "cpanel.site.json");
  return fs.existsSync(p) ? p : null;
}

let cached = null;
export function loadConfig({ force = false } = {}) {
  if (cached && !force) return cached;
  // Toolkit-wide secrets first, then anything project-local. Already-set vars win,
  // so the toolkit .env is the authority for the shared cPanel token and SSH key.
  loadDotEnv();
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const base = configPath();
  const project = projectConfigPath();
  const sources = [];
  let defaults = {};
  let sites = {};

  if (fs.existsSync(base)) {
    const parsed = readJson(base);
    defaults = parsed.defaults ?? {};
    sites = { ...(parsed.sites ?? {}) };
    sources.push(base);
  }

  if (project) {
    const parsed = readJson(project);
    // Shape A: a full config fragment. Shape B: one site, with its key in "site".
    if (parsed.sites) {
      sites = { ...sites, ...parsed.sites };
      defaults = { ...defaults, ...(parsed.defaults ?? {}) };
    } else {
      const key = parsed.site ?? path.basename(path.dirname(project));
      const { site: _ignored, $comment, $schema, ...fields } = parsed;
      sites = { ...sites, [key]: { repo: path.dirname(project), ...fields } };
    }
    sources.push(project);
  }

  if (!sources.length) {
    throw new Error(
      `No site config found. Expected ${base} (copy config/sites.example.json and fill it in), ` +
        `a cpanel.site.json in the current directory, or CPANEL_SITES_FILE / CPANEL_PROJECT_FILE.`
    );
  }

  cached = { file: sources[sources.length - 1], sources, defaults, sites };
  return cached;
}

/**
 * Blocks in `defaults` that a site inherits field by field.
 *
 * This is what lets one fixed SSH key (and one cPanel host/user) be declared once
 * at the top of sites.json and picked up by every site, including sites added later
 * from the project template. A site that sets the same field wins.
 */
const INHERITED_BLOCKS = ["ssh", "cpanel", "node"];

function inherit(defaults, site) {
  const merged = { ...site };
  for (const block of INHERITED_BLOCKS) {
    const d = defaults?.[block];
    const s = site?.[block];
    if (d || s) merged[block] = { ...(d ?? {}), ...(s ?? {}) };
  }
  return merged;
}

export function listSites() {
  const cfg = loadConfig();
  return Object.keys(cfg.sites).map((name) => {
    const s = getSite(name);
    return {
      name,
      label: s.label ?? name,
      kind: s.kind ?? "php",
      environments: Object.keys(s.environments ?? {}),
      cpanelUser: s.cpanel?.user ?? null,
      sshHost: s.ssh?.host ?? null,
      identityFile: s.ssh?.identityFile ?? null,
    };
  });
}

export function getSite(name) {
  const cfg = loadConfig();
  const site = cfg.sites[name];
  if (!site) {
    const known = Object.keys(cfg.sites).join(", ") || "(none configured)";
    throw new Error(`Unknown site "${name}". Configured sites: ${known}`);
  }
  return { ...inherit(cfg.defaults, site), name, _defaults: cfg.defaults };
}

export function getEnvironment(siteName, envName) {
  const site = getSite(siteName);
  const envs = site.environments ?? {};
  const env = envs[envName];
  if (!env) {
    const known = Object.keys(envs).join(", ") || "(none)";
    throw new Error(`Site "${siteName}" has no environment "${envName}". Known: ${known}`);
  }
  const merged = { ...site._defaults, ...env, name: envName };
  if (merged.strategy === "symlink") {
    for (const k of ["currentLink", "releases"]) {
      if (!merged[k]) throw new Error(`${siteName}/${envName}: strategy "symlink" requires "${k}" in the config.`);
    }
  } else if (merged.strategy === "sync") {
    if (!merged.docroot) throw new Error(`${siteName}/${envName}: strategy "sync" requires "docroot".`);
  } else {
    throw new Error(`${siteName}/${envName}: strategy must be "symlink" or "sync", got ${JSON.stringify(merged.strategy)}.`);
  }
  return { site, env: merged };
}

/** Reads a secret by env-var name. Never returns the value in error text. */
export function secret(envVarName, { what = "secret" } = {}) {
  if (!envVarName) throw new Error(`No env var configured for ${what}.`);
  const v = process.env[envVarName];
  if (!v) throw new Error(`Env var ${envVarName} is not set (needed for ${what}). Add it to ${path.join(KIT_ROOT, ".env")} or the shell environment.`);
  return v;
}

export function expandHome(p) {
  if (!p) return p;
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Strips anything that looks like a token out of text before it reaches a transcript. */
export function redact(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/(cpanel\s+[\w-]+:)[A-Z0-9]{8,}/gi, "$1<redacted>")
    .replace(/(Authorization:\s*\S+\s+)\S+/gi, "$1<redacted>")
    .replace(/([?&](?:api_?token|token|password|pass)=)[^&\s]+/gi, "$1<redacted>");
}
