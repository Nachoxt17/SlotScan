# SlotScan — Inventory Locator

**Find any item on your shelves in one scan.**

SlotScan is a mobile-first progressive web app that lets restaurant, hotel, and retail teams instantly locate any product in storage — just scan the barcode on the package (or a custom QR label you generate in the app) and the screen shows you exactly where to put it: **B3**, **A1.C**, wherever you set it up.

No native app install needed. Open the URL on any phone, allow camera access, and you're scanning.

---

## Features

- **Barcode scanning** — scan any manufacturer barcode directly off the product label
- **QR code generation** — generate and print custom QR labels for the few products that don't come with a barcode
- **Alphanumeric shelf system** — configure rows × columns (e.g. A–J × 1–10 = 100 slots), with optional sub-slots per position (A1.A, A1.B … up to 10 deep)
- **Pre-mapped locations** — admin maps each product code to a fixed slot; any team member scanning that code instantly sees where it goes
- **Real-time sync** — all 25 phones stay in sync instantly via Supabase Realtime; map an item on one phone and every other phone sees it within a second
- **Admin / sub-user roles** — admins manage shelves, map items, generate QRs, and invite team members; sub-users can scan and browse the inventory list
- **Team invites by email** — admins invite colleagues by email; invitees sign up and join with one tap
- **5 languages** — English, Spanish, German, French, Italian; switchable per device at any time
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

There is no server in the middle. The Supabase anon key is intentionally public — Row Level Security policies ensure each business can only see its own data.

---

## Getting started

### 1. Create a Supabase project

1. Sign up free at [supabase.com](https://supabase.com)
2. Create a new project (any name, closest region)
3. Open **SQL Editor → New query**, paste the contents of [`supabase-schema.sql`](supabase-schema.sql) and run it
4. Run this additional migration to enable sub-slots:
   ```sql
   ALTER TABLE businesses ADD COLUMN IF NOT EXISTS shelves_subslots int NOT NULL DEFAULT 0;
   ```
5. Go to **Authentication → Sign In / Up → Email** and disable **Confirm email** (recommended for internal team use)

### 2. Add your credentials

Open `config.js` and paste your project URL and anon key from **Supabase → Settings → API**:

```js
window.SLOTSCAN_CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY-HERE',
};
```

Both values are safe to commit publicly — Supabase designed them for client-side use.

### 3. Deploy to GitHub Pages

```bash
git add .
git commit -m "Initial deploy"
git push
```

Enable Pages in your repo: **Settings → Pages → Source: Deploy from branch → main / root**.

Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

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

| Config | Example slots |
|---|---|
| 3 rows × 4 cols, no sub-slots | A1, A2, A3, A4, B1 … C4 |
| 2 rows × 3 cols, 3 sub-slots | A1.A, A1.B, A1.C, A2.A … B3.C |

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
