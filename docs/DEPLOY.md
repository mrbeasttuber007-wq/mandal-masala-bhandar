# 2. GitHub and Cloudflare Pages

## A. GitHub (repository)
The code is a normal folder tree. Phones are awkward for uploading nested folders, so pick one:

* **Easiest for you:** create a **new empty private repository** on github.com (name `mandal-masala-bhandar`, do not add a README). Then ask Claude to push the code: create a **fine-grained personal access token** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → *Only select repositories* → this repo → permission **Contents: Read and write**) and paste it in the chat. Delete the token afterwards.
* **Alternative:** on a computer, `git init`, `git add .`, `git commit`, then push as GitHub shows on the empty repo page.

Never commit `.env` (it is already in `.gitignore`).

## B. Cloudflare Pages (free hosting)
1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → choose the repo.
2. Build settings:
   * Build command: `npm run build`
   * Build output directory: `dist`
   * Environment variable `NODE_VERSION` = `22`
3. **Environment variables** (Production): `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the two **public** values from SETUP step D.
4. **Save and Deploy**. You get an address like `https://mandal-masala.pages.dev`.

If you have no GitHub repo yet, **Direct Upload** also works: Claude can build a ready `dist` zip once you send the two public values, and you upload that zip in Cloudflare Pages → Create → Upload assets.

## C. After the first deploy
1. Supabase → **Authentication → URL Configuration**: set **Site URL** to your Pages address.
2. Edge Function secret `SITE_URL` = the same address (used for tracking links in emails).
3. Place one real test order from your phone, confirm it in `/admin`, then delete or cancel it.

## D. Updating later
Change code → push to GitHub → Cloudflare redeploys automatically. Changing prices, products and stock never needs a redeploy: do it in `/admin`.

> Status: **not deployed yet.** Deployment needs your Cloudflare and Supabase accounts, which I cannot access. A public URL exists only after step B succeeds.
