# Calendar publisher: one-time setup (Nate)

The publisher is a small Cloudflare Worker that lets any Crowders Camps Claude session put a new calendar
page on the website without GitHub access. It holds a GitHub token that can only write to this repo, and
it only ever writes `index.html`, after re-checking the page for private content (`tools/forbidden.json`).
How people use it: `../tools/SYNC.md`.

Two keys, neither ever pasted into a chat, a project doc or a file:
- **GitHub token**: lives only in the Worker (Cloudflare secret `GITHUB_TOKEN`).
- **Publish key**: lives in the Worker (`PUBLISH_KEY`) and as a network secret on the shared Claude
  environment. The agent proxy adds it to requests to the Worker, so sessions use it without seeing it.

## 1. Make the GitHub token

GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token.
- Resource owner: **Crowders-Camps** (the org may need to approve fine-grained tokens first)
- Repository access: **Only select repositories** → `crowders-calendar`
- Permissions: **Contents: Read and write**. Nothing else.
- Expiration: up to a year; put a reminder on your calendar to replace it.

## 2. Make the publish key

Any long random string. On a Mac: `openssl rand -hex 32` in Terminal. Keep it in your password manager
until steps 3 and 4 are done.

## 3. Deploy the Worker

On your computer, in a copy of this repo (or ask Claude Code to do it with you):

```
cd publisher
npx wrangler login
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN     # paste the token from step 1
npx wrangler secret put PUBLISH_KEY      # paste the key from step 2
```

Note the address `deploy` prints, e.g. `https://calendar-publisher.nate-5ff.workers.dev`. If it isn't that
one, change it in `../tools/SYNC.md` step 6.

## 4. Share it with the team in Claude

1. claude.ai → Admin settings → **Cloud environments** → create an environment named
   **Crowders Camps calendar** (or share one of yours from its **Who can use it** row).
2. In its **Network secrets** section, **Add**: Secret type **Bearer**, Name `Calendar publisher`,
   Allowed websites `calendar-publisher.nate-5ff.workers.dev` (your Worker's host), Custom headers
   `Authorization` / prefix `Bearer` / value = the publish key from step 2. Save.
3. Optional: make it the organization's default environment at claude.ai/admin-settings/claude-code, so
   sessions use it without anyone picking it.

## 5. Test it

Start a session in that environment and ask Claude to run
`curl -sS https://calendar-publisher.nate-5ff.workers.dev/check`. It should answer `"result": "ok"` with
`"github_token": true`. A 401 means the network secret isn't attached (wrong host, or the session is in a
different environment).

## Changing or revoking

- Lost or leaked publish key: make a new one, `wrangler secret put PUBLISH_KEY`, then delete and re-add the
  network secret. The old key stops working at once.
- Turn publishing off: delete the network secret, or `npx wrangler delete` the Worker. The website stays as is.
- Every publish is a normal commit in this repo ("Page update from the Master Calendar (asked by …)"), so
  any change can be reverted from GitHub.

## Tests

`node publisher/test.mjs index.html` runs the Worker against a fake GitHub: wrong key refused, private content
blocked, a good page committed once, an identical page not committed again.
