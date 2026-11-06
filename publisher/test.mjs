// Tests for the calendar publisher, with GitHub replaced by an in-memory fake.
// Run from the repo root:  node publisher/test.mjs [public page to try]
import { readFileSync } from "node:fs";
import worker, { FORBIDDEN, checkPage } from "./worker.js";

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok  ", m); };
const pageFile = process.argv[2] || "index.html";
const good = readFileSync(pageFile, "utf8");

assert(JSON.stringify(FORBIDDEN) === JSON.stringify(JSON.parse(readFileSync("tools/forbidden.json", "utf8"))),
  "worker's privacy list matches tools/forbidden.json");

// Fake GitHub contents API for index.html.
let stored = "<!doctype html>old page", sha = "sha-1", puts = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (!u.pathname.endsWith("/contents/index.html")) return new Response("{}", { status: 404 });
  if (init.headers.authorization !== "Bearer gh-token") return new Response("{}", { status: 401 });
  if ((init.method || "GET") === "GET")
    return Response.json({ sha, content: Buffer.from(stored, "utf8").toString("base64") });
  const b = JSON.parse(init.body);
  if (b.sha !== sha) return Response.json({ message: "sha mismatch" }, { status: 409 });
  stored = Buffer.from(b.content, "base64").toString("utf8"); sha = "sha-" + (puts.length + 2); puts.push(b);
  return Response.json({ commit: { html_url: "https://github.com/x/commit/" + sha } });
};

const env = { PUBLISH_KEY: "pub-key", GITHUB_TOKEN: "gh-token", REPO: "Crowders-Camps/crowders-calendar", BRANCH: "main" };
const call = (path, { method = "POST", key = "pub-key", body } = {}) =>
  worker.fetch(new Request("https://calendar-publisher.example.workers.dev" + path, {
    method, headers: key ? { authorization: "Bearer " + key, "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  }), env).then(async (r) => ({ status: r.status, ...(await r.json()) }));

let r = await call("/publish", { key: null, body: { html: good, by: "Noah" } });
assert(r.status === 401 && puts.length === 0, "no key: refused, nothing committed");
r = await call("/publish", { key: "wrong", body: { html: good, by: "Noah" } });
assert(r.status === 401 && puts.length === 0, "wrong key: refused, nothing committed");
r = await call("/check", { method: "GET" });
assert(r.result === "ok" && r.github_token === true, "GET /check with the key reports ready");

assert(checkPage(good).length === 0, `the real public page (${pageFile}) passes the checks`);
const leaks = [
  ["sheet ID", good.replace("</script>", 'const X="1TicYjZUdEBL6GAjUi3G1Wc9j5_BJeKjoJXP8ZBa-vuk";</script>')],
  ["staff calendar", good.replace("</script>", 'const C="crowderscamps.com_abc@group.calendar.google.com";</script>')],
  ["connector call", good.replace("</script>", 'mcp.callTool("Google Sheets","get_values",{});</script>')],
  ["phone number", good.replace("</body>", "<p>Call 704-555-0134</p></body>")],
  ["money wording", good.replace("</body>", "<p>Balance due: $400</p></body>")],
  ["outside script", good.replace("</head>", '<script src="https://evil.example/x.js"></script></head>')],
  ["artifact data path", good.replace('<script src="data.js"></script>', '<script src="data/events.js"></script>')],
  ["leftover marker", good.replace("</script>", "/*@private*/</script>")],
];
for (const [name, html] of leaks) {
  r = await call("/publish", { body: { html, by: "Noah" } });
  assert(r.status === 422 && r.result === "blocked" && puts.length === 0, `blocked: ${name}`);
}

r = await call("/publish", { body: { html: good, by: "Noah <script>", note: "New Housing view\nline two" } });
assert(r.result === "published" && stored === good && puts.length === 1, "good page: committed as index.html");
assert(puts[0].message === "Page update from the Master Calendar (asked by Noah script): New Housing view line two",
  "commit message names who asked, cleaned up");
r = await call("/publish", { body: { html: good, by: "Evan" } });
assert(r.result === "unchanged" && puts.length === 1, "same page again: no commit");
r = await call("/other", { body: { html: good } });
assert(r.status === 404, "any other path refused");
console.log("\nall publisher tests passed");
