/* =====================================================
   SlotScan — multi-user, multi-language, with sub-slots
   ===================================================== */

(function () {
  'use strict';

  // ---------- i18n ----------
  const LANGS = ['en', 'es', 'de', 'fr', 'it'];
  const LANG_LABELS = { en: 'EN', es: 'ES', de: 'DE', fr: 'FR', it: 'IT' };
  let currentLang = localStorage.getItem('slotscan_lang') || 'en';
  if (!LANGS.includes(currentLang)) currentLang = 'en';

  function t(key, vars = {}) {
    const dict = (window.TRANSLATIONS || {})[currentLang]
              || (window.TRANSLATIONS || {}).en
              || {};
    let str = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), dict);
    if (str === null) {
      str = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null),
              (window.TRANSLATIONS || {}).en || {});
    }
    if (!str) return key;
    return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const val = t(el.getAttribute('data-i18n'));
      if (val) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const val = t(el.getAttribute('data-i18n-placeholder'));
      if (val) el.placeholder = val;
    });
    // Re-render dynamic areas that embed translated text
    renderInventory();
    renderShelvesSummary();
    buildConfigChecklist();
    buildLangBars();
    updateLangSelects();
    // Keep hint text live-updated
    if (document.getElementById('signup-hint') && !document.getElementById('signup-hint').classList.contains('error')) {
      document.getElementById('signup-hint').textContent = t('auth.signup_hint');
    }
  }

  function setLanguage(lang) {
    if (!LANGS.includes(lang)) return;
    currentLang = lang;
    localStorage.setItem('slotscan_lang', lang);
    applyTranslations();
    updateLangSelects();
  }

  function buildLangBars() {
    ['auth-lang-bar', 'onb-lang-bar'].forEach(id => {
      const bar = document.getElementById(id);
      if (!bar) return;
      bar.innerHTML = LANGS.map(l => `
        <button class="lang-btn ${l === currentLang ? 'is-active' : ''}" data-lang="${l}">${LANG_LABELS[l]}</button>
      `).join('');
      bar.querySelectorAll('.lang-btn').forEach(btn =>
        btn.addEventListener('click', () => setLanguage(btn.dataset.lang))
      );
    });
  }

  function buildConfigChecklist() {
    const list = document.getElementById('config-checklist');
    if (!list) return;
    const steps = ((window.TRANSLATIONS || {})[currentLang] || (window.TRANSLATIONS || {}).en || {}).config?.steps || [];
    list.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
  }

  function updateLangSelects() {
    document.querySelectorAll('.lang-select').forEach(sel => {
      // Rebuild options
      sel.innerHTML = LANGS.map(l =>
        `<option value="${l}" ${l === currentLang ? 'selected' : ''}>${LANG_LABELS[l]}</option>`
      ).join('');
    });
  }

  // ---------- Globals ----------
  let sb = null;
  const state = {
    user: null,
    business: null,
    membership: null,
    items: [],
    members: [],
    invites: [],
    realtimeChannel: null,
  };

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (kind || '');
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function letters(n) {
    const out = [];
    for (let i = 0; i < n && i < 26; i++) out.push(String.fromCharCode(65 + i));
    return out;
  }

  function allSlots(rows, cols, subslots = 0) {
    if (!rows || !cols) return [];
    const out = [];
    for (const r of letters(rows)) {
      for (let c = 1; c <= cols; c++) {
        if (!subslots || subslots <= 0) {
          out.push(`${r}${c}`);
        } else {
          for (let s = 0; s < subslots; s++) {
            out.push(`${r}${c}.${String.fromCharCode(65 + s)}`);
          }
        }
      }
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function showHint(id, msg, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  function showOnly(viewId) {
    ['view-boot','view-config','view-auth','view-onboarding'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== viewId;
    });
    document.getElementById('app-shell').hidden = viewId !== 'app';
  }

  // ---------- Boot ----------
  async function boot() {
    applyTranslations();

    const cfg = window.SLOTSCAN_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')
        || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
      buildConfigChecklist();
      showOnly('view-config');
      return;
    }

    sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    bindEvents();

    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        cleanupBusiness();
        state.user = null;
        showOnly('view-auth');
        applyTranslations();
      }
    });

    const { data: { session } } = await sb.auth.getSession();
    if (!session) { showOnly('view-auth'); return; }
    state.user = session.user;
    await routePostAuth();
  }

  async function routePostAuth() {
    showOnly('view-boot');
    const { data: memberships, error } = await sb
      .from('business_members')
      .select('business_id, role, businesses(id, name, shelves_rows, shelves_cols, shelves_subslots)')
      .eq('user_id', state.user.id);
    if (error) { toast(error.message, 'error'); showOnly('view-auth'); return; }
    if (!memberships || memberships.length === 0) {
      await showOnboarding();
      return;
    }
    const m = memberships[0];
    state.business = m.businesses;
    state.membership = { role: m.role };
    await enterApp();
  }

  // ---------- Auth ----------
  function setupAuth() {
    const tabs = $$('.auth-tabs .tab');
    tabs.forEach(tab => tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('is-active', t === tab));
      const which = tab.dataset.tab;
      document.getElementById('form-signin').hidden = which !== 'signin';
      document.getElementById('form-signup').hidden = which !== 'signup';
      showHint('signin-hint', '', false);
      showHint('signup-hint', t('auth.signup_hint'), false);
    }));

    document.getElementById('form-signin').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      showHint('signin-hint', t('auth.signing_in'), false);
      const { data, error } = await sb.auth.signInWithPassword({
        email: f.get('email').trim().toLowerCase(),
        password: f.get('password'),
      });
      if (error) return showHint('signin-hint', error.message, true);
      state.user = data.user;
      await routePostAuth();
    });

    document.getElementById('form-signup').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const username = f.get('username').trim();
      showHint('signup-hint', t('auth.creating'), false);
      const { data, error } = await sb.auth.signUp({
        email: f.get('email').trim().toLowerCase(),
        password: f.get('password'),
        options: { data: { username } },
      });
      if (error) return showHint('signup-hint', error.message, true);
      if (!data.session) {
        return showHint('signup-hint', t('auth.confirm_email'), false);
      }
      state.user = data.user;
      await routePostAuth();
    });
  }

  // ---------- Onboarding ----------
  async function showOnboarding() {
    document.getElementById('onb-name').textContent =
      state.user.user_metadata?.username || state.user.email;
    const { data: invites } = await sb
      .from('business_invites')
      .select('id, role, business_id, businesses(name)')
      .ilike('email', state.user.email)
      .is('accepted_at', null);
    const block = document.getElementById('onb-invites');
    const list = document.getElementById('onb-invites-list');
    if (invites && invites.length > 0) {
      block.hidden = false;
      list.innerHTML = invites.map(inv => `
        <div class="list-item" data-invite="${inv.id}">
          <div class="li-main">
            <div class="li-name">${escapeHtml(inv.businesses?.name || 'Business')}</div>
            <div class="li-meta">${t('setup.pending_role')} ${inv.role === 'admin' ? t('onboarding.role_admin') : t('onboarding.role_sub')}</div>
          </div>
          <button class="btn btn-primary" data-action="accept">${t('onboarding.join')}</button>
        </div>
      `).join('');
      list.querySelectorAll('[data-action="accept"]').forEach(btn => {
        btn.addEventListener('click', async e => {
          const id = e.target.closest('.list-item').dataset.invite;
          btn.disabled = true;
          const { error } = await sb.rpc('accept_invite', { invite_id: id });
          if (error) { btn.disabled = false; return toast(error.message, 'error'); }
          toast(t('toast.joined'), 'success');
          await routePostAuth();
        });
      });
    } else {
      block.hidden = true;
    }
    buildLangBars();
    showOnly('view-onboarding');
  }

  // ---------- Enter app ----------
  async function enterApp() {
    document.getElementById('hdr-business').textContent = state.business.name;
    document.getElementById('hdr-user').textContent =
      state.user.user_metadata?.username || state.user.email;
    document.getElementById('hdr-role').textContent =
      state.membership.role === 'admin' ? t('header.admin') : t('header.sub');
    document.body.classList.toggle('role-sub', state.membership.role !== 'admin');

    // Wire up app header lang select
    const appSel = document.getElementById('app-lang-select');
    updateLangSelects();
    appSel.addEventListener('change', () => setLanguage(appSel.value));

    showOnly('app');
    showView('scan');
    await loadItems();
    renderShelvesSummary();
    renderSlotSelects();
    renderInventory();
    if (state.membership.role === 'admin') {
      await loadMembers();
      await loadInvites();
    }
    subscribeRealtime();
    applyTranslations();
  }

  function cleanupBusiness() {
    if (state.realtimeChannel) {
      try { sb.removeChannel(state.realtimeChannel); } catch {}
      state.realtimeChannel = null;
    }
    if (scanner && scannerActive) stopScanner();
    state.business = null;
    state.membership = null;
    state.items = [];
    state.members = [];
    state.invites = [];
  }

  function subscribeRealtime() {
    if (!state.business) return;
    state.realtimeChannel = sb
      .channel('items-' + state.business.id)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'items', filter: `business_id=eq.${state.business.id}` },
        async () => { await loadItems(); renderInventory(); })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'businesses', filter: `id=eq.${state.business.id}` },
        payload => {
          state.business = { ...state.business, ...payload.new };
          renderShelvesSummary();
          renderSlotSelects();
        })
      .subscribe();
  }

  // ---------- Data ----------
  async function loadItems() {
    const { data, error } = await sb
      .from('items')
      .select('id, code, name, slot, type')
      .eq('business_id', state.business.id)
      .order('slot');
    if (error) return toast(error.message, 'error');
    state.items = data || [];
  }

  async function loadMembers() {
    const { data, error } = await sb
      .from('business_members')
      .select('id, user_id, username, email, role')
      .eq('business_id', state.business.id)
      .order('created_at');
    if (error) return toast(error.message, 'error');
    state.members = data || [];
    renderMembers();
  }

  async function loadInvites() {
    const { data, error } = await sb
      .from('business_invites')
      .select('id, email, role, created_at')
      .eq('business_id', state.business.id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });
    if (error) return toast(error.message, 'error');
    state.invites = data || [];
    renderInvites();
  }

  // ---------- Routing ----------
  function showView(name) {
    $$('.app-main .view').forEach(v => v.hidden = v.id !== `view-${name}`);
    $$('.nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === name));
    if (name !== 'scan' && scanner && scannerActive) stopScanner();
  }

  // ---------- Scanner ----------
  let scanner = null;
  let scannerActive = false;
  let scanContext = 'lookup';

  function ensureScanner() {
    if (!scanner) scanner = new Html5Qrcode('scanner-region', { verbose: false });
    return scanner;
  }

  async function startScanner(context = 'lookup') {
    scanContext = context;
    ensureScanner();
    document.getElementById('scanner-empty').hidden = true;
    document.getElementById('btn-scan-start').hidden = true;
    document.getElementById('btn-scan-stop').hidden = false;
    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        onScanSuccess,
        () => {}
      );
      scannerActive = true;
    } catch (err) {
      console.error(err);
      toast(t('toast.camera_error'), 'error');
      document.getElementById('scanner-empty').hidden = false;
      document.getElementById('btn-scan-start').hidden = false;
      document.getElementById('btn-scan-stop').hidden = true;
    }
  }

  async function stopScanner() {
    if (!scanner || !scannerActive) return;
    try { await scanner.stop(); } catch {}
    try { scanner.clear(); } catch {}
    scannerActive = false;
    document.getElementById('scanner-empty').hidden = false;
    document.getElementById('btn-scan-start').hidden = false;
    document.getElementById('btn-scan-stop').hidden = true;
  }

  function onScanSuccess(decoded, result) {
    if (onScanSuccess._last === decoded && Date.now() - onScanSuccess._lastAt < 1500) return;
    onScanSuccess._last = decoded;
    onScanSuccess._lastAt = Date.now();
    const fmt =
      result?.result?.format?.formatName ||
      result?.decodedResult?.result?.format?.formatName ||
      result?.format?.formatName || '';
    const isQR = fmt ? fmt.toUpperCase().includes('QR') : /^INV-/.test(decoded);
    if (navigator.vibrate) navigator.vibrate(80);
    setTimeout(stopScanner, 0);
    if (scanContext === 'map') {
      $('input[name="code"]', document.getElementById('form-map')).value = decoded;
      $('select[name="type"]', document.getElementById('form-map')).value = isQR ? 'qr' : 'barcode';
      showView('setup');
      toast(t('toast.code_captured'), 'success');
      return;
    }
    showLookupResult(decoded, isQR);
  }

  function showLookupResult(code, isQR) {
    const item = state.items.find(i => i.code === code);
    const card = document.getElementById('scan-result');
    card.hidden = false;
    document.getElementById('result-code').textContent = code;
    if (item) {
      document.getElementById('result-type').textContent =
        item.type === 'qr' ? t('scan.chip_qr') : t('scan.chip_barcode');
      document.getElementById('result-type').classList.remove('warn');
      document.getElementById('result-slot').textContent = item.slot;
      document.getElementById('result-name').textContent = item.name;
      document.getElementById('btn-result-map').hidden = true;
    } else {
      document.getElementById('result-type').textContent = t('scan.chip_unmapped');
      document.getElementById('result-type').classList.add('warn');
      document.getElementById('result-slot').textContent = '—';
      document.getElementById('result-name').textContent = t('scan.unmapped_msg');
      const mapBtn = document.getElementById('btn-result-map');
      mapBtn.hidden = state.membership.role !== 'admin';
      mapBtn.dataset.code = code;
      mapBtn.dataset.type = isQR ? 'qr' : 'barcode';
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- Rendering ----------
  function renderShelvesSummary() {
    if (!state.business) return;
    const f = document.getElementById('form-shelves');
    const b = state.business;
    const sub = b.shelves_subslots || 0;
    if (b.shelves_rows && b.shelves_cols) {
      f.elements.rows.value = b.shelves_rows;
      f.elements.cols.value = b.shelves_cols;
      f.elements.subslots.value = sub;
      const slots = allSlots(b.shelves_rows, b.shelves_cols, sub);
      const lastRow = letters(b.shelves_rows).slice(-1)[0];
      const first = slots[0] || '';
      const last = slots[slots.length - 1] || '';
      const subPart = sub > 0 ? t('setup.shelves_subslots_part', { n: sub }) : '';
      document.getElementById('shelves-summary').textContent = t('setup.shelves_summary', {
        rows: b.shelves_rows,
        cols: b.shelves_cols,
        subslots_part: subPart,
        total: slots.length,
        first,
        last,
      });
    } else {
      document.getElementById('shelves-summary').textContent = t('setup.shelves_no_layout');
    }
  }

  function renderSlotSelects() {
    if (!state.business) return;
    const b = state.business;
    const slots = allSlots(b.shelves_rows, b.shelves_cols, b.shelves_subslots || 0);
    [document.getElementById('map-slot-select'), document.getElementById('qr-slot-select')].forEach(sel => {
      sel.innerHTML = slots.length
        ? slots.map(s => `<option value="${s}">${s}</option>`).join('')
        : `<option value="">${t('error.setup_shelves_first')}</option>`;
    });
  }

  function renderInventory() {
    if (!state.business) return;
    const search = (document.getElementById('inv-search')?.value || '').trim().toLowerCase();
    const typeFilter = document.getElementById('inv-type-filter')?.value || 'all';
    const items = state.items.filter(i => {
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (!search) return true;
      return i.name.toLowerCase().includes(search)
          || i.code.toLowerCase().includes(search)
          || i.slot.toLowerCase().includes(search);
    });
    const list = document.getElementById('inv-list');
    const emptyHint = document.getElementById('inv-empty-hint');
    if (emptyHint) emptyHint.innerHTML = t('inventory.empty_hint');
    if (items.length === 0) {
      list.innerHTML = '';
      document.getElementById('inv-empty').hidden = false;
      return;
    }
    document.getElementById('inv-empty').hidden = true;
    list.innerHTML = items.map(i => `
      <div class="list-item" data-id="${i.id}">
        <div class="li-main">
          <div class="li-name">${escapeHtml(i.name)}</div>
          <div class="li-meta">${i.type === 'qr' ? t('scan.chip_qr') : t('scan.chip_barcode')} · ${escapeHtml(i.code)}</div>
        </div>
        <div class="li-slot">${escapeHtml(i.slot)}</div>
        ${state.membership?.role === 'admin' ? `
          <div class="li-actions">
            <button class="icon-btn" data-action="del">×</button>
          </div>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('[data-action="del"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.closest('.list-item').dataset.id;
        if (!confirm(t('confirm.remove_mapping'))) return;
        const { error } = await sb.from('items').delete().eq('id', id);
        if (error) return toast(error.message, 'error');
        toast(t('toast.removed'));
        await loadItems(); renderInventory();
      });
    });
  }

  function renderMembers() {
    const list = document.getElementById('members-list');
    list.innerHTML = state.members.map(m => `
      <div class="list-item" data-id="${m.id}">
        <div class="li-main">
          <div class="li-name">${escapeHtml(m.username)}
            ${m.user_id === state.user.id ? `<span class="muted small"> ${t('setup.you')}</span>` : ''}</div>
          <div class="li-meta">${escapeHtml(m.email)} · ${m.role === 'admin' ? t('header.admin') : t('header.sub')}</div>
        </div>
        ${m.role !== 'admin' && m.user_id !== state.user.id ? `
          <div class="li-actions"><button class="icon-btn" data-action="del-mem">×</button></div>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('[data-action="del-mem"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.closest('.list-item').dataset.id;
        if (!confirm(t('confirm.remove_member'))) return;
        const { error } = await sb.from('business_members').delete().eq('id', id);
        if (error) return toast(error.message, 'error');
        toast(t('toast.member_removed'));
        await loadMembers();
      });
    });
  }

  function renderInvites() {
    const list = document.getElementById('invites-list');
    const empty = document.getElementById('invites-empty');
    if (state.invites.length === 0) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = state.invites.map(inv => `
      <div class="list-item" data-id="${inv.id}">
        <div class="li-main">
          <div class="li-name">${escapeHtml(inv.email)}</div>
          <div class="li-meta">${t('setup.pending_role')} ${inv.role === 'admin' ? t('header.admin') : t('header.sub')}</div>
        </div>
        <div class="li-actions"><button class="icon-btn" data-action="del-inv">×</button></div>
      </div>
    `).join('');
    list.querySelectorAll('[data-action="del-inv"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.closest('.list-item').dataset.id;
        if (!confirm(t('confirm.cancel_invite'))) return;
        const { error } = await sb.from('business_invites').delete().eq('id', id);
        if (error) return toast(error.message, 'error');
        toast(t('toast.invite_cancelled'));
        await loadInvites();
      });
    });
  }

  // ---------- Modal ----------
  function openInviteModal() {
    document.getElementById('modal-title').textContent = t('modal.invite_title');
    document.getElementById('modal-body').innerHTML = `
      <form id="form-invite" class="stack-form">
        <label><span>${t('modal.invite_email')}</span><input type="email" name="email" required /></label>
        <label><span>${t('modal.invite_role')}</span>
          <select name="role">
            <option value="sub">${t('modal.invite_role_sub')}</option>
            <option value="admin">${t('modal.invite_role_admin')}</option>
          </select>
        </label>
        <p class="muted small">${t('modal.invite_hint')}</p>
        <button class="btn btn-primary" type="submit">${t('modal.invite_send')}</button>
      </form>
    `;
    document.getElementById('modal').hidden = false;
    document.getElementById('form-invite').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const email = f.get('email').trim().toLowerCase();
      const role = f.get('role');
      const { error } = await sb.from('business_invites').insert({
        business_id: state.business.id,
        email, role,
        created_by: state.user.id,
      });
      if (error) return toast(error.message, 'error');
      closeModal();
      await loadInvites();
      toast(t('toast.invite_created'), 'success');
    });
  }
  function closeModal() {
    document.getElementById('modal').hidden = true;
    document.getElementById('modal-body').innerHTML = '';
  }

  // ---------- QR generator ----------
  let qrCurrent = null;

  async function generateQR(name, slot) {
    const code = 'INV-' + Date.now().toString(36) + '-' +
                 Math.random().toString(36).slice(2, 6).toUpperCase();
    const canvas = document.getElementById('qr-canvas');
    await new Promise((resolve, reject) =>
      QRCode.toCanvas(canvas, code,
        { width: 240, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } },
        err => err ? reject(err) : resolve()));
    const { error } = await sb.from('items').insert({
      business_id: state.business.id, code, name, slot, type: 'qr',
    });
    if (error) return toast(error.message, 'error');
    document.getElementById('qr-out-name').textContent = name;
    document.getElementById('qr-out-slot').textContent = `${t('qr.slot_prefix')} ${slot}`;
    document.getElementById('qr-out-code').textContent = code;
    document.getElementById('qr-output').hidden = false;
    qrCurrent = { code, slot, name };
    toast(t('toast.qr_generated'), 'success');
    await loadItems(); renderInventory();
  }

  function downloadQR() {
    if (!qrCurrent) return;
    const link = document.createElement('a');
    link.download = `qr-${qrCurrent.code}.png`;
    link.href = document.getElementById('qr-canvas').toDataURL('image/png');
    link.click();
  }

  function printQR() {
    if (!qrCurrent) return;
    const dataUrl = document.getElementById('qr-canvas').toDataURL('image/png');
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>QR Label</title>
      <style>
        body { font-family:-apple-system,sans-serif; text-align:center; padding:40px; }
        img { width:260px; height:260px; }
        h2 { margin:16px 0 4px; }
        .slot { color:#059669; font-weight:700; font-size:1.4rem; }
        .code { color:#64748b; font-family:monospace; font-size:.85rem; margin-top:8px; }
      </style></head>
      <body>
        <img src="${dataUrl}" />
        <h2>${escapeHtml(qrCurrent.name)}</h2>
        <div class="slot">${t('qr.slot_prefix')} ${escapeHtml(qrCurrent.slot)}</div>
        <div class="code">${escapeHtml(qrCurrent.code)}</div>
        <script>window.onload = () => window.print();<\/script>
      </body></html>
    `);
    w.document.close();
  }

  // ---------- Bindings ----------
  function bindEvents() {
    setupAuth();

    // Onboarding
    document.getElementById('form-create-biz').addEventListener('submit', async e => {
      e.preventDefault();
      const name = new FormData(e.target).get('business').trim();
      const username = state.user.user_metadata?.username || state.user.email;
      const { error } = await sb.rpc('create_business', { biz_name: name, uname: username });
      if (error) return toast(error.message, 'error');
      toast(t('toast.biz_created'), 'success');
      await routePostAuth();
    });
    document.getElementById('btn-onb-signout').addEventListener('click', () => sb.auth.signOut());

    // Nav
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
      if (!confirm(t('confirm.sign_out'))) return;
      await sb.auth.signOut();
    });

    // Scanner
    document.getElementById('btn-scan-start').addEventListener('click', () => startScanner('lookup'));
    document.getElementById('btn-scan-stop').addEventListener('click', stopScanner);

    document.getElementById('form-manual').addEventListener('submit', e => {
      e.preventDefault();
      const code = new FormData(e.target).get('code').trim();
      if (!code) return;
      showLookupResult(code, /^INV-/.test(code));
      e.target.reset();
    });

    document.getElementById('btn-result-again').addEventListener('click', () => {
      document.getElementById('scan-result').hidden = true;
      startScanner('lookup');
    });
    document.getElementById('btn-result-map').addEventListener('click', e => {
      const code = e.target.dataset.code;
      const type = e.target.dataset.type;
      showView('setup');
      $('input[name="code"]', document.getElementById('form-map')).value = code;
      $('select[name="type"]', document.getElementById('form-map')).value = type;
      $('input[name="name"]', document.getElementById('form-map')).focus();
      document.getElementById('scan-result').hidden = true;
    });

    // Shelves — now includes sub-slots
    document.getElementById('form-shelves').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const rows = parseInt(f.get('rows'), 10);
      const cols = parseInt(f.get('cols'), 10);
      const subslots = parseInt(f.get('subslots'), 10) || 0;
      if (rows < 1 || rows > 26 || cols < 1 || cols > 99 || subslots < 0 || subslots > 10)
        return toast(t('error.invalid_layout'), 'error');
      const newSlots = new Set(allSlots(rows, cols, subslots));
      const orphans = state.items.filter(i => !newSlots.has(i.slot));
      if (orphans.length && !confirm(t('confirm.orphan', { n: orphans.length }))) return;
      if (orphans.length) {
        const { error: delErr } = await sb.from('items').delete()
          .eq('business_id', state.business.id)
          .in('id', orphans.map(o => o.id));
        if (delErr) return toast(delErr.message, 'error');
      }
      const { error } = await sb.from('businesses')
        .update({ shelves_rows: rows, shelves_cols: cols, shelves_subslots: subslots })
        .eq('id', state.business.id);
      if (error) return toast(error.message, 'error');
      state.business = { ...state.business, shelves_rows: rows, shelves_cols: cols, shelves_subslots: subslots };
      renderShelvesSummary();
      renderSlotSelects();
      await loadItems(); renderInventory();
      toast(t('toast.layout_saved'), 'success');
    });

    // Map item
    document.getElementById('form-map').addEventListener('submit', async e => {
      e.preventDefault();
      if (!state.business.shelves_rows) return toast(t('error.setup_shelves_first'), 'error');
      const f = new FormData(e.target);
      const code = f.get('code').trim();
      const name = f.get('name').trim();
      const slot = f.get('slot');
      const type = f.get('type');
      const validSlots = allSlots(state.business.shelves_rows, state.business.shelves_cols, state.business.shelves_subslots || 0);
      if (!validSlots.includes(slot)) return toast(t('error.slot_not_in_layout'), 'error');
      const existing = state.items.find(i => i.code === code);
      if (existing) {
        if (!confirm(t('confirm.replace_code', { slot: existing.slot, name: existing.name }))) return;
        const { error } = await sb.from('items').update({ name, slot, type }).eq('id', existing.id);
        if (error) return toast(error.message, 'error');
      } else {
        const { error } = await sb.from('items').insert({
          business_id: state.business.id, code, name, slot, type,
        });
        if (error) return toast(error.message, 'error');
      }
      e.target.reset();
      $('select[name="type"]', e.target).value = 'barcode';
      toast(t('toast.removed').replace('removed', '') + `"${name}" → ${slot}`, 'success');
      await loadItems(); renderInventory();
    });

    document.getElementById('btn-map-scan').addEventListener('click', () => {
      showView('scan');
      startScanner('map');
      toast(t('toast.point_camera'));
    });

    // Invite + modal
    document.getElementById('btn-invite').addEventListener('click', openInviteModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', e => {
      if (e.target.id === 'modal') closeModal();
    });

    // Inventory filters
    document.getElementById('inv-search').addEventListener('input', renderInventory);
    document.getElementById('inv-type-filter').addEventListener('change', renderInventory);

    // QR
    document.getElementById('form-qr').addEventListener('submit', e => {
      e.preventDefault();
      if (!state.business.shelves_rows) return toast(t('error.setup_shelves_first'), 'error');
      const f = new FormData(e.target);
      generateQR(f.get('name').trim(), f.get('slot'));
    });
    document.getElementById('btn-qr-download').addEventListener('click', downloadQR);
    document.getElementById('btn-qr-print').addEventListener('click', printQR);
  }

  // ---------- Go ----------
  document.addEventListener('DOMContentLoaded', boot);
})();
