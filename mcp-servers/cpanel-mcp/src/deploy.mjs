import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { getSite, getEnvironment, expandHome } from "./config.mjs";
import { sshExec, sshExecOrThrow, tarToRemote, shq } from "./ssh.mjs";

/* ---------------------------------------------------------------- helpers */

export function releaseId(sourceDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  let sha = "";
  try {
    sha = execFileSync("git", ["-C", sourceDir, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* not a git repo - a timestamp alone is a fine release id */
  }
  return sha ? `${ts}-${sha}` : ts;
}

export function gitState(dir) {
  const run = (args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const porcelain = run(["status", "--porcelain"]);
    return {
      isRepo: true,
      branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
      sha: run(["rev-parse", "HEAD"]),
      shortSha: run(["rev-parse", "--short", "HEAD"]),
      dirty: porcelain.length > 0,
      dirtyFiles: porcelain.split("\n").filter(Boolean).slice(0, 20),
    };
  } catch {
    return { isRepo: false, branch: null, sha: null, shortSha: null, dirty: false, dirtyFiles: [] };
  }
}

function matchesExclude(rel, excludes) {
  const base = path.basename(rel);
  return excludes.some((pat) => {
    if (pat.includes("*")) {
      const rx = new RegExp(
        "^" + pat.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$"
      );
      return rx.test(base) || rx.test(rel);
    }
    return base === pat || rel === pat || rel.startsWith(pat + "/");
  });
}

/** Walk a local directory into a sorted list of POSIX-relative file paths, honouring excludes. */
export function localManifest(root, excludes = []) {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (matchesExclude(rel, excludes)) continue;
      if (ent.isDirectory()) walk(abs);
      else out.push(rel);
    }
  })(root);
  return out.sort();
}

export function resolveSource(site, env) {
  const repo = expandHome(site.repo || process.cwd());
  const sub = env.source && env.source !== "." ? env.source : "";
  const dir = sub ? path.join(repo, sub) : repo;
  if (!fs.existsSync(dir)) {
    throw new Error(
      `Local source directory does not exist: ${dir} (site.repo=${site.repo}, environment.source=${env.source ?? "."})`
    );
  }
  return dir;
}

function healthUrl(env) {
  if (!env.url) return null;
  return env.url.replace(/\/$/, "") + (env.healthPath ?? "/");
}

/* ------------------------------------------------------------ health check */

export function httpCheck(url, { expectStatus = 200, timeoutMs = 20000, expectText = null } = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith("http://") ? http : https;
    const started = Date.now();
    const req = lib.get(url, { timeout: timeoutMs, headers: { "User-Agent": "cpanel-mcp/health" } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        if (size < 65536) { chunks.push(c); size += c.length; }
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const ms = Date.now() - started;
        const statusOk = res.statusCode === expectStatus;
        const textOk = expectText ? body.includes(expectText) : true;
        resolve({
          url,
          ok: statusOk && textOk,
          status: res.statusCode,
          expectStatus,
          ms,
          textOk,
          snippet: body.slice(0, 300),
          server: res.headers.server ?? null,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, ok: false, status: null, error: `timed out after ${timeoutMs}ms` });
    });
    req.on("error", (e) => resolve({ url, ok: false, status: null, error: e.message }));
  });
}

/* ----------------------------------------------------------------- preflight */

