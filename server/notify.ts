// Notification channels. Both optional; configure either or both.
//   RW_NTFY_URL    full topic URL, e.g. https://ntfy.sh/my-releases or https://ntfy.home.lan/releases
//   RW_NTFY_TOKEN  bearer token for protected topics (optional)
//   RW_WEBHOOK_URL generic JSON POST {title, body, tags, priority, click}

import { fetchT } from "./http";

export type Notice = {
  title: string;
  body: string;
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  click?: string;
};

export function channels() {
  return { ntfy: !!process.env.RW_NTFY_URL, webhook: !!process.env.RW_WEBHOOK_URL };
}

/** Returns how many channels accepted the notice. Never throws. */
export async function notify(n: Notice): Promise<number> {
  let ok = 0;
  const ntfy = process.env.RW_NTFY_URL;
  const hook = process.env.RW_WEBHOOK_URL;

  if (ntfy) {
    try {
      const headers: Record<string, string> = {
        // ntfy headers must be latin-1; keep titles ascii-safe
        Title: n.title.replace(/[^\x20-\x7E]/g, "?"),
        Priority: String(n.priority ?? 3),
      };
      if (n.tags?.length) headers.Tags = n.tags.join(",");
      if (n.click) headers.Click = n.click;
      if (process.env.RW_NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.RW_NTFY_TOKEN}`;
      const r = await fetchT(ntfy, { method: "POST", headers, body: n.body });
      if (r.ok) ok++;
      else console.error(`[WARN] ntfy ${r.status}`);
    } catch (e: any) {
      console.error(`[WARN] ntfy ${e.message}`);
    }
  }

  if (hook) {
    try {
      const r = await fetchT(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "release-watcher", ...n }),
      });
      if (r.ok) ok++;
      else console.error(`[WARN] webhook ${r.status}`);
    } catch (e: any) {
      console.error(`[WARN] webhook ${e.message}`);
    }
  }

  return ok;
}
