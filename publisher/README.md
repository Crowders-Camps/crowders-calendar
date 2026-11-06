# Calendar publisher: one-time setup (Nate)

The publisher is a small Cloudflare Worker that lets any Crowders Camps Claude session put a new calendar
page on the website without GitHub access. It holds a GitHub token that can only write to this repo, and
it only ever writes `index.html`, after re-checking the page for private content (`tools/forbidden.json`).
How people use it: `../tools/SYNC.md`.

Two keys. Both live in 1Password and go from there straight to Cloudflare. Neither is ever typed on a
command line, saved in a file, or pasted into a chat, project doc or Slack:
- **GitHub token**: kept in 1Password; in Cloudflare as the Worker secret `GITHUB_TOKEN`.
- **Publish key**: made by 1Password; in Cloudflare as `PUBLISH_KEY`, and as a network secret on the shared
  Claude environment. The agent proxy adds it to requests to the Worker, so sessions use it without seeing it.

## 1. Make the GitHub token

GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate new token.
- Resource owner: **Crowders-Camps** (the org may need to approve fine-grained tokens first)
- Repository access: **Only select repositories** → `crowders-calendar`
- Permissions: **Contents: Read and write**. Nothing else.
- Expiration: up to a year; put a reminder on your calendar to replace it.

Save it straight into 1Password, in a vault the **it@crowderscamps.com** service account can read, as an
**API Credential** item titled exactly `Calendar publisher GitHub token` (paste the token into its
**credential** field). Don't keep it anywhere else.

## 2. The publish key

Nothing to do here: 1Password makes it in step 3.

## 3. Deploy the Worker and send the keys from 1Password to Cloudflare

Run these on your Mac in Terminal. You need the 1Password CLI (`op`; `brew install 1password-cli`) and Node.

**3a. Sign the CLI in as the service account.** The service account token is itself a secret, so read it in
at a hidden prompt rather than typing it into the command (that would land in your shell history):

```
read -rs "OP_SERVICE_ACCOUNT_TOKEN?Service account token: " && export OP_SERVICE_ACCOUNT_TOKEN
op whoami          # should name the it@crowderscamps.com service account
op vault list      # the vaults it can use
```

(`read -rs "...?..."` is the zsh form, the Mac default. In bash: `read -rsp "Service account token: " OP_SERVICE_ACCOUNT_TOKEN && export OP_SERVICE_ACCOUNT_TOKEN`.)

Pick the vault from that list that holds the GitHub token item, and set it once for the commands below:

```
VAULT="<vault name from op vault list>"
```

The service account's vault access was fixed when it was created and can't be changed. If the vault you want
isn't listed, or step 3c says it can't write there, use a vault it can write to, or make a new service account.

**3b. Get the Worker code and deploy it.**

```
git clone --depth 1 https://github.com/Crowders-Camps/crowders-calendar ~/crowders-calendar
cd ~/crowders-calendar/publisher
npx wrangler login       # opens Cloudflare in your browser
npx wrangler deploy
```

Note the address `deploy` prints, e.g. `https://calendar-publisher.nate-5ff.workers.dev`. If it isn't that
one, tell Claude so it can update `../tools/SYNC.md` step 6 and step 4 below.

**3c. Have 1Password make the publish key.**

```
op item create --vault "$VAULT" --category password \
  --title "Calendar publisher key" --generate-password='letters,digits,64' > /dev/null
```

(`> /dev/null` keeps the new item, and its key, from printing to the screen.)

**3d. Send both keys from 1Password to Cloudflare.** Each value goes from `op read` straight into Wrangler
through the pipe; it never appears on screen, in your clipboard or in a file:

First make sure both references work. These print only how long each key is, never the key:

```
op read "op://$VAULT/Calendar publisher GitHub token/credential" | wc -c    # about 94 for a GitHub token
op read "op://$VAULT/Calendar publisher key/password" | wc -c               # 64 (65 counting the line end)
```

If either errors, check the item title and field name in the 1Password app (an API Credential keeps its
value in **credential**, a Password item in **password**). Then send them:

```
op read "op://$VAULT/Calendar publisher GitHub token/credential" | npx wrangler secret put GITHUB_TOKEN
op read "op://$VAULT/Calendar publisher key/password"            | npx wrangler secret put PUBLISH_KEY
npx wrangler secret list          # should list GITHUB_TOKEN and PUBLISH_KEY (names only)
```

**3e. Sign the CLI back out of the service account:**

```
unset OP_SERVICE_ACCOUNT_TOKEN VAULT
```

## 4. Share it with the team in Claude

1. claude.ai → Admin settings → **Cloud environments** → create an environment named
   **Crowders Camps calendar** (or share one of yours from its **Who can use it** row).
2. In its **Network secrets** section, **Add**: Secret type **Bearer**, Name `Calendar publisher`,
   Allowed websites `calendar-publisher.nate-5ff.workers.dev` (your Worker's host), Custom headers
   `Authorization` / prefix `Bearer` / value = the publish key.
   This is the one place a key goes into a browser form. Copy it from the **1Password app**
   (item `Calendar publisher key`, in the vault from step 3): 1Password clears your clipboard on its own
   shortly afterwards. Save.
3. Optional: make it the organization's default environment at claude.ai/admin-settings/claude-code, so
   sessions use it without anyone picking it.

## 5. Test it

Start a session in that environment and ask Claude to run
`curl -sS https://calendar-publisher.nate-5ff.workers.dev/check`. It should answer `"result": "ok"` with
`"github_token": true`. A 401 means the network secret isn't attached (wrong host, or the session is in a
different environment).

## Changing or revoking

Sign the CLI in as in step 3a first, and `cd ~/crowders-calendar/publisher`.

- **Replace the publish key** (lost, leaked, or someone left): make a new one with step 3c's command plus
  `--title "Calendar publisher key 2"` (or edit the item in the 1Password app and generate a new password),
  send it with step 3d's second line, then in claude.ai delete the network secret and add it again with the
  new value. The old key stops working at once.
- **Replace the GitHub token** (yearly, or if leaked): make a new one as in step 1, paste it over the
  credential in the same 1Password item, run step 3d's first line, then delete the old token in GitHub.
- **Turn publishing off:** delete the network secret, or `npx wrangler delete` the Worker. The website stays as is.
- Every publish is a normal commit in this repo ("Page update from the Master Calendar (asked by …)"), so
  any change can be reverted from GitHub.

## Tests

`node publisher/test.mjs index.html` runs the Worker against a fake GitHub: wrong key refused, private content
blocked, a good page committed once, an identical page not committed again.