export async function preflight(siteName, envName) {
  const { site, env } = getEnvironment(siteName, envName);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  let sourceDir = null;
  try {
    sourceDir = resolveSource(site, env);
    add("local source exists", true, sourceDir);
  } catch (e) {
    add("local source exists", false, e.message);
  }

  if (sourceDir) {
    const files = localManifest(sourceDir, env.excludes ?? []);
    add("local files to ship", files.length > 0, `${files.length} files after excludes`);
    const g = gitState(expandHome(site.repo || sourceDir));
    if (g.isRepo) {
      add(
        "git worktree clean",
        !g.dirty,
        g.dirty
          ? `${g.dirtyFiles.length}+ uncommitted change(s): ${g.dirtyFiles.slice(0, 5).join(", ")}`
          : `${g.branch} @ ${g.shortSha}`
      );
    } else {
      add("git worktree clean", true, "not a git repo - skipped");
    }
  }

  const ping = await sshExec(siteName, "echo cpanel-mcp-ok && id -un && umask", { timeoutMs: 25000 });
  add(
    "ssh reachable",
    ping.ok && ping.stdout.includes("cpanel-mcp-ok"),
    ping.ok ? ping.stdout.trim().split("\n").join(" | ") : ping.stderr || `exit ${ping.code}`
  );

  if (ping.ok) {
    const targets =
      env.strategy === "symlink" ? [env.releases, path.posix.dirname(env.currentLink)] : [env.docroot];
    if (env.backups) targets.push(env.backups);
    for (const t of targets.filter(Boolean)) {
      const r = await sshExec(siteName, `mkdir -p ${shq(t)} && test -w ${shq(t)} && echo writable`, {
        timeoutMs: 25000,
      });
      add(`remote path writable: ${t}`, r.ok && r.stdout.includes("writable"), r.ok ? "ok" : r.stderr || `exit ${r.code}`);
    }

    const df = await sshExec(siteName, 'df -Pk "$HOME" | tail -1', { timeoutMs: 25000 });
    if (df.ok) {
      const cols = df.stdout.trim().split(/\s+/);
      const availMb = Math.round(Number(cols[3] ?? 0) / 1024);
      add("disk space", availMb > 100, `${availMb} MB available on ${cols[5] ?? "?"}`);
    } else {
      add("disk space", false, df.stderr || "df failed");
    }

    if (site.kind === "php") {
      const php = await sshExec(siteName, "php -v 2>/dev/null | head -1", { timeoutMs: 25000 });
      const reported = php.stdout.trim();
      add(
        "remote php present",
        !!reported,
        reported
          ? `${reported}${site.phpVersion ? ` (config expects ${site.phpVersion})` : ""}`
          : "php is not on the ssh PATH - cPanel usually needs the ea-php binary, e.g. /usr/local/bin/ea-php82"
      );
    }
    if (site.kind === "node" && site.node?.venvActivate) {
      const r = await sshExec(siteName, `test -f ${shq(site.node.venvActivate)} && echo present`, { timeoutMs: 25000 });
      add("node venv activate script", r.stdout.includes("present"), site.node.venvActivate);
    }
  }

  const hu = healthUrl(env);
  if (hu) {
    const h = await httpCheck(hu, { expectStatus: env.expectStatus ?? 200 });
    add("site currently responds", h.ok, h.error ?? `HTTP ${h.status} in ${h.ms}ms`);
  }

  return {
    site: siteName,
    environment: envName,
    strategy: env.strategy,
    ok: checks.every((c) => c.ok),
    failed: checks.filter((c) => !c.ok).map((c) => c.name),
    checks,
  };
}

/* ------------------------------------------------------------------ backup */

export async function backup(siteName, envName, { label = "manual" } = {}) {
  const { env } = getEnvironment(siteName, envName);
  if (!env.backups) throw new Error(`${siteName}/${envName}: no "backups" path configured.`);
  const target = env.strategy === "symlink" ? env.currentLink : env.docroot;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const file = path.posix.join(env.backups, `${envName}-${stamp}-${label}.tar.gz`);

  const exists = await sshExec(siteName, `test -e ${shq(target)} && echo yes || echo no`);
  if (exists.stdout.trim() === "no") {
    return { skipped: true, reason: `nothing at ${target} to back up yet`, file: null };
  }
  await sshExecOrThrow(
    siteName,
    `mkdir -p ${shq(env.backups)} && tar czhf ${shq(file)} -C ${shq(path.posix.dirname(target))} ${shq(
      path.posix.basename(target)
    )}`,
    { timeoutMs: 900000 }
  );
  const size = await sshExec(siteName, `du -h ${shq(file)} | cut -f1`);
  return { skipped: false, file, size: size.stdout.trim(), of: target };
}

export async function listBackups(siteName, envName) {
  const { env } = getEnvironment(siteName, envName);
  if (!env.backups) return { dir: null, backups: [] };
  const r = await sshExec(siteName, `ls -1t ${shq(env.backups)} 2>/dev/null | head -50`);
  return { dir: env.backups, backups: r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) };
}

/* ----------------------------------------------------------------- releases */

export async function listReleases(siteName, envName) {
  const { env } = getEnvironment(siteName, envName);
  if (env.strategy !== "symlink") {
    return {
      strategy: env.strategy,
      note: "the sync strategy keeps no release history - look at backups instead",
      releases: [],
    };
  }
  const r = await sshExec(siteName, `ls -1t ${shq(env.releases)} 2>/dev/null`);
  const cur = await sshExec(siteName, `readlink ${shq(env.currentLink)} 2>/dev/null || true`);
  const current = path.posix.basename(cur.stdout.trim() || "");
  const releases = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    strategy: "symlink",
    releasesDir: env.releases,
    current,
    releases: releases.map((n) => ({ id: n, current: n === current })),
  };
}

/* ------------------------------------------------------------------- deploy */

