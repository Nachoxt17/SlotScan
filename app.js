/* =====================================================
   SlotScan — Supabase-backed multi-user app.
   ===================================================== */

(function () {
  'use strict';

  // ---------- Globals ----------
  let sb = null;             // supabase client
  const state = {
    user: null,
    business: null,
    membership: null,
    items: [],
    members: [],
    invites: [],
    realtimeChannel: null,
  };

  // ---------- Tiny helpers ----------
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function toast(msg, kind = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function letters(n) {
    const out = [];
    for (let i = 0; i < n && i < 26; i++) out.push(String.fromCharCode(65 + i));
    return out;
  }
  function allSlots(rows, cols) {
    if (!rows || !cols) return [];
    const out = [];
    for (const r of letters(rows)) for (let c = 1; c <= cols; c++) out.push(`${r}${c}`);
    return out;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function showHint(id, msg, isError) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  function showOnly(viewId) {
    ['view-boot','view-config','view-auth','view-onboarding'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== viewId;
    });
    $('#app-shell').hidden = viewId !== 'app';
  }

  // ---------- Boot ----------
  async function boot() {
    const cfg = window.SLOTSCAN_CONFIG || {};
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')
        || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
      showOnly('view-config');
      return;
    }
    sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    bindEvents();

    // React to sign-out from any tab
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        cleanupBusiness();
        state.user = null;
        showOnly('view-auth');
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
      .select('business_id, role, businesses(id, name, shelves_rows, shelves_cols)')
      .eq('user_id', state.user.id);
    if (error) { toast(error.message, 'error'); showOnly('view-auth'); return; }
    if (!memberships || memberships.length === 0) {
      await showOnboarding();
      return;
    }
    // Pick the first business (multi-business switching is a future feature)
    const m = memberships[0];
    state.business = m.businesses;
    state.membership = { role: m.role };
    await enterApp();
  }

  // ---------- Auth UI ----------
  function setupAuth() {
    const tabs = $$('.auth-tabs .tab');
    tabs.forEach(tab => tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.toggle('is-active', t === tab));
      const which = tab.dataset.tab;
      $('#form-signin').hidden = which !== 'signin';
      $('#form-signup').hidden = which !== 'signup';
      showHint('signin-hint', '', false);
      showHint('signup-hint', 'After signup you can create a new business or accept an invite.', false);
    }));

    $('#form-signin').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      showHint('signin-hint', 'Signing in…', false);
      const { data, error } = await sb.auth.signInWithPassword({
        email: f.get('email').trim().toLowerCase(),
        password: f.get('password'),
      });
      if (error) return showHint('signin-hint', error.message, true);
      state.user = data.user;
      await routePostAuth();
    });

    $('#form-signup').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const username = f.get('username').trim();
      showHint('signup-hint', 'Creating account…', false);
      const { data, error } = await sb.auth.signUp({
        email: f.get('email').trim().toLowerCase(),
        password: f.get('password'),
        options: { data: { username } },
      });
      if (error) return showHint('signup-hint', error.message, true);
      if (!data.session) {
        // Email confirmation is enabled in Supabase settings
        return showHint('signup-hint',
          'Check your email to confirm your account, then come back and sign in.', false);
      }
      state.user = data.user;
      await routePostAuth();
    });
  }

  // ---------- Onboarding (no business) ----------
  async function showOnboarding() {
    $('#onb-name').textContent =
      state.user.user_metadata?.username || state.user.email;
    // Look for pending invites for this email
    const { data: invites } = await sb
      .from('business_invites')
      .select('id, role, business_id, businesses(name)')
      .ilike('email', state.user.email)
      .is('accepted_at', null);
    const block = $('#onb-invites');
    const list = $('#onb-invites-list');
    if (invites && invites.length > 0) {
      block.hidden = false;
      list.innerHTML = invites.map(inv => `
        <div class="list-item" data-invite="${inv.id}">
          <div class="li-main">
            <div class="li-name">${escapeHtml(inv.businesses?.name || 'Business')}</div>
            <div class="li-meta">Role: ${inv.role === 'admin' ? 'Admin' : 'Sub-user'}</div>
          </div>
          <button class="btn btn-primary" data-action="accept">Join</button>
        </div>
      `).join('');
      list.querySelectorAll('[data-action="accept"]').forEach(btn => {
        btn.addEventListener('click', async e => {
          const id = e.target.closest('.list-item').dataset.invite;
          btn.disabled = true;
          const { data, error } = await sb.rpc('accept_invite', { invite_id: id });
          if (error) { btn.disabled = false; return toast(error.message, 'error'); }
          toast('Joined business', 'success');
          await routePostAuth();
        });
      });
    } else {
      block.hidden = true;
    }
    showOnly('view-onboarding');
  }

  // ---------- Enter app ----------
  async function enterApp() {
    $('#hdr-business').textContent = state.business.name;
    $('#hdr-user').textContent =
      state.user.user_metadata?.username || state.user.email;
    $('#hdr-role').textContent = state.membership.role === 'admin' ? 'Admin' : 'Sub-user';
    document.body.classList.toggle('role-sub', state.membership.role !== 'admin');

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

  // ---------- Data loads ----------
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
    const sc = ensureScanner();
    $('#scanner-empty').hidden = true;
    $('#btn-scan-start').hidden = true;
    $('#btn-scan-stop').hidden = false;
    try {
      await sc.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
        onScanSuccess,
        () => {}
      );
      scannerActive = true;
    } catch (err) {
      console.error(err);
      toast('Could not access camera. Use HTTPS and allow permission.', 'error');
      $('#scanner-empty').hidden = false;
      $('#btn-scan-start').hidden = false;
      $('#btn-scan-stop').hidden = true;
    }
  }

  async function stopScanner() {
    if (!scanner || !scannerActive) return;
    try { await scanner.stop(); } catch {}
    try { scanner.clear(); } catch {}
    scannerActive = false;
    $('#scanner-empty').hidden = false;
    $('#btn-scan-start').hidden = false;
    $('#btn-scan-stop').hidden = true;
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
      $('input[name="code"]', $('#form-map')).value = decoded;
      $('select[name="type"]', $('#form-map')).value = isQR ? 'qr' : 'barcode';
      showView('setup');
      toast('Code captured', 'success');
      return;
    }
    showLookupResult(decoded, isQR);
  }

  function showLookupResult(code, isQR) {
    const item = state.items.find(i => i.code === code);
    const card = $('#scan-result');
    card.hidden = false;
    $('#result-code').textContent = code;
    if (item) {
      $('#result-type').textContent = item.type === 'qr' ? 'Custom QR' : 'Barcode';
      $('#result-type').classList.remove('warn');
      $('#result-slot').textContent = item.slot;
      $('#result-name').textContent = item.name;
      $('#btn-result-map').hidden = true;
    } else {
      $('#result-type').textContent = 'Unmapped';
      $('#result-type').classList.add('warn');
      $('#result-slot').textContent = '—';
      $('#result-name').textContent = 'This code is not yet mapped to a slot.';
      $('#btn-result-map').hidden = state.membership.role !== 'admin';
      $('#btn-result-map').dataset.code = code;
      $('#btn-result-map').dataset.type = isQR ? 'qr' : 'barcode';
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- Rendering ----------
  function renderShelvesSummary() {
    const f = $('#form-shelves');
    const b = state.business;
    if (b.shelves_rows && b.shelves_cols) {
      f.elements.rows.value = b.shelves_rows;
      f.elements.cols.value = b.shelves_cols;
      const lastRow = letters(b.shelves_rows).slice(-1)[0];
      $('#shelves-summary').textContent =
        `${b.shelves_rows} rows × ${b.shelves_cols} cols = ${b.shelves_rows * b.shelves_cols} slots (A1 – ${lastRow}${b.shelves_cols}).`;
    } else {
      $('#shelves-summary').textContent = 'No layout yet. Save one to start mapping items.';
    }
  }

  function renderSlotSelects() {
    const slots = allSlots(state.business.shelves_rows, state.business.shelves_cols);
    [$('#map-slot-select'), $('#qr-slot-select')].forEach(sel => {
      sel.innerHTML = slots.length
        ? slots.map(s => `<option value="${s}">${s}</option>`).join('')
        : '<option value="">Set up shelves first</option>';
    });
  }

  function renderInventory() {
    const search = ($('#inv-search').value || '').trim().toLowerCase();
    const typeFilter = $('#inv-type-filter').value;
    const items = state.items.filter(i => {
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (!search) return true;
      return i.name.toLowerCase().includes(search)
          || i.code.toLowerCase().includes(search)
          || i.slot.toLowerCase().includes(search);
    });
    const list = $('#inv-list');
    if (items.length === 0) {
      list.innerHTML = '';
      $('#inv-empty').hidden = false;
      return;
    }
    $('#inv-empty').hidden = true;
    list.innerHTML = items.map(i => `
      <div class="list-item" data-id="${i.id}">
        <div class="li-main">
          <div class="li-name">${escapeHtml(i.name)}</div>
          <div class="li-meta">${i.type === 'qr' ? 'QR' : 'Barcode'} · ${escapeHtml(i.code)}</div>
        </div>
        <div class="li-slot">${escapeHtml(i.slot)}</div>
        ${state.membership.role === 'admin' ? `
          <div class="li-actions">
            <button class="icon-btn" data-action="del" title="Delete">×</button>
          </div>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('[data-action="del"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.closest('.list-item').dataset.id;
        if (!confirm('Remove this mapping?')) return;
        const { error } = await sb.from('items').delete().eq('id', id);
        if (error) return toast(error.message, 'error');
        toast('Mapping removed');
        await loadItems();
        renderInventory();
      });
    });
  }

  function renderMembers() {
    const list = $('#members-list');
    list.innerHTML = state.members.map(m => `
      <div class="list-item" data-id="${m.id}">
        <div class="li-main">
          <div class="li-name">${escapeHtml(m.username)} ${m.user_id === state.user.id ? '<span class="muted small">(you)</span>' : ''}</div>
          <div class="li-meta">${escapeHtml(m.email)} · ${m.role}</div>
        </div>
        ${m.role !== 'admin' && m.user_id !== state.user.id ? `
          <div class="li-actions"><button class="icon-btn" data-action="del-mem">×</button></div>` : ''}
      </div>
    `).join('');
    list.querySelectorAll('[data-action="del-mem"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.closest('.list-item').dataset.id;
        if (!confirm('Remove this team member?')) return;
        const { error } = await sb.from('business_members').delete().eq('id', id);
        if (error) return toast(error.message, 'error');
        toast('Member removed');
        await loadMembers();
      });
    });
  }

  function renderInvites() {
    const list = $('#invites-list');
    const empty = $('#invites-empty');
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
          <div class="li-meta">Pending · role: ${inv.role}</div>
        </div>
        <div class="li-actions"><button class="icon-btn" data-action="del-inv">×</button></div>
      </div>
    `).join('');
    list.querySelectorAll('[data-action="del-inv"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const id = e.target.closest('.list-item').dataset.id;
        if (!confirm('Cancel this invitation?')) return;
        const { error } = await sb.from('business_invites').delete().eq('id', id);
        if (error) return toast(error.message, 'error');
        toast('Invite cancelled');
        await loadInvites();
      });
    });
  }

  // ---------- Modal ----------
  function openInviteModal() {
    const body = $('#modal-body');
    $('#modal-title').textContent = 'Invite by email';
    body.innerHTML = `
      <form id="form-invite" class="stack-form">
        <label><span>Email</span><input type="email" name="email" required /></label>
        <label><span>Role</span>
          <select name="role">
            <option value="sub">Sub-user (scan + view)</option>
            <option value="admin">Admin (full control)</option>
          </select>
        </label>
        <p class="muted small">The invitee signs up at your app URL with this email. On first sign-in they’ll see a “Join” button for your business.</p>
        <button class="btn btn-primary" type="submit">Send invite</button>
      </form>
    `;
    $('#modal').hidden = false;
    $('#form-invite').addEventListener('submit', async e => {
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
      toast('Invite created — share your app URL with them', 'success');
    });
  }
  function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }

  // ---------- QR generator ----------
  let qrCurrent = null;

  async function generateQR(name, slot) {
    const code = 'INV-' + Date.now().toString(36) + '-' +
                 Math.random().toString(36).slice(2, 6).toUpperCase();
    const canvas = $('#qr-canvas');
    await new Promise((resolve, reject) =>
      QRCode.toCanvas(canvas, code,
        { width: 240, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } },
        err => err ? reject(err) : resolve()));
    const { error } = await sb.from('items').insert({
      business_id: state.business.id,
      code, name, slot, type: 'qr',
    });
    if (error) return toast(error.message, 'error');
    $('#qr-out-name').textContent = name;
    $('#qr-out-slot').textContent = `Slot ${slot}`;
    $('#qr-out-code').textContent = code;
    $('#qr-output').hidden = false;
    qrCurrent = { code, slot, name };
    toast('QR generated and item mapped', 'success');
    await loadItems();
    renderInventory();
  }

  function downloadQR() {
    if (!qrCurrent) return;
    const link = document.createElement('a');
    link.download = `qr-${qrCurrent.code}.png`;
    link.href = $('#qr-canvas').toDataURL('image/png');
    link.click();
  }

  function printQR() {
    if (!qrCurrent) return;
    const dataUrl = $('#qr-canvas').toDataURL('image/png');
    const w = window.open('', '_blank');
    w.document.write(`
      <html><head><title>QR Label</title>
      <style>
        body { font-family: -apple-system, sans-serif; text-align: center; padding: 40px; }
        img { width: 260px; height: 260px; }
        h2 { margin: 16px 0 4px; }
        .slot { color: #059669; font-weight: 700; font-size: 1.4rem; }
        .code { color: #64748b; font-family: monospace; font-size: 0.85rem; margin-top: 8px; }
      </style></head>
      <body>
        <img src="${dataUrl}" />
        <h2>${escapeHtml(qrCurrent.name)}</h2>
        <div class="slot">Slot ${escapeHtml(qrCurrent.slot)}</div>
        <div class="code">${escapeHtml(qrCurrent.code)}</div>
        <script>window.onload = () => window.print();<\/script>
      </body></html>
    `);
    w.document.close();
  }

  // ---------- Event bindings ----------
  function bindEvents() {
    setupAuth();

    // Onboarding
    $('#form-create-biz').addEventListener('submit', async e => {
      e.preventDefault();
      const name = new FormData(e.target).get('business').trim();
      const username = state.user.user_metadata?.username || state.user.email;
      const { data: bizId, error } = await sb.rpc('create_business',
        { biz_name: name, uname: username });
      if (error) return toast(error.message, 'error');
      toast('Business created', 'success');
      await routePostAuth();
    });
    $('#btn-onb-signout').addEventListener('click', async () => {
      await sb.auth.signOut();
    });

    // Nav
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

    // Logout
    $('#btn-logout').addEventListener('click', async () => {
      if (!confirm('Sign out?')) return;
      await sb.auth.signOut();
    });

    // Scan
    $('#btn-scan-start').addEventListener('click', () => startScanner('lookup'));
    $('#btn-scan-stop').addEventListener('click', stopScanner);

    $('#form-manual').addEventListener('submit', e => {
      e.preventDefault();
      const code = new FormData(e.target).get('code').trim();
      if (!code) return;
      showLookupResult(code, /^INV-/.test(code));
      e.target.reset();
    });

    $('#btn-result-again').addEventListener('click', () => {
      $('#scan-result').hidden = true;
      startScanner('lookup');
    });
    $('#btn-result-map').addEventListener('click', e => {
      const code = e.target.dataset.code;
      const type = e.target.dataset.type;
      showView('setup');
      $('input[name="code"]', $('#form-map')).value = code;
      $('select[name="type"]', $('#form-map')).value = type;
      $('input[name="name"]', $('#form-map')).focus();
      $('#scan-result').hidden = true;
    });

    // Shelves form
    $('#form-shelves').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const rows = parseInt(f.get('rows'), 10);
      const cols = parseInt(f.get('cols'), 10);
      if (rows < 1 || rows > 26 || cols < 1 || cols > 99) return toast('Invalid layout', 'error');
      // Check orphans
      const newSlots = new Set(allSlots(rows, cols));
      const orphans = state.items.filter(i => !newSlots.has(i.slot));
      if (orphans.length && !confirm(`${orphans.length} mapped item(s) sit in slots that won't exist anymore. They'll be removed. Continue?`)) return;
      if (orphans.length) {
        const { error: delErr } = await sb.from('items').delete()
          .eq('business_id', state.business.id)
          .in('id', orphans.map(o => o.id));
        if (delErr) return toast(delErr.message, 'error');
      }
      const { error } = await sb.from('businesses')
        .update({ shelves_rows: rows, shelves_cols: cols })
        .eq('id', state.business.id);
      if (error) return toast(error.message, 'error');
      state.business.shelves_rows = rows;
      state.business.shelves_cols = cols;
      renderShelvesSummary();
      renderSlotSelects();
      await loadItems();
      renderInventory();
      toast('Layout saved', 'success');
    });

    // Map form
    $('#form-map').addEventListener('submit', async e => {
      e.preventDefault();
      if (!state.business.shelves_rows) return toast('Save a shelf layout first', 'error');
      const f = new FormData(e.target);
      const code = f.get('code').trim();
      const name = f.get('name').trim();
      const slot = f.get('slot');
      const type = f.get('type');
      if (!allSlots(state.business.shelves_rows, state.business.shelves_cols).includes(slot))
        return toast('Slot not in current layout', 'error');
      const existing = state.items.find(i => i.code === code);
      if (existing) {
        if (!confirm(`This code is already mapped to ${existing.slot} (${existing.name}). Replace it?`)) return;
        const { error: upErr } = await sb.from('items')
          .update({ name, slot, type }).eq('id', existing.id);
        if (upErr) return toast(upErr.message, 'error');
      } else {
        const { error } = await sb.from('items').insert({
          business_id: state.business.id, code, name, slot, type,
        });
        if (error) return toast(error.message, 'error');
      }
      e.target.reset();
      $('select[name="type"]', e.target).value = 'barcode';
      toast(`Mapped "${name}" to ${slot}`, 'success');
      await loadItems();
      renderInventory();
    });

    $('#btn-map-scan').addEventListener('click', () => {
      showView('scan');
      startScanner('map');
      toast('Point camera at a barcode or QR');
    });

    // Invite + modal
    $('#btn-invite').addEventListener('click', openInviteModal);
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

    // Inventory filters
    $('#inv-search').addEventListener('input', renderInventory);
    $('#inv-type-filter').addEventListener('change', renderInventory);

    // QR generator
    $('#form-qr').addEventListener('submit', e => {
      e.preventDefault();
      if (!state.business.shelves_rows) return toast('Save a shelf layout first', 'error');
      const f = new FormData(e.target);
      generateQR(f.get('name').trim(), f.get('slot'));
    });
    $('#btn-qr-download').addEventListener('click', downloadQR);
    $('#btn-qr-print').addEventListener('click', printQR);
  }

  // ---------- Go ----------
  document.addEventListener('DOMContentLoaded', boot);
})();
