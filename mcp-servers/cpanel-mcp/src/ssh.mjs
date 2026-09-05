import { spawn } from "node:child_process";
import { getSite, expandHome, redact } from "./config.mjs";

/** Single-quote a string for POSIX sh. Safe for arbitrary content including quotes. */
export function shq(s) {
  return `'${String(s).replace(/'/g, `'\''`)}'`;
}

/** Commands that are never allowed through ssh_exec, however the caller phrases them. */
const HARD_DENY = [
  /\brm\s+(-\w*\s+)*-\w*[rf]/i,           // rm -rf and friends
  /\bmkfs\b|\bdd\s+if=/i,
  />\s*\/dev\/(sd|nvme)/i,
  /\bchown\s+-R\s+\/(?!home)/i,
  /\b(shutdown|reboot|halt|init\s+0)\b/i,
  /\bmysql(dump)?\b[^|]*\bdrop\s+database\b/i,
  /\b:\(\)\s*\{.*\};:/,                    // fork bomb
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/i,          // curl | sh
];

export function assertSafeCommand(cmd) {
  for (const rx of HARD_DENY) {
    if (rx.test(cmd)) {
      throw new Error(
        `Refused: the command matches a destructive pattern (${rx}). ` +
        `Run it by hand over your own ssh session if you truly intend it.`
      );
    }
  }
}

function sshArgs(site, { tty = false } = {}) {
  const s = site.ssh;
  if (!s?.host || !s?.user) throw new Error(`Site "${site.name}" has no ssh.host / ssh.user configured.`);
  const args = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-p", String(s.port ?? 22),
  ];
  if (s.identityFile) args.push("-i", expandHome(s.identityFile));
  if (!tty) args.push("-T");
  args.push(`${s.user}@${s.host}`);
  return args;
}

/** Run a remote command. stdinBuffer/stdinStream let callers pipe a tarball in. */
export function sshExec(siteName, command, { timeoutMs = 120000, stdin = null, captureBinary = false } = {}) {
  const site = getSite(siteName);
  const args = [...sshArgs(site), command];
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", args, { windowsHide: true });
    const out = [], err = [];
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeoutMs);

    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Could not run ssh: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdoutBuf = Buffer.concat(out);
      const stderr = redact(Buffer.concat(err).toString("utf8"));
      if (killed) return reject(new Error(`Remote command timed out after ${timeoutMs}ms: ${command.slice(0, 120)}`));
      resolve({
        code,
        stdout: captureBinary ? stdoutBuf : redact(stdoutBuf.toString("utf8")),
        stderr,
        ok: code === 0,
      });
    });

    if (stdin) {
      if (Buffer.isBuffer(stdin)) { child.stdin.end(stdin); }
      else { stdin.pipe(child.stdin); stdin.on("error", (e) => reject(e)); }
    } else {
      child.stdin.end();
    }
  });
}

/** Convenience: run and throw on non-zero exit. */
export async function sshExecOrThrow(siteName, command, opts = {}) {
  const r = await sshExec(siteName, command, opts);
  if (!r.ok) {
    throw new Error(`Remote command failed (exit ${r.code}): ${command.slice(0, 160)}\n${r.stderr || r.stdout}`.trim());
  }
  return r;
}

/** Stream a local directory to a remote directory: tar czf - -C src . | ssh 'tar xzf - -C dest' */
export function tarToRemote(siteName, localDir, remoteDir, { excludes = [], timeoutMs = 600000 } = {}) {
  const site = getSite(siteName);
  const tarArgs = ["czf", "-"];
  for (const ex of excludes) tarArgs.push(`--exclude=${ex}`);
  tarArgs.push("-C", localDir, ".");

  return new Promise((resolve, reject) => {
    const tar = spawn("tar", tarArgs, { windowsHide: true });
    const remote = `mkdir -p ${shq(remoteDir)} && tar xzf - -C ${shq(remoteDir)}`;
    const ssh = spawn("ssh", [...sshArgs(site), remote], { windowsHide: true });
    const err = [];
    let tarErr = "";

    const timer = setTimeout(() => { tar.kill("SIGKILL"); ssh.kill("SIGKILL"); }, timeoutMs);
    tar.on("error", (e) => { clearTimeout(timer); reject(new Error(`Could not run tar: ${e.message}`)); });
    ssh.on("error", (e) => { clearTimeout(timer); reject(new Error(`Could not run ssh: ${e.message}`)); });
    tar.stderr.on("data", (d) => { tarErr += d.toString("utf8"); });
    ssh.stderr.on("data", (d) => err.push(d));
    tar.stdout.pipe(ssh.stdin);

    ssh.on("close", (code) => {
      clearTimeout(timer);
      const stderr = redact(Buffer.concat(err).toString("utf8"));
      if (code !== 0) return reject(new Error(`Upload failed (ssh exit ${code}): ${stderr || tarErr}`));
      resolve({ ok: true, stderr, tarStderr: tarErr.trim() });
    });
  });
}
