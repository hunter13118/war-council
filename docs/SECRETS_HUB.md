# Secrets hub — war-council `.env`

**Clerk is for sign-in, not API keys.** Never put `GEMINI_API_KEY` or similar in
Clerk `publicMetadata` — it is visible to the client.

## Canonical source (this machine)

`war-council/.env` (gitignored) holds all workspace API keys.

## New machine / Cursor instance

```powershell
git clone https://github.com/hunter13118/war-council.git D:\war-council
# Copy .env from password manager OR pull from Cloudflare (see below)
cd D:\war-council
node scripts/sync-workspace-secrets.mjs
```

That writes:

- `EbookAVPlayer/.env` + `web/.env.local`
- `milkman-portfolio/.dev.vars`
- `CloudPilot/.dev.vars`

## Remote access (Cloudflare Worker secrets)

After `npx wrangler login` on any computer:

```powershell
cd D:\war-council
node scripts/sync-workspace-secrets.mjs --cloud
```

Uploads encrypted secrets to **milkman-webapp-portfolio** (readable via
`env.GEMINI_API_KEY` etc. in `worker.js` / Pages Functions).

Clerk **publishable** key is already in `milkman-portfolio/wrangler.toml` `[vars]`
(safe in client bundle). JWKS + issuer go to Worker secrets via the script above.

## Key inventory

| Key | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Extract + images (primary) |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` | Extract fallbacks |
| `CEREBRAS_API_KEY` / `MISTRAL_API_KEY` | Extract fallbacks |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Workers AI images |
| `POLLINATIONS_TOKEN` / `HF_TOKEN` | Image fallbacks |
| `CLERK_JWKS_URL` / `CLERK_ISSUER` | JWT verify on edge |

See each repo's `.env.example` for app-specific vars (`LOCAL_IMAGE_URL`, etc.).
