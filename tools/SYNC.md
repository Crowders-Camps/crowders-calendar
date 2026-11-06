# Push Master Calendar page changes to the website

**Live since 2026-11-06.** Publisher: `https://calendar-publisher.nate-5ff.workers.dev`.

## For staff: how to push the calendar live

1. Make your change to the **Crowders Camps Master Calendar** artifact (ask Claude to edit it, as usual).
2. In a Claude chat that runs in the **Crowders Camps calendar** environment, say **"push the calendar live"**
   and, in a few words, what changed.
3. Claude checks the page, shows you what will go public, and publishes it. The website updates within a
   couple of minutes. You don't need a GitHub account or any key.

Good to know:
- **Who can do it:** anyone in the Crowders Camps Claude organization, from a chat in the shared
  **Crowders Camps calendar** environment. If Claude says the publish key is missing or wrong, the chat isn't
  in that environment: start one from claude.ai/code with that environment selected, or ask Nate.
- **What goes public:** Calendar, List, This week, Meals, Housing, Open dates and Checks. Improvements,
  Inservices, staff time off and anything read from Google Sheets or the staff Google Calendar stay on the
  Master Calendar only.
- **What doesn't need pushing:** event data. CampWise changes reach both calendars every morning on their own.
  Push only after changing the page itself (layout, views, wording, features).
- **If Claude says "blocked":** something on the page would make private information public. Claude will say
  what and offer to mark it private in the artifact. Nothing changes on the website until that's fixed.
- **Undo:** every push is a commit in this repo named after who asked ("Page update from the Master Calendar
  (asked by …)"). Ask Claude or Nate to revert it.

## For Claude: steps

Use these steps when someone has changed the **Crowders Camps Master Calendar** artifact
(https://claude.ai/artifact/QrCvQLpKv96feXdaNtSTZq) and asks Claude to put the change on the public
website (https://crowders-camps.github.io/crowders-calendar/). Page changes go live only when someone
asks (Nate's decision, 2026-11-05). The events (`data.js`) refresh on their own every morning and are
never touched here.

Nobody needs GitHub access. Claude builds the page here and sends it to the **calendar publisher**,
a Cloudflare Worker that checks it again and commits it. The publisher's key is a network secret on
the organization's shared Claude environment, so the agent proxy adds it to the request and nobody,
Claude included, sees it.

## Steps

1. Clone this repo (public, no login needed):
   `git clone --depth 1 https://github.com/Crowders-Camps/crowders-calendar` and work from its root.
2. Read the artifact with the Artifact tool: `action: "read"`, `url: https://claude.ai/artifact/QrCvQLpKv96feXdaNtSTZq`.
   Read the saved page file in full, then copy it into the working directory as `live.html`.
3. Check it: `python3 -I tools/sync_page.py live.html --check`
   - **`blocked`**: stop and tell the person what it found (with line numbers). Usually new code that
     uses a connector, a private Google Sheet or calendar, or a personal detail was added outside the
     `@private` markers. Offer to wrap it in markers in the artifact (see "Marking private parts"),
     republish the artifact, and start again at step 2. Never edit the checks or send around them.
   - **`unchanged`**: the website already shows this page. Say so and stop.
   - **`changed`**: go on.
4. Look before sending: run `python3 -I tools/sync_page.py live.html` (writes `index.html` in this clone),
   then open it with this repo's `assets/` and `data.js` at desktop and phone width. Every view listed in
   `public_views` should render with no page errors and no sideways scroll on a phone.
5. Write the request, naming who asked: `python3 -I tools/sync_page.py live.html --payload publish.json --by "<first name>" --note "<what changed, a few words>"`
6. Send it:
   `curl -sS -X POST https://calendar-publisher.nate-5ff.workers.dev/publish -H "content-type: application/json" --data @publish.json`
   Don't add an Authorization header; the environment adds the key. Answers:
   - `published`: done. GitHub Pages updates within a couple of minutes.
   - `unchanged`: the website already had this page.
   - `blocked`: same as step 3; nothing was changed.
   - `refused` with "missing or wrong publish key" (401): this session isn't in the shared calendar
     environment. Tell the person to start the chat in the **Crowders Camps calendar** environment, or ask Nate.
   - Can't connect at all: same cause, or the publisher is down. Tell the person and stop.
7. Tell the person in one or two lines what went live and what stayed on the Master Calendar only.

People with write access to this repo can skip steps 5–6: commit `index.html` and push instead.

## Marking private parts (when editing the artifact)

- HTML: `<!--@private-->` private markup `<!--@public` website markup, may be empty `@/private-->`
- JS or CSS: `/*@private*/` private code `/*@public` website code, may be empty `@/private*/`

The website version must keep the page working: if other code calls a function or reads a variable
defined in the private part, the public part defines a harmless stand-in (see the existing block that
stubs `renderImprovements`, `IMPEV`, `OFF`). The `@public` text sits inside a comment, so it can't
contain `*/` (JS) or `-->` (HTML).

## Rules (always)

- Never put financial data, camper personal information or personal staff information on the website.
  Staff appear only as first name or first name + last initial.
- The artifact page must keep loading events from `data/events.js`; never inline the events.
- Never send `data.js` or any file other than the page; the publisher only writes `index.html`.

## Files here

| File | What it is |
|---|---|
| `tools/sync_page.py` | Builds and checks the website page from the artifact page |
| `tools/forbidden.json` | What must never reach the website (used by the script and the publisher) |
| `tools/head.html` | The website page's `<head>` |
| `tools/web-only.js` | Website-only code: the live menu lines from the Kitchen Prep Builder |
| `publisher/` | The calendar publisher Worker, its tests and setup steps |