export async function deploy(
  siteName,
  envName,
  { confirm = false, note = "", skipBackup = false, prune = true } = {}
) {
  const { site, env } = getEnvironment(siteName, envName);
  if (env.requireApproval && !confirm) {
    throw new Error(
      `${siteName}/${envName} is marked requireApproval in the site config. ` +
        `Ask the human to approve this release, then re-run with confirm:true.`
    );
  }
  const sourceDir = resolveSource(site, env);
  const excludes = env.excludes ?? [];
  const files = localManifest(sourceDir, excludes);
  if (files.length === 0) {
    throw new Error(`Nothing to deploy: ${sourceDir} has no files after excludes (${excludes.join(", ")}).`);
  }

  const id = releaseId(expandHome(site.repo || sourceDir));
  const git = gitState(expandHome(site.repo || sourceDir));
  const steps = [];
  const step = (name, detail) => steps.push({ name, detail });

  let backupInfo = null;
  if (!skipBackup && env.backups) {
    backupInfo = await backup(siteName, envName, { label: "pre-deploy" });
    step("backup", backupInfo.skipped ? backupInfo.reason : `${backupInfo.file} (${backupInfo.size})`);
  }

  if (env.strategy === "symlink") {
    const dir = path.posix.join(env.releases, id);
    await sshExecOrThrow(siteName, `mkdir -p ${shq(dir)}`);
    await tarToRemote(siteName, sourceDir, dir, { excludes });
    step("upload", `${files.length} files -> ${dir}`);

    for (const sp of env.sharedPaths ?? []) {
      if (!env.shared) {
        throw new Error(`sharedPaths is configured but the "shared" base path is missing for ${siteName}/${envName}.`);
      }
      const from = path.posix.join(env.shared, sp);
      const to = path.posix.join(dir, sp);
      await sshExecOrThrow(
        siteName,
        `mkdir -p ${shq(path.posix.dirname(from))} ${shq(path.posix.dirname(to))} && rm -rf ${shq(to)} && ln -sfn ${shq(
          from
        )} ${shq(to)}`
      );
    }
    if ((env.sharedPaths ?? []).length) step("shared paths linked", (env.sharedPaths ?? []).join(", "));

    for (const cmd of env.postDeploy ?? []) {
      const r = await sshExecOrThrow(siteName, `cd ${shq(dir)} && ${cmd}`, { timeoutMs: 600000 });
      step("postDeploy", `${cmd} -> ${(r.stdout || "(no output)").trim().slice(0, 200)}`);
    }

    // Atomic swap: create the new link beside the old one, then rename over it in one step.
    const tmp = `${env.currentLink}.tmp`;
    await sshExecOrThrow(siteName, `ln -sfn ${shq(dir)} ${shq(tmp)} && mv -Tf ${shq(tmp)} ${shq(env.currentLink)}`);
    step("activate", `${env.currentLink} -> ${dir}`);

    const keep = Number(env.keepReleases ?? 5);
    if (keep > 0) {
      const pr = await sshExec(
        siteName,
        `cd ${shq(env.releases)} && ls -1t | tail -n +${keep + 1} | xargs -r -I{} rm -rf -- {}`
      );
      if (pr.ok) step("prune", `kept the newest ${keep} releases`);
    }
  } else {
    const manifestPath = path.posix.join(env.docroot, ".deploy-manifest");
    const oldManifest = await sshExec(siteName, `cat ${shq(manifestPath)} 2>/dev/null || true`);
    const previous = new Set(oldManifest.stdout.split("\n").map((s) => s.trim()).filter(Boolean));

    const manifestFile = path.join(sourceDir, ".deploy-manifest");
    fs.writeFileSync(manifestFile, files.join("\n") + "\n", "utf8");
    try {
      await tarToRemote(siteName, sourceDir, env.docroot, { excludes });
    } finally {
      fs.rmSync(manifestFile, { force: true });
    }
    step("upload", `${files.length} files -> ${env.docroot}`);

    if (prune && previous.size) {
      const now = new Set(files);
      const gone = [...previous].filter((f) => !now.has(f) && f !== ".deploy-manifest");
      if (gone.length) {
        for (let i = 0; i < gone.length; i += 100) {
          const list = gone.slice(i, i + 100).map((f) => shq(path.posix.join(env.docroot, f))).join(" ");
          await sshExec(siteName, `rm -f -- ${list}`, { timeoutMs: 120000 });
        }
        step("prune", `${gone.length} file(s) removed that are no longer in the source`);
      } else {
        step("prune", "nothing to remove");
      }
    }

    for (const cmd of env.postDeploy ?? []) {
      const r = await sshExecOrThrow(siteName, `cd ${shq(env.docroot)} && ${cmd}`, { timeoutMs: 600000 });
      step("postDeploy", `${cmd} -> ${(r.stdout || "(no output)").trim().slice(0, 200)}`);
    }
  }

  if (env.restartNodeApp || site.kind === "node") {
    const r = await restartNodeApp(siteName);
    step("node app", r.detail);
  }

  let health = null;
  const hu = healthUrl(env);
  if (hu) {
    await new Promise((r) => setTimeout(r, 1500));
    health = await httpCheck(hu, { expectStatus: env.expectStatus ?? 200, expectText: env.expectText ?? null });
    step(
      "health check",
      health.ok ? `HTTP ${health.status} in ${health.ms}ms` : health.error ?? `HTTP ${health.status}, expected ${health.expectStatus}`
    );
  }

  return {
    site: siteName,
    environment: envName,
    strategy: env.strategy,
    release: id,
    note,
    git: { branch: git.branch, sha: git.shortSha, dirty: git.dirty },
    fileCount: files.length,
    backup: backupInfo,
    steps,
    health,
    ok: !health || health.ok,
    rollbackHint:
      env.strategy === "symlink"
        ? `cpanel_rollback site=${siteName} environment=${envName} confirm=true - repoints ${env.currentLink} at the previous release`
        : `cpanel_rollback site=${siteName} environment=${envName} confirm=true - restores ${backupInfo?.file ?? "the newest backup"}`,
  };
}

