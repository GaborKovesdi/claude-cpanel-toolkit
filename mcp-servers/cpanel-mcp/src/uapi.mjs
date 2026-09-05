import https from "node:https";
import { getSite, secret, redact } from "./config.mjs";

/** Raw HTTPS JSON request. Uses node:https so per-site TLS relaxation is possible without extra deps. */
function request({ host, port, pathname, headers, method = "GET", body = null, insecure = false, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, port, path: pathname, method, headers, rejectUnauthorized: !insecure, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, text });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`Request to ${host} timed out after ${timeoutMs}ms`)));
    req.on("error", (e) => reject(new Error(redact(e.message))));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Call a cPanel UAPI function with an API token.
 * Docs shape: GET https://host:2083/execute/<Module>/<Function>?p=v
 * Auth header: "Authorization: cpanel <user>:<token>"
 */
export async function uapi(siteName, module, func, params = {}) {
  const site = getSite(siteName);
  const c = site.cpanel;
  if (!c?.host || !c?.user) throw new Error(`Site "${siteName}" has no cpanel.host / cpanel.user configured.`);
  const token = secret(c.apiTokenEnv, { what: `cPanel API token for ${siteName}` });

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    qs.append(k, String(v));
  }
  const pathname = `/execute/${encodeURIComponent(module)}/${encodeURIComponent(func)}${qs.toString() ? `?${qs}` : ""}`;

  const { status, text } = await request({
    host: c.host,
    port: c.port ?? 2083,
    pathname,
    method: "GET",
    insecure: !!c.insecureTLS,
    headers: { Authorization: `cpanel ${c.user}:${token}`, Accept: "application/json" },
  });

  if (status === 401 || status === 403) {
    throw new Error(`cPanel rejected the API token for ${siteName} (HTTP ${status}). Check ${c.apiTokenEnv} and the token's IP restrictions.`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`cPanel returned non-JSON (HTTP ${status}) for ${module}::${func}: ${redact(text).slice(0, 400)}`);
  }
  if (json.status !== 1) {
    const errs = (json.errors ?? ["unknown error"]).join("; ");
    throw new Error(`UAPI ${module}::${func} failed: ${redact(errs)}`);
  }
  return { data: json.data, messages: json.messages ?? [], warnings: json.warnings ?? [] };
}
