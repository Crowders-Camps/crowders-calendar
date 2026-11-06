#!/usr/bin/env python3
"""Build the public website page from the Master Calendar artifact's page.

Usage (from the root of the crowders-calendar repo):
    python3 -I tools/sync_page.py <artifact index.html> --check     # check only, write nothing
    python3 -I tools/sync_page.py <artifact index.html>             # check, then write index.html
    python3 -I tools/sync_page.py <artifact index.html> --payload publish.json --by "Noah" [--note "..."]
        # check, then write the request for the calendar publisher (see SYNC.md); index.html untouched

<artifact index.html> is the page exactly as the Artifact tool's read action saved it for
https://claude.ai/artifact/QrCvQLpKv96feXdaNtSTZq (the Master Calendar).

Every @private part of the page is replaced by its @public text, the website header (tools/head.html)
and the website-only menu lines (tools/web-only.js) are added, every script must pass `node --check`,
and the result is scanned with tools/forbidden.json (connector calls, Google Sheet/Calendar IDs, emails,
phone numbers, money wording). Any hit stops it and nothing is written. The publisher Worker runs the
same scan again before it commits.

Private parts are marked in the artifact page:
  HTML     <!--@private--> ... <!--@public (website text, may be empty) @/private-->
  JS/CSS   /*@private*/ ... /*@public (website text, may be empty) @/private*/

Prints JSON: {"result": "changed"|"unchanged"|"blocked", ...}. Exit code 1 when blocked.
"""
import json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_HTML = os.path.join(HERE, "..", "index.html")
HEAD = os.path.join(HERE, "head.html")
WEB_ONLY = os.path.join(HERE, "web-only.js")

HTML_BLOCK = re.compile(r"<!--@private-->.*?<!--@public(.*?)@/private-->", re.S)
JS_BLOCK = re.compile(r"/\*@private\*/.*?/\*@public(.*?)@/private\*/", re.S)
NOTE = re.compile(r"<!-- Public website sync:.*?-->\n?", re.S)

# Never on the public site: (label, pattern) pairs, shared with publisher/worker.js.
FORBIDDEN = json.load(open(os.path.join(HERE, "forbidden.json")))


def fail(why, **kw):
    print(json.dumps({"result": "blocked", "why": why, **kw}, indent=1))
    sys.exit(1)


def strip_skeleton(s):
    """The Artifact read adds the service's document wrapper; keep only what the page author wrote."""
    m = re.match(r"\s*<!doctype html><html><head>.*?</head><body>\n?", s, re.S | re.I)
    if m:
        s = s[m.end():]
    s = re.sub(r"\s*</body></html>\s*$", "\n", s)
    return s


def scripts(html):
    return re.findall(r"<script>(.*?)</script>", html, re.S)


def node_check(html, label):
    for n, js in enumerate(scripts(html)):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
            f.write(js)
        r = subprocess.run(["node", "--check", f.name], capture_output=True, text=True)
        os.unlink(f.name)
        if r.returncode:
            fail(f"{label} script {n + 1} does not parse", detail=r.stderr.strip().splitlines()[-3:])


def build_public(body):
    body = NOTE.sub("", body, count=1)
    body = HTML_BLOCK.sub(lambda m: m.group(1).strip(), body)
    body = JS_BLOCK.sub(lambda m: m.group(1).strip("\n") + "\n", body)
    if body.count('<script src="data/events.js"></script>') != 1:
        fail("the artifact page must load its events with exactly one <script src=\"data/events.js\"></script>")
    body = body.replace('<script src="data/events.js"></script>\n', "", 1).replace('<script src="data/events.js"></script>', "", 1)
    t = re.match(r"\s*(<title>.*?</title>)\n?", body, re.S)
    if not t:
        fail("the artifact page must start with its <title>")
    title, rest = t.group(1), body[t.end():]
    end = rest.rfind("</script>")
    if end < 0:
        fail("no closing </script> found")
    web_only = open(WEB_ONLY).read()
    rest = rest[:end] + "\n" + web_only + rest[end:]
    return open(HEAD).read() + title + "\n</head>\n<body>\n\n" + rest.rstrip() + "\n\n</body>\n</html>\n"


def opt(name):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def main():
    named = {"--payload", "--by", "--note"}
    args, skip = [], False
    for a in sys.argv[1:]:
        if skip:
            skip = False
            continue
        if a in named:
            skip = True
        elif not a.startswith("--"):
            args.append(a)
    check_only = "--check" in sys.argv
    payload = opt("--payload")
    if len(args) != 1 or (payload and not opt("--by")):
        print(__doc__)
        sys.exit(2)
    raw = open(args[0], encoding="utf-8").read()
    body = strip_skeleton(raw)

    # Markers must be balanced, or a private part could slip through unmarked.
    for a, b in (("<!--@private-->", "@/private-->"), ("/*@private*/", "@/private*/")):
        if body.count(a) != body.count(b):
            fail(f"unbalanced private markers: {body.count(a)} '{a}' but {body.count(b)} '{b}'")

    node_check(body, "Master Calendar")
    public = build_public(body)
    node_check(public, "public")

    hits = []
    for label, pat in FORBIDDEN:
        for m in re.finditer(pat, public, re.I):
            line = public.count("\n", 0, m.start()) + 1
            hits.append({"what": label, "line": line, "text": m.group(0)[:40]})
    if hits:
        fail("the public page would include private content; mark it @private in the artifact first",
             hits=hits[:20])

    old_site = open(SITE_HTML, encoding="utf-8").read() if os.path.exists(SITE_HTML) else ""
    changed = old_site != public
    written = None
    if payload:
        with open(payload, "w", encoding="utf-8") as f:
            json.dump({"html": public, "by": opt("--by"), "note": opt("--note") or ""}, f, ensure_ascii=False)
        written = payload
    elif not check_only:
        open(SITE_HTML, "w", encoding="utf-8").write(public)
        written = "index.html"
    views = re.findall(r'<button id="v-([a-z]+)" aria-pressed', public)
    print(json.dumps({"result": "changed" if changed else "unchanged", "written": written,
                      "public_views": views, "public_bytes": len(public)}, indent=1))


if __name__ == "__main__":
    main()
