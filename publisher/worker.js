// Crowders Camps calendar publisher (Cloudflare Worker).
//
// Lets anyone working in the Crowders Camps shared Claude environment put a new calendar page on the
// public website without GitHub access. Claude builds the page with tools/sync_page.py and POSTs it here;
// this Worker checks it again and commits it as index.html in Crowders-Camps/crowders-calendar.
//
// Secrets (set with `wrangler secret put`, never in this file):
//   PUBLISH_KEY   the key Claude sessions present. Stored as a network secret on the shared Claude
//                 environment, so the agent proxy adds "Authorization: Bearer <key>" and nobody sees it.
//   GITHUB_TOKEN  fine-grained GitHub token: Contents read and write on Crowders-Camps/crowders-calendar only.
// Vars (wrangler.toml): REPO, BRANCH.
//
// It only ever writes index.html. data.js stays with the 5:47 AM daily build.

// Keep in step with tools/forbidden.json (publisher/test.mjs checks they match).
export const FORBIDDEN = [
  ["connector call", "\\bwatchTool\\b|\\bcallTool\\b|use\\?\\.\\(\\s*[\"']mcp[\"']"],
  ["Google Sheet link or ID", "docs\\.google\\.com|spreadsheets/d/|spreadsheetId|\\b1[A-Za-z0-9_-]{40,}\\b"],
  ["Google Calendar ID", "calendarId|calendar\\.google\\.com|@group\\.calendar"],
  ["email address", "[\\w.+-]+@[\\w-]+\\.(?:com|org|net|edu|gov|us|io)\\b"],
  ["phone number", "\\(?\\b\\d{3}\\)?[\\s.-]\\d{3}[\\s.-]\\d{4}\\b"],
  ["financial wording", "\\b(revenue|balance due|amount due|deposit paid|payment|invoice)\\b"],
  ["leftover private marker", "@private|@/private|@public"],
];

const MAX_BYTES = 1_500_000;
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 1), { status, headers: { "content-type": "application/json" } });

async function sameKey(a, b) {
  // Compare hashes so the check takes the same time whatever the key.
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

function authorized(req, env) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m || !env.PUBLISH_KEY) return Promise.resolve(false);
  return sameKey(m[1].trim(), env.PUBLISH_KEY);
}

// The same checks tools/sync_page.py runs, so a page that skipped that step is still refused.
export function checkPage(html) {
  const problems = [];
  if (!/^<!doctype html>/i.test(html)) problems.push({ what: "not a full page (no <!doctype html>)" });
  if ((html.match(/<script src="data\.js"><\/script>/g) || []).length !== 1)
    problems.push({ what: 'must load events with exactly one <script src="data.js"></script>' });
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi))
    if (m[1] !== "data.js") problems.push({ what: "loads an outside script", text: m[1].slice(0, 60) });
  for (const [label, pat] of FORBIDDEN) {
    for (const m of html.matchAll(new RegExp(pat, "gi"))) {
      const line = html.slice(0, m.index).split("\n").length;
      problems.push({ what: label, line, text: m[0].slice(0, 40) });
      if (problems.length >= 20) return problems;
    }
  }
  return problems;
}

const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function github(env, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${env.REPO}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "crowders-calendar-publisher",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!(await authorized(req, env))) return json({ result: "refused", why: "missing or wrong publish key" }, 401);

    if (req.method === "GET" && url.pathname === "/check")
      return json({ result: "ok", repo: env.REPO, branch: env.BRANCH, github_token: !!env.GITHUB_TOKEN });

    if (req.method !== "POST" || url.pathname !== "/publish") return json({ result: "refused", why: "use POST /publish" }, 404);

    let body;
    try { body = await req.json(); } catch { return json({ result: "refused", why: "send JSON: {html, by, note}" }, 400); }
    const html = typeof body.html === "string" ? body.html : "";
    if (!html || new TextEncoder().encode(html).length > MAX_BYTES) return json({ result: "refused", why: "html missing or too large" }, 400);
    const by = String(body.by || "").replace(/[^\p{L} .'-]/gu, "").trim().slice(0, 40) || "a team member";
    const note = String(body.note || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);

    const problems = checkPage(html);
    if (problems.length) return json({ result: "blocked", why: "the page would include private content or is malformed", problems }, 422);

    const ref = encodeURIComponent(env.BRANCH || "main");
    const cur = await github(env, "GET", `contents/index.html?ref=${ref}`);
    if (!cur.ok) return json({ result: "error", why: `reading the current page from GitHub failed (${cur.status})` }, 502);
    if (b64decode(cur.data.content || "") === html) return json({ result: "unchanged" });

    const message = `Page update from the Master Calendar (asked by ${by})${note ? ": " + note : ""}`;
    const put = await github(env, "PUT", "contents/index.html", {
      message,
      content: b64encode(html),
      sha: cur.data.sha,
      branch: env.BRANCH || "main",
      committer: { name: "Calendar publisher", email: "noreply@anthropic.com" },
    });
    if (!put.ok) return json({ result: "error", why: `committing to GitHub failed (${put.status})`, detail: put.data.message }, 502);
    return json({ result: "published", commit: put.data.commit && put.data.commit.html_url, message });
  },
};
