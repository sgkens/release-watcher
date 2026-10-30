const UA = "release-watcher/0.3 (+https://github.com/sgkens/release-watcher)";
const TIMEOUT_MS = Number(process.env.RW_HTTP_TIMEOUT_MS ?? 15_000);

export class HttpError extends Error {
  constructor(public status: number, public url: string, detail?: string) {
    super(detail ?? `HTTP ${status} ${url}`);
  }
}

/** fetch with a hard timeout so one hung host can never stall the poller. */
export async function fetchT(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e: any) {
    if (e?.name === "TimeoutError") throw new HttpError(0, url, `timed out after ${TIMEOUT_MS / 1000}s: ${url}`);
    throw new HttpError(0, url, `${e?.message ?? "network error"}: ${url}`);
  }
}

/** Turn rate-limit responses into a readable message instead of a bare 403. */
function explain(res: Response, url: string): HttpError {
  const host = new URL(url).host;
  const remaining = res.headers.get("x-ratelimit-remaining") ?? res.headers.get("ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset") ?? res.headers.get("ratelimit-reset");
  const retry = res.headers.get("retry-after");
  if (res.status === 429 || ((res.status === 403 || res.status === 429) && remaining === "0")) {
    let when = "";
    if (reset && /^\d+$/.test(reset)) {
      // GitHub sends epoch seconds; GitLab/IETF send seconds-until-reset
      const n = Number(reset);
      const at = n > 1e9 ? n * 1000 : Date.now() + n * 1000;
      when = ` until ${new Date(at).toISOString().slice(11, 16)} UTC`;
    } else if (retry) when = ` (retry after ${retry}s)`;
    const env = "RW_TOKEN_" + host.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return new HttpError(res.status, url, `rate limited by ${host}${when} — set ${env} to raise the limit`);
  }
  if (res.status === 401) return new HttpError(401, url, `unauthorised at ${host} — check the token for this host`);
  return new HttpError(res.status, url);
}

export async function getJSON<T = any>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetchT(url, { headers: { "user-agent": UA, accept: "application/json", ...headers } });
  if (!res.ok) throw explain(res, url);
  return res.json() as Promise<T>;
}

export async function getText(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  const res = await fetchT(url, { headers: { "user-agent": UA, ...headers } });
  if (res.status === 404) return null;
  if (!res.ok) throw explain(res, url);
  return res.text();
}

/** Optional per-host tokens: RW_TOKEN_GITHUB_COM, RW_TOKEN_GITLAB_COM, RW_TOKEN_CODEBERG_ORG ... */
export function tokenFor(host: string): string | undefined {
  return process.env["RW_TOKEN_" + host.toUpperCase().replace(/[^A-Z0-9]/g, "_")];
}
