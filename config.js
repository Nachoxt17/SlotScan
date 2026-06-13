// =====================================================
// SlotScan config — credentials are NOT stored in this repository.
//
// This file is intentionally committed with PLACEHOLDER values only, so the
// public repository never exposes the keys that connect it to Supabase.
//
// Where do the real keys come from?
//   • Production (GitHub Pages): injected automatically at deploy time from
//     GitHub Actions *secrets* (SUPABASE_URL + SUPABASE_ANON_KEY).
//     See .github/workflows/deploy.yml — it writes a config.local.js on the fly.
//   • Local development: copy config.local.js.example to config.local.js and
//     paste your own keys there. config.local.js is git-ignored, so it is never
//     committed. It is loaded right after this file and overrides these values.
//
// How to get the values: Supabase Dashboard → your project → Settings → API →
// copy "Project URL" and the "anon public" key.
//
// Security note: the anon key is a client-side key (it is necessarily present
// in the deployed page). Your data is protected by Row Level Security, NOT by
// hiding the key. See SECURITY.md for the full model and key-rotation steps.
// =====================================================

window.SLOTSCAN_CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
};
