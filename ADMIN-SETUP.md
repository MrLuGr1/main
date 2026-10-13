# Secure Pixel Desk admin setup

GitHub Pages only serves public static files. It cannot securely verify a password or accept protected edits by itself. Pixel Desk therefore uses `admin-worker.js` as a Cloudflare Worker API. The Worker verifies the password and writes the shared project list through the GitHub API. The browser contains only the public Worker URL; it never contains the password, its hash, or the GitHub token.

## 1. Create a narrowly scoped GitHub token

Create a fine-grained personal access token for **only** `MrLuGr1/main` with **Contents: Read and write**. Do not enable organization, workflow, or administration permissions. Keep the token private; it is entered only as a Cloudflare Worker secret.

## 2. Create the server-side secrets

From this repository directory, generate a SHA-256 hash without putting the password in shell history. This prompts for the password without echoing it:

```powershell
py -c "import getpass,hashlib; print(hashlib.sha256(getpass.getpass('Admin password: ').encode()).hexdigest())"
```

Choose a unique password with at least 20 characters. Paste the printed hash into the prompt from:

```powershell
npx wrangler secret put ADMIN_PASSWORD_SHA256
npx wrangler secret put GITHUB_TOKEN
```

Generate a separate random signing secret and add it to Cloudflare:

```powershell
py -c "import secrets; print(secrets.token_hex(32))"
npx wrangler secret put SESSION_SECRET
```

Paste each generated value into Wrangler's prompt. These values are stored by Cloudflare, not in this repository. Do not paste them into source files, GitHub Issues, or chat.

## 3. Deploy the API

Authenticate Wrangler with the Cloudflare account that will host the Worker, then deploy:

```powershell
npx wrangler login
npx wrangler deploy
```

Wrangler prints a URL similar to `https://pixel-desk-admin.<account-subdomain>.workers.dev`.

## 4. Connect GitHub Pages to the API

Put the Worker URL (without a trailing slash) into the `pixel-desk-api` meta tag in `index.html`:

```html
<meta name="pixel-desk-api" content="https://pixel-desk-admin.YOUR-SUBDOMAIN.workers.dev">
```

Commit that public URL change to `main`. It is configuration, not a credential. The Pages site can then load shared projects and use Admin Login. A successful login receives a signed, 30-minute token held only in page memory; reloading the page signs the admin out. Add and remove actions are checked by the Worker and committed to `projects.json` in this repository.

## Security notes

- There is no default admin password and no client-side password hash. The admin UI stays read-only until the API is configured and authenticates the user.
- Use a strong, unique password. The password is sent over HTTPS to the Worker for verification; only its SHA-256 hash is stored as a Cloudflare secret.
- The GitHub token is only used by the Worker and is limited to repository contents. A successful project edit creates a commit in `main` and may trigger the Pages deployment.
- The signed API session expires after 30 minutes. Logging out clears the in-memory token; an already copied token remains valid only until its short expiry.
- Consider enabling a Cloudflare rate-limiting rule for `POST /api/login` before sharing the admin URL widely.

