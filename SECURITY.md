# SlotScan — Security & credentials

## How SlotScan connects to Supabase

SlotScan is a **static, client-side app** (HTML/CSS/JS) hosted on GitHub Pages.
There is no backend server of our own — the browser talks to Supabase directly.
For that to work, the browser needs two values:

| Value | What it is | Sensitive? |
|---|---|---|
| `SUPABASE_URL` | Your project's API URL | No — sent on every request anyway |
| `SUPABASE_ANON_KEY` | The **anon / public** key (a JWT with `role: anon`) | Low — designed for client use |

> The anon key is **not** the `service_role` key. The service_role key bypasses
> all security and must *never* be placed in this app or repo. SlotScan only ever
> uses the anon key.

### Why hiding the anon key is not the real protection

Because the app runs entirely in the browser, the anon key is **necessarily
present in the deployed page** — anyone can open DevTools and read it. So hiding
it cannot be what keeps your data safe. What actually protects your data is
**Row Level Security (RLS)**: every table has policies that only let a user read
or write rows for businesses they belong to (see `supabase-schema.sql`).

What we *can* and *do* control: **keeping the keys out of the public source
repository**, so a casual visitor browsing the GitHub repo can't copy them, and
so the project URL/ref isn't advertised in plain text.

## Where the keys live now (after the anonymization change)

- `config.js` — committed with **placeholders only**. No real keys.
- `config.local.js` — **git-ignored**. Holds the real keys. Two ways it appears:
  - **Production:** created automatically by `.github/workflows/deploy.yml` from
    GitHub Actions **secrets** at deploy time.
  - **Local dev:** you create it from `config.local.js.example`.

### One-time setup to keep the live site working

1. **Add the secrets** in GitHub:
   `Settings → Secrets and variables → Actions → New repository secret`
   - `SUPABASE_URL` = `https://YOUR-PROJECT.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon public key
2. **Switch Pages to Actions:**
   `Settings → Pages → Build and deployment → Source = "GitHub Actions"`.
3. Push to `main` (or run the workflow manually). The site redeploys with the
   keys injected — without ever committing them.

## IMPORTANT: rotate the old key

The previous anon key was committed to this **public** repo, so it still exists
in the git history and was served on the live site. Treat it as **exposed**.
Removing it from the current files does **not** remove it from history.

**Do this once, in the Supabase Dashboard:**

1. Open your project → **Settings → API**.
2. Under **Project API keys**, use **Roll / Regenerate** for the `anon` key
   (or, for a full reset, regenerate the **JWT secret**, which invalidates every
   previously issued anon/service key — note this also signs everyone out).
3. Copy the **new** anon key into the GitHub secret `SUPABASE_ANON_KEY` (step 1
   above) and into your local `config.local.js`.
4. Redeploy.

After rotation, the old key in git history is useless, so there's no need to
rewrite history.

## Defense-in-depth checklist

- [ ] **RLS is ON for every table** (run `supabase-schema.sql`,
      `supabase-migration-zones.sql`, and the new migrations — they enable RLS).
- [ ] Only the **anon** key is used anywhere in this app. The **service_role**
      key is never committed, never put in a secret used by the front-end.
- [ ] Rotate the anon key (above), since the old one was public.
- [ ] In Supabase **Auth → Providers**, keep sign-ups restricted as needed for
      internal use.
- [ ] Take regular **backups** — see `BACKUP.md`.
