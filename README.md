# SlotScan — Inventory Locator

**Find any item on your shelves in one scan.**

SlotScan is a mobile-first progressive web app that lets restaurant, hotel, and retail teams instantly locate any product in storage — just scan the barcode on the package (or a custom QR label you generate in the app) and the screen shows you exactly where to put it: **B3**, **A1.C**, wherever you set it up.

No native app install needed. Open the URL on any phone, allow camera access, and you're scanning.

---

## Features

- **Barcode scanning** — scan any manufacturer barcode directly off the product label
- **QR code generation** — generate and print custom QR labels for the few products that don't come with a barcode
- **Alphanumeric shelf system** — configure rows × columns either as a **simple** grid (e.g. A–J × 1–10 = 100 slots) or a **custom** grid where every row has its own column count (A1–A11, B1–B7, C1–C20 …), with optional sub-slots per position (A1.A, A1.B … up to 10 deep)
- **Pre-mapped locations** — admin maps each product code to a fixed slot; any team member scanning that code instantly sees where it goes
- **Real-time sync** — all 25 phones stay in sync instantly via Supabase Realtime; map an item on one phone and every other phone sees it within a second
- **Admin / sub-user roles** — admins manage shelves, map items, generate QRs, and invite team members; sub-users can scan and browse the inventory list
- **Platform Owner dashboard** — a super-admin role above the businesses: see every business, manage members and their roles, delete businesses, and view platform-wide stats (see [Platform owner](#platform-owner))
- **Data backup & restore** — one-click JSON snapshot/restore of all data, plus guidance for Supabase automatic backups and full dumps (see [`BACKUP.md`](BACKUP.md))
- **Team invites by email** — admins invite colleagues by email; invitees sign up and join with one tap
- **6 languages** — English, Spanish, German, French, Italian, **Romanian**; switchable per device at any time
- **Manual code entry fallback** — type or paste a code if the camera isn't available
- **Printable QR labels** — download as PNG or send straight to the printer

---

## Built with

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (no build step) |
| Camera scanning | [html5-qrcode](https://github.com/mebjas/html5-qrcode) |
| QR generation | [qrcode.js](https://github.com/soldair/node-qrcode) |
| Database + Auth | [Supabase](https://supabase.com) (Postgres + Row Level Security) |
| Hosting | [GitHub Pages](https://pages.github.com) |

---

## How it works

```
Phone browser ──── loads static files ───► GitHub Pages
     │
     └─ makes API calls directly ────────► Supabase
                                           (auth + shared database + realtime)
```

There is no server in the middle. The browser uses the Supabase **anon** key, and **Row Level Security** policies ensure each business can only see its own data. The anon key is necessarily present in the deployed page, so security relies on RLS — not on hiding the key. The key is **not** stored in this repository; it is injected at deploy time from GitHub Actions secrets. See [`SECURITY.md`](SECURITY.md).

---

## Getting started

### 1. Create a Supabase project

1. Sign up free at [supabase.com](https://supabase.com)
2. Create a new project (any name, closest region)
3. Open **SQL Editor → New query** and run these files **in order** (each is safe to re-run):
   1. [`supabase-schema.sql`](supabase-schema.sql) — core tables, RLS and RPCs
   2. ```sql
      ALTER TABLE businesses ADD COLUMN IF NOT EXISTS shelves_subslots int NOT NULL DEFAULT 0;
      ```
   3. [`supabase-migration-zones.sql`](supabase-migration-zones.sql) — multiple zones per business
   4. [`supabase-migration-custom-grid.sql`](supabase-migration-custom-grid.sql) — custom per-row grids
   5. [`supabase-migration-platform.sql`](supabase-migration-platform.sql) — Platform Owner role + backup RPCs
      (**edit the owner email inside it first** — see [Platform owner](#platform-owner))
4. Go to **Authentication → Sign In / Up → Email** and disable **Confirm email** (recommended for internal team use)

### 2. Add your credentials (kept OUT of the public repo)

The committed `config.js` contains **placeholders only** — real keys never live in
the repository. Provide them in one of two ways:

**Local development**

```bash
cp config.local.js.example config.local.js
# then edit config.local.js and paste your Project URL + anon key
```

`config.local.js` is git-ignored, so it can't be committed by accident.

**Production (GitHub Pages)** — provide the keys as repository secrets:

1. **Settings → Secrets and variables → Actions → New repository secret**
   - `SUPABASE_URL` = `https://YOUR-PROJECT.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon public key

Get both from **Supabase → Settings → API** (Project URL + the `anon public` key).

### 3. Deploy to GitHub Pages (via GitHub Actions)

```bash
git add .
git commit -m "Deploy"
git push
```

Set Pages to use the workflow **once**:
**Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

The included workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml))
injects your secrets into `config.local.js` at build time and publishes the site —
so the keys reach the browser without ever being committed.

Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

> ⚠️ **Rotate your anon key if it was ever committed publicly.** Removing it from
> the current files does not remove it from git history. See [`SECURITY.md`](SECURITY.md).

---

## First-time setup in the app

1. Open the URL on your phone → **Create business** with your kitchen/shop name
2. Go to **Setup → Shelf layout** — enter rows (letters A–Z), columns (1–99), and optionally sub-slots per position (0–10)
3. **Map items**: enter a name, scan or type the barcode/QR code, choose the slot → Save
4. **Generate QRs** for any product without a barcode → print and stick the label on the item
5. **Invite team** → enter colleague's email → they sign up at your app URL and tap Join

Sub-users can then open the app on their own phones and start scanning.

---

## Slot system

When you add or edit a **Zone**, pick a **grid type**:

- **Simple** — every row has the same number of columns (as before).
- **Custom** — type a column count for each row (A, B, C …) individually.

Sub-slots (A1.A, A1.B …) work the same in both modes.

| Config | Example slots |
|---|---|
| Simple · 3 rows × 4 cols, no sub-slots | A1, A2, A3, A4, B1 … C4 |
| Simple · 2 rows × 3 cols, 3 sub-slots | A1.A, A1.B, A1.C, A2.A … B3.C |
| Custom · A→11, B→7, C→20 | A1 … A11, B1 … B7, C1 … C20 |

---

## Platform owner

The **Platform Owner** is a super-admin **above** the per-business admins. It can
see every business, manage members and their roles, delete businesses, view
platform-wide stats, and run [backups](BACKUP.md).

This is enforced in the **database** (RLS + `SECURITY DEFINER` functions), so it
can't be bypassed by editing the front-end.

### Becoming the platform owner

1. Open [`supabase-migration-platform.sql`](supabase-migration-platform.sql) and
   set your login email in the seed line (it can be added before you sign up):
   ```sql
   insert into platform_admins (email) values (lower('you@example.com'))
     on conflict (email) do nothing;
   ```
2. Run that migration in the Supabase SQL Editor.
3. Sign in to the app with that email. A new **Owner** tab appears in the bottom
   nav. (If that account isn't in any business, you land straight on the owner
   console.)

Add more co-owners any time by inserting more rows into `platform_admins`.

> The previous owner email in the file is a placeholder — change it to yours.

---

## Backups

SlotScan has a built-in JSON backup/restore in the **Owner** tab, and works with
Supabase's automatic backups and full database dumps. Full instructions:
[`BACKUP.md`](BACKUP.md).

---

## Roadmap

- [ ] Subscription billing (Stripe)
- [ ] Quantity / stock count tracking
- [ ] Expiration date alerts for food products
- [ ] Multi-business switching per account
- [ ] Bulk import via CSV
- [ ] Offline-first PWA mode

---

## License

MIT — free to use, modify, and deploy for your own business.