/* ----------------------------------------------------------------- rollback */

export async function rollback(siteName, envName, { to = null, confirm = false } = {}) {
  if (!confirm) throw new Error("Rollback changes what is live. Re-run with confirm:true.");
  const { env } = getEnvironment(siteName, envName);

  if (env.strategy === "symlink") {
    const { releases, current } = await listReleases(siteName, envName);
    const ids = releases.map((r) => r.id);
    let target = to;
    if (!target) {
      const idx = ids.indexOf(current);
      target = idx >= 0 ? ids[idx + 1] : ids[0];
      if (!target) throw new Error(`No previous release to roll back to (found: ${ids.join(", ") || "none"}).`);
    }
    if (!ids.includes(target)) {
      throw new Error(`Release "${target}" not found in ${env.releases}. Available: ${ids.join(", ")}`);
    }
    const dir = path.posix.join(env.releases, target);
    const tmp = `${env.currentLink}.tmp`;
    await sshExecOrThrow(
      siteName,
      `test -d ${shq(dir)} && ln -sfn ${shq(dir)} ${shq(tmp)} && mv -Tf ${shq(tmp)} ${shq(env.currentLink)}`
    );
    const hu = healthUrl(env);
    const health = hu ? await httpCheck(hu, { expectStatus: env.expectStatus ?? 200 }) : null;
    return { site: siteName, environment: envName, rolledBackFrom: current, rolledBackTo: target, health, ok: !health || health.ok };
  }

  const { backups, dir } = await listBackups(siteName, envName);
  const file = to ?? backups[0];
  if (!file) throw new Error(`No backups found in ${dir ?? "(no backups path configured)"} to restore from.`);
  const full = file.startsWith("/") ? file : path.posix.join(dir, file);
  const parent = path.posix.dirname(env.docroot);
  const base = path.posix.basename(env.docroot);
  const stash = `${base}.rollback-old`;
  await sshExecOrThrow(
    siteName,
    `test -f ${shq(full)} && cd ${shq(parent)} && rm -rf ${shq(stash)} && mv ${shq(base)} ${shq(stash)} && ` +
      `tar xzf ${shq(full)} -C ${shq(parent)} && rm -rf ${shq(stash)}`,
    { timeoutMs: 900000 }
  );
  const hu = healthUrl(env);
  const health = hu ? await httpCheck(hu, { expectStatus: env.expectStatus ?? 200 }) : null;
  return { site: siteName, environment: envName, restored: full, health, ok: !health || health.ok };
}

/* --------------------------------------------------------- Passenger / Node */

export async function restartNodeApp(siteName) {
  const site = getSite(siteName);
  const n = site.node;
  if (!n?.appRoot) {
    return { ok: false, detail: `site "${siteName}" has no node.appRoot configured - nothing to restart` };
  }
  await sshExecOrThrow(
    siteName,
    `mkdir -p ${shq(path.posix.join(n.appRoot, "tmp"))} && touch ${shq(path.posix.join(n.appRoot, "tmp", "restart.txt"))}`
  );
  return {
    ok: true,
    detail: `touched ${path.posix.join(n.appRoot, "tmp", "restart.txt")} - Passenger respawns the app on the next request`,
  };
}

export async function nodeInstall(siteName) {
  const site = getSite(siteName);
  const n = site.node;
  if (!n?.appRoot) throw new Error(`Site "${siteName}" has no node.appRoot configured.`);
  const inner = n.venvActivate
    ? `source ${shq(n.venvActivate)} && cd ${shq(n.appRoot)} && ${n.installCommand ?? "npm ci --omit=dev"}`
    : `cd ${shq(n.appRoot)} && ${n.installCommand ?? "npm ci --omit=dev"}`;
  const r = await sshExecOrThrow(siteName, `bash -lc ${shq(inner)}`, { timeoutMs: 900000 });
  return { ok: true, output: r.stdout.slice(-4000) };
}
