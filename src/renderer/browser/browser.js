/* ==========================================================================
   Gip 2.0 — logique de l'interface du navigateur
   ========================================================================== */
'use strict';
(() => {
  const ui = window.gipUI;
  const { ico, hydrate } = window.GipIcons;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const IS_PRIVATE = params.get('private') === '1';
  const PLATFORM = params.get('platform') || 'linux';
  const IS_MAC = PLATFORM === 'darwin';
  const HOME_URLS = ['gip://home', 'gip://home/', 'gip://newtab', 'gip://newtab/'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const fmtBytes = (n) => { if (!n && n !== 0) return '?'; const u = ['o', 'Ko', 'Mo', 'Go']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };

  let state = null;
  let settings = defaults();
  let tabs = [];
  let active = null;
  let seq = 0;
  const downloads = new Map();

  function defaults() {
    return { theme: 'dark', accent: '#7c5cff', homepage: 'gip://home', showBookmarksBar: true, animations: true, zoom: 1, blockAds: true, blockTrackers: true, httpsOnly: true, blockThirdPartyCookies: true, fingerprintProtection: true, sendGPC: true, stripTrackingParams: true };
  }

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                           */
  /* ------------------------------------------------------------------ */

  async function init() {
    const root = document.documentElement;
    if (IS_MAC) root.classList.add('mac');
    if (IS_PRIVATE) { root.classList.add('private'); $('#private-badge').classList.remove('hidden'); document.title = 'Gip 2.0 — Navigation privée'; }
    $('#newtab').innerHTML = ico('plus', 18);
    hydrate();
    bindChrome();
    state = await ui.invoke('ui:state');
    applySettings(state.settings);

    let splashed = false;
    try { splashed = sessionStorage.getItem('gip-splashed') === '1'; } catch {}
    if (!splashed && !IS_PRIVATE) {
      await sleep(2300);
      try { sessionStorage.setItem('gip-splashed', '1'); } catch {}
    }
    $('#splash').classList.add('out');
    setTimeout(() => $('#splash').remove(), 900);

    if (IS_PRIVATE || state.loggedIn) startBrowser();
    else showAuth();
  }

  function applySettings(s) {
    settings = { ...defaults(), ...(s || {}) };
    const root = document.documentElement;
    let theme = settings.theme;
    if (theme === 'system') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.dataset.theme = IS_PRIVATE ? 'dark' : theme;
    if (!IS_PRIVATE) root.style.setProperty('--accent', settings.accent || '#7c5cff');
    root.classList.toggle('no-anim', settings.animations === false);
    $('#bookmarks-bar').classList.toggle('hidden-bar', !settings.showBookmarksBar || IS_PRIVATE && !state?.loggedIn);
    updateShieldButton();
  }

  /* ------------------------------------------------------------------ */
  /* Authentification                                                    */
  /* ------------------------------------------------------------------ */

  const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#a259ff', '#4d7cff'];
  let pickedColor = COLORS[0];
  let loginAccount = null;

  function avatarHTML(acc, cls = '') {
    return `<div class="avatar ${cls}" style="--c:${esc(acc.color)}">${esc((acc.name || '?').trim()[0] || '?')}</div>`;
  }

  function authStep(id) {
    for (const s of $$('.auth-step')) s.classList.add('hidden');
    const el = $('#' + id);
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }

  function showAuth() {
    $('#auth').classList.remove('hidden');
    const list = $('#auth-accounts');
    if (!state.accounts.length) {
      $('#auth-sub').textContent = 'Bienvenue ! Créez votre premier compte';
      authStep('auth-create');
      $('#create-back').classList.add('hidden');
      setTimeout(() => $('#create-name').focus(), 400);
    } else {
      $('#auth-sub').textContent = 'Choisissez votre compte';
      $('#create-back').classList.remove('hidden');
      list.innerHTML = state.accounts.map((a, i) => `<button class="acc" data-id="${esc(a.id)}" style="animation-delay:${0.1 + i * 0.06}s">${avatarHTML(a, 'lg')}<b>${esc(a.name)}</b><span class="muted small">${esc(a.handle)}@gip.local</span></button>`).join('');
      authStep('auth-pick');
      if (state.accounts.length === 1) showLogin(state.accounts[0]);
    }
    $('#create-colors').innerHTML = COLORS.map((c) => `<button type="button" style="background:${c};color:${c}" data-c="${c}" class="${c === pickedColor ? 'on' : ''}"></button>`).join('');
  }

  function showLogin(acc) {
    loginAccount = acc;
    $('#login-avatar').outerHTML = `<div class="avatar xl" id="login-avatar" style="--c:${esc(acc.color)}">${esc(acc.name[0])}</div>`;
    $('#login-name').textContent = acc.name;
    $('#login-addr').textContent = acc.handle + '@gip.local';
    $('#login-err').textContent = '';
    $('#login-pass').value = '';
    $('#auth-sub').textContent = 'Déverrouillez votre espace';
    authStep('auth-login');
    setTimeout(() => $('#login-pass').focus(), 300);
  }

  function authError(where, msg) {
    $('#' + where + '-err').textContent = msg;
    const card = $('.auth-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }

  async function finishAuth(newState) {
    state = newState;
    applySettings(state.settings);
    $('#auth').classList.add('out');
    await sleep(500);
    $('#auth').classList.add('hidden');
    $('#auth').classList.remove('out');
    startBrowser();
  }

  function bindAuth() {
    $('#auth-accounts').addEventListener('click', (e) => {
      const b = e.target.closest('.acc');
      if (b) showLogin(state.accounts.find((a) => a.id === b.dataset.id));
    });
    $('#auth-new').onclick = () => { $('#auth-sub').textContent = 'Nouveau compte Gip'; authStep('auth-create'); setTimeout(() => $('#create-name').focus(), 300); };
    $('#create-back').onclick = () => showAuth();
    $('#login-back').onclick = () => { $('#auth-sub').textContent = 'Choisissez votre compte'; authStep('auth-pick'); };
    $('#auth-guest').onclick = async () => finishAuth(await ui.invoke('ui:guest'));
    $('#create-colors').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      pickedColor = b.dataset.c;
      $$('#create-colors button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#create-pass').addEventListener('input', (e) => {
      const v = e.target.value;
      let s = 0;
      if (v.length >= 6) s++; if (v.length >= 10) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^\w]/.test(v)) s++;
      const bar = $('#create-strength');
      bar.style.width = (s / 5 * 100) + '%';
      bar.style.background = ['#ff5c7a', '#ff5c7a', '#ffb547', '#ffd84d', '#2ee59d', '#2ee59d'][s];
    });
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('.btn');
      btn.classList.add('loading');
      try {
        await sleep(50);
        finishAuth(await ui.invoke('ui:login', { id: loginAccount.id, password: $('#login-pass').value }));
      } catch (err) {
        authError('login', cleanErr(err));
        $('#login-pass').select();
      } finally { btn.classList.remove('loading'); }
    });
    $('#create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = $('#create-pass').value, p2 = $('#create-pass2').value;
      if (p1 !== p2) return authError('create', 'Les mots de passe ne correspondent pas');
      const btn = e.target.querySelector('.btn');
      btn.classList.add('loading');
      try {
        finishAuth(await ui.invoke('ui:create-account', { name: $('#create-name').value, password: p1, color: pickedColor }));
      } catch (err) { authError('create', cleanErr(err)); } finally { btn.classList.remove('loading'); }
    });
  }

  function cleanErr(err) { return String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

  /* ------------------------------------------------------------------ */
  /* Navigateur                                                          */
  /* ------------------------------------------------------------------ */

  function startBrowser() {
    $('#browser').classList.remove('hidden');
    renderAccountButton();
    renderBookmarks();
    setUnread(state.unread || 0);
    const first = state.initialUrl || settings.homepage || 'gip://home';
    createTab(first);
    const last = (state.lastSession || []).filter((t) => t.url && !HOME_URLS.includes(t.url));
    if (!IS_PRIVATE && last.length) {
      toast(`Restaurer ${last.length} onglet${last.length > 1 ? 's' : ''} de la session précédente ?`, {
        action: 'Restaurer', timeout: 9000,
        onAction: () => { for (const t of last) createTab(t.url, { background: true, title: t.title }); }
      });
    }
    ui.invoke('ui:downloads').then((list) => { for (const d of list) if (d.state === 'progressing') downloads.set(d.id, d); updateDlButton(); });
  }

  function homepage() { return settings.homepage || 'gip://home'; }

  function createTab(url, opts = {}) {
    const id = 'tab' + (++seq);
    const wv = document.createElement('webview');
    wv.setAttribute('partition', state.partition);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, spellcheck=yes');
    wv.src = url || homepage();
    wv.loadURL_safe = (u) => wv.loadURL(u).catch(() => {});

    const el = document.createElement('div');
    el.className = 'tab loading';
    el.draggable = true;
    el.dataset.id = id;
    el.innerHTML = `<i class="sep"></i><span class="fav"></span><span class="title">${esc(opts.title || 'Chargement…')}</span><button class="audio" title="Couper le son">${ico('volume', 14)}</button><button class="close" title="Fermer l'onglet (Ctrl+W)">${ico('x', 14)}</button><i class="glow"></i>`;

    const tab = { id, wv, el, url: wv.src, title: opts.title || '', favicon: null, loading: true, wcId: null, audible: false, muted: false, zoom: settings.zoom || 1, shield: { ads: 0, trackers: 0, upgrades: 0, params: 0, hosts: [] }, crashed: false, canBack: false, canFwd: false, pinned: false };

    let idx = tabs.length;
    if (typeof opts.index === 'number') idx = opts.index;
    else if (opts.afterActive && active) idx = tabs.indexOf(active) + 1;
    tabs.splice(idx, 0, tab);
    const tabsEl = $('#tabs');
    const ref = tabs[idx + 1] ? tabs[idx + 1].el : null;
    tabsEl.insertBefore(el, ref);
    $('#views').appendChild(wv);
    renderTab(tab);
    bindTab(tab);
    if (!opts.background) activate(tab);
    layoutTabs();
    saveSession();
    return tab;
  }

  function bindTab(tab) {
    const { wv, el } = tab;
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); closeTab(tab); return; }
      if (e.button === 0 && !e.target.closest('.close, .audio')) activate(tab);
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(tab, e.clientX, e.clientY); });
    el.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab); });
    el.querySelector('.audio').addEventListener('click', (e) => { e.stopPropagation(); toggleMute(tab); });
    el.addEventListener('dragstart', (e) => { dragTab = tab; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tab.url); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.tab.drop-before').forEach((x) => x.classList.remove('drop-before')); dragTab = null; });
    el.addEventListener('dragover', (e) => { if (!dragTab || dragTab === tab) return; e.preventDefault(); $$('.tab.drop-before').forEach((x) => x.classList.remove('drop-before')); el.classList.add('drop-before'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragTab || dragTab === tab) return;
      tabs.splice(tabs.indexOf(dragTab), 1);
      tabs.splice(tabs.indexOf(tab), 0, dragTab);
      $('#tabs').insertBefore(dragTab.el, tab.el);
      saveSession();
    });

    wv.addEventListener('dom-ready', () => {
      if (!tab.wcId) {
        tab.wcId = wv.getWebContentsId();
        if (tab.zoom !== 1) wv.setZoomFactor(tab.zoom);
      }
      updateNavState(tab);
    });
    wv.addEventListener('did-start-loading', () => { tab.loading = true; renderTab(tab); if (tab === active) { progress(true); updateToolbar(); } });
    wv.addEventListener('did-stop-loading', () => { tab.loading = false; renderTab(tab); updateNavState(tab); if (tab === active) { progress(false); updateToolbar(); } });
    wv.addEventListener('did-navigate', (e) => { tab.url = e.url; tab.crashed = false; tab.favicon = null; onNavigated(tab); });
    wv.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { tab.url = e.url; onNavigated(tab); } });
    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title; renderTab(tab);
      if (tab === active) document.title = (e.title ? e.title + ' — ' : '') + 'Gip 2.0';
      if (!isInternal(tab.url)) ui.invoke('ui:history-title', { url: tab.url, title: e.title });
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      const f = (e.favicons || []).find((x) => /^(https?|data):/.test(x));
      if (f) { tab.favicon = f; renderTab(tab); ui.invoke('ui:history-title', { url: tab.url, favicon: f }); }
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (!e.isMainFrame || e.errorCode === -3 || e.errorCode === 0) return;
      const q = new URLSearchParams({ code: e.errorCode, desc: e.errorDescription || '', url: e.validatedURL || tab.url });
      wv.loadURL('gip://error/?' + q.toString()).catch(() => {});
    });
    wv.addEventListener('update-target-url', (e) => {
      const s = $('#status-link');
      if (tab !== active) return;
      if (e.url) { s.textContent = e.url; s.classList.remove('hidden'); } else s.classList.add('hidden');
    });
    wv.addEventListener('found-in-page', (e) => {
      const r = e.result;
      if (r.finalUpdate !== false) {
        $('#find-count').textContent = (r.matches ? r.activeMatchOrdinal : 0) + '/' + r.matches;
        $('#findbar').classList.toggle('nomatch', !r.matches && !!$('#find-input').value);
      }
    });
    wv.addEventListener('enter-html-full-screen', () => document.body.classList.add('html-fullscreen'));
    wv.addEventListener('leave-html-full-screen', () => document.body.classList.remove('html-fullscreen'));
    wv.addEventListener('media-started-playing', () => { tab.audible = true; renderTab(tab); });
    wv.addEventListener('media-paused', () => { tab.audible = false; renderTab(tab); });
    wv.addEventListener('render-process-gone', () => { tab.crashed = true; tab.loading = false; renderTab(tab); if (tab === active) updateCrash(); });
    wv.addEventListener('close', () => closeTab(tab));
  }

  function onNavigated(tab) {
    renderTab(tab);
    updateNavState(tab);
    if (tab === active) { updateToolbar(); updateCrash(); }
    if (!isInternal(tab.url) || (tab.url.startsWith('gip://') && !HOME_URLS.includes(tab.url) && !tab.url.startsWith('gip://error'))) {
      ui.invoke('ui:history-add', { url: tab.url, title: tab.title, favicon: tab.favicon });
    }
    saveSession();
  }

  function isInternal(url) { return String(url).startsWith('gip:'); }

  function displayUrl(url) {
    if (!url) return '';
    if (HOME_URLS.includes(url)) return '';
    if (url.startsWith('gip://error')) { try { return new URL(url).searchParams.get('url') || url; } catch { return url; } }
    if (url.startsWith('gip://search')) { try { const q = new URL(url).searchParams.get('q'); if (q) return q; } catch {} }
    return url;
  }

  function updateNavState(tab) {
    try {
      tab.canBack = tab.wv.canGoBack();
      tab.canFwd = tab.wv.canGoForward();
    } catch {}
    if (tab === active) updateToolbar();
  }

  function renderTab(tab) {
    const { el } = tab;
    el.classList.toggle('loading', tab.loading);
    el.classList.toggle('audible', tab.audible && !tab.muted);
    el.classList.toggle('muted', tab.muted);
    el.classList.toggle('pinned', tab.pinned);
    const title = tab.title || displayUrl(tab.url) || 'Nouvel onglet';
    const t = el.querySelector('.title');
    if (t.textContent !== title) t.textContent = title;
    el.title = title + (tab.url && !HOME_URLS.includes(tab.url) ? '\n' + displayUrl(tab.url) : '');
    const fav = el.querySelector('.fav');
    let html;
    if (tab.crashed) html = '<span class="letter" style="background:var(--danger)">!</span>';
    else if (tab.favicon) html = `<img src="${esc(tab.favicon)}" alt="">`;
    else if (isInternal(tab.url)) html = `<span class="letter">G</span>`;
    else html = `<span class="letter">${esc((hostOf(tab.url)[0] || '•').toUpperCase())}</span>`;
    if (fav.dataset.html !== html) {
      fav.dataset.html = html;
      fav.innerHTML = html;
      const img = fav.querySelector('img');
      if (img) img.onerror = () => { tab.favicon = null; renderTab(tab); };
    }
    el.querySelector('.audio').innerHTML = ico(tab.muted ? 'mute' : 'volume', 14);
  }

  function activate(tab) {
    if (!tab) return;
    if (active && active !== tab) {
      active.el.classList.remove('active');
      active.wv.classList.remove('active');
    }
    active = tab;
    tab.el.classList.add('active');
    tab.wv.classList.add('active');
    document.title = (tab.title ? tab.title + ' — ' : '') + 'Gip 2.0';
    tab.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#status-link').classList.add('hidden');
    closeFind(false);
    updateToolbar();
    updateCrash();
    progress(tab.loading, true);
    if (tab.wcId) ui.invoke('ui:shield', tab.wcId).then((s) => { tab.shield = s; updateShieldButton(); });
    if (document.activeElement !== $('#url')) {
      if (HOME_URLS.includes(tab.url)) setTimeout(() => focusUrl(), 50);
      else try { tab.wv.focus(); } catch {}
    }
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    if (!isInternal(tab.url)) ui.invoke('ui:closed-tab', 'push', { url: tab.url, title: tab.title });
    tabs.splice(i, 1);
    tab.el.classList.add('closing');
    setTimeout(() => tab.el.remove(), 230);
    tab.wv.remove();
    if (!tabs.length) {
      if (IS_PRIVATE) { ui.invoke('ui:window', 'close'); return; }
      createTab(homepage());
    } else if (tab === active) {
      active = null;
      activate(tabs[Math.min(i, tabs.length - 1)]);
    }
    layoutTabs();
    saveSession();
  }

  function layoutTabs() {
    requestAnimationFrame(() => {
      const strip = $('#titlebar').clientWidth - (IS_MAC ? 80 : 8) - 46 - (IS_MAC ? 0 : 138) - (IS_PRIVATE ? 110 : 0) - 40;
      const w = strip / Math.max(1, tabs.length);
      for (const t of tabs) t.el.classList.toggle('narrow', w < 84);
      $('#tabs').style.maxWidth = Math.max(100, strip) + 'px';
    });
  }

  let saveTimer;
  function saveSession() {
    if (IS_PRIVATE) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => ui.invoke('ui:session-save', tabs.map((t) => ({ url: t.url, title: t.title }))), 800);
  }

  function toggleMute(tab) {
    tab.muted = !tab.muted;
    try { tab.wv.setAudioMuted(tab.muted); } catch {}
    renderTab(tab);
  }

  async function reopenClosed() {
    const t = await ui.invoke('ui:closed-tab', 'pop');
    if (t) createTab(t.url, { title: t.title });
    else toast('Aucun onglet récemment fermé');
  }

  /* ------------------------------------------------------------------ */
  /* Barre d'outils                                                      */
  /* ------------------------------------------------------------------ */

  function updateToolbar() {
    const tab = active;
    if (!tab) return;
    $('#btn-back').disabled = !tab.canBack;
    $('#btn-forward').disabled = !tab.canFwd;
    $('#btn-reload').innerHTML = ico(tab.loading ? 'stop' : 'reload', 18);
    $('#btn-reload').title = tab.loading ? 'Arrêter (Échap)' : 'Actualiser (Ctrl+R)';
    if (document.activeElement !== $('#url')) $('#url').value = displayUrl(tab.url);
    const si = $('#site-info');
    si.className = 'omni-ico';
    let icon = 'globe';
    const u = tab.url || '';
    if (u.startsWith('https:')) { si.classList.add('secure'); icon = 'lock'; }
    else if (u.startsWith('http:')) { si.classList.add('insecure'); icon = 'warn'; }
    else if (u.startsWith('gip:')) { si.classList.add('internal'); icon = 'sparkle'; }
    si.innerHTML = ico(icon, 16);
    const bookmarked = (state.bookmarks || []).some((b) => b.url === u);
    $('#btn-star').classList.toggle('on', bookmarked);
    $('#btn-star').classList.toggle('hidden', HOME_URLS.includes(u) || !state.loggedIn);
    const z = $('#zoom-ind');
    z.classList.toggle('hidden', Math.abs(tab.zoom - 1) < 0.01);
    z.textContent = Math.round(tab.zoom * 100) + '%';
    updateShieldButton();
  }

  function updateShieldButton() {
    const btn = $('#btn-shield');
    if (!btn) return;
    const on = settings.blockAds || settings.blockTrackers;
    btn.classList.toggle('off', !on);
    btn.innerHTML = ico(on ? 'shield' : 'shieldOff', 16) + `<b id="shield-count" class="hidden">0</b>`;
    const s = active && active.shield;
    const n = s ? s.ads + s.trackers : 0;
    const c = $('#shield-count');
    c.textContent = n > 99 ? '99+' : n;
    c.classList.toggle('hidden', !n || !on);
    btn.classList.toggle('hidden', active ? isInternal(active.url) : true);
  }

  function updateCrash() { $('#crash').classList.toggle('hidden', !(active && active.crashed)); }

  let progTimer;
  function progress(on, instant) {
    const p = $('#progress');
    clearTimeout(progTimer);
    if (on) {
      if (instant && p.classList.contains('run')) return;
      p.className = ''; void p.offsetWidth; p.className = 'run';
    } else {
      if (instant) { p.className = ''; return; }
      p.className = 'done';
      progTimer = setTimeout(() => { p.className = ''; }, 700);
    }
  }

  async function navigate(input, newTab = false) {
    const url = await ui.invoke('ui:resolve', input);
    if (!url) return;
    if (newTab || !active) createTab(url, { afterActive: true });
    else { active.wv.loadURL_safe(url); active.url = url; updateToolbar(); }
    hideSuggest();
    try { (active.wv).focus(); } catch {}
  }

  function focusUrl() {
    const u = $('#url');
    u.focus();
    u.select();
  }

  /* ------------------------------ Omnibox ------------------------------ */

  let sugItems = [];
  let sugSel = -1;
  let sugTimer;
  let sugReq = 0;

  function hideSuggest() { $('#suggest').classList.add('hidden'); sugItems = []; sugSel = -1; }

  function renderSuggest() {
    const box = $('#suggest');
    if (!sugItems.length) return hideSuggest();
    const icons = { bookmark: 'star', history: 'history', search: 'search', url: 'globe' };
    box.innerHTML = sugItems.map((s, i) => `<div class="sug ${i === sugSel ? 'sel' : ''}" data-i="${i}" style="animation-delay:${i * 0.02}s"><span class="ico">${ico(icons[s.type] || 'globe', 16)}</span><span class="t">${esc(s.title)}</span>${s.type !== 'search' ? `<span class="u">${esc(displayUrl(s.url))}</span>` : ''}</div>`).join('');
    box.classList.remove('hidden');
  }

  async function querySuggest(q) {
    const req = ++sugReq;
    if (!q.trim()) return hideSuggest();
    const first = [{ type: /^\S+\.\S{2,}|^gip:|^https?:/.test(q) ? 'url' : 'search', title: q, url: null, raw: q }];
    sugItems = first; sugSel = 0; renderSuggest();
    const r = await ui.invoke('ui:suggest', q);
    if (req !== sugReq || document.activeElement !== $('#url')) return;
    sugItems = [...first, ...r.local, ...r.remote.filter((x) => x.title.toLowerCase() !== q.toLowerCase())].slice(0, 10);
    renderSuggest();
  }

  function pickSuggest(i, newTab) {
    const s = sugItems[i];
    if (!s) return;
    if (s.url) { if (newTab) createTab(s.url, { afterActive: true }); else { active.wv.loadURL_safe(s.url); active.url = s.url; updateToolbar(); } hideSuggest(); try { active.wv.focus(); } catch {} }
    else navigate(s.raw, newTab);
  }

  function bindOmnibox() {
    const url = $('#url');
    url.addEventListener('focus', () => { $('#omnibox').classList.add('focus'); setTimeout(() => url.select(), 0); });
    url.addEventListener('blur', () => { $('#omnibox').classList.remove('focus'); setTimeout(() => { hideSuggest(); if (active && document.activeElement !== url) url.value = displayUrl(active.url); }, 150); });
    url.addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(() => querySuggest(url.value), 90); });
    url.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!sugItems.length) return;
        e.preventDefault();
        sugSel = (sugSel + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
        renderSuggest();
        const s = sugItems[sugSel];
        url.value = s.type === 'search' ? s.title : (s.url ? displayUrl(s.url) : s.raw);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (sugSel > 0) pickSuggest(sugSel, e.altKey);
        else navigate(url.value, e.altKey);
      } else if (e.key === 'Escape') {
        hideSuggest();
        url.value = displayUrl(active && active.url);
        url.select();
      }
    });
    $('#suggest').addEventListener('mousedown', (e) => {
      const s = e.target.closest('.sug');
      if (s) { e.preventDefault(); pickSuggest(+s.dataset.i, e.button === 1); }
    });
  }

  /* ------------------------------ Favoris ------------------------------ */

  function favHTML(url, fav) {
    if (fav) return `<img src="${esc(fav)}" alt="" onerror="this.outerHTML='<span class=&quot;letter&quot;>${esc((hostOf(url)[0] || 'G').toUpperCase())}</span>'">`;
    return `<span class="letter">${esc(isInternal(url) ? 'G' : (hostOf(url)[0] || '•').toUpperCase())}</span>`;
  }

  function renderBookmarks() {
    const bar = $('#bookmarks-bar');
    const list = state.bookmarks || [];
    if (!state.loggedIn) { bar.innerHTML = '<span class="bm-empty">Navigation privée — aucun favori enregistré</span>'; return; }
    bar.innerHTML = list.length
      ? list.map((b, i) => `<button class="bm" data-url="${esc(b.url)}" title="${esc(b.title)}\n${esc(b.url)}" style="animation-delay:${i * 0.03}s">${b.favicon ? `<img src="${esc(b.favicon)}" alt="">` : `<span class="letter">${esc(isInternal(b.url) ? 'G' : (hostOf(b.url)[0] || '•').toUpperCase())}</span>`}<span>${esc(b.title)}</span></button>`).join('')
      : '<span class="bm-empty">Ajoutez des favoris avec ★ ou Ctrl+D</span>';
    $$('.bm img', bar).forEach((img) => { img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'letter', textContent: (hostOf(img.closest('.bm').dataset.url)[0] || '•').toUpperCase() })); }; });
  }

  async function toggleBookmark() {
    if (!active || !state.loggedIn || HOME_URLS.includes(active.url)) return;
    const added = await ui.invoke('ui:bookmark-toggle', { url: active.url, title: active.title, favicon: active.favicon });
    toast(added ? '★ Ajouté aux favoris' : 'Retiré des favoris');
  }

  /* ------------------------------ Popovers ------------------------------ */

  let openPop = null;

  function closePopover() {
    if (!openPop) return;
    const p = openPop;
    openPop = null;
    p.classList.add('closing');
    $('#layer').classList.remove('open');
    setTimeout(() => p.remove(), 160);
  }

  function popover(html, anchor, { cls = '', align = 'right', x, y } = {}) {
    closePopover();
    const layer = $('#layer');
    const p = document.createElement('div');
    p.className = 'popover ' + cls;
    p.innerHTML = html;
    layer.appendChild(p);
    layer.classList.add('open');
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      p.style.top = (r.bottom + 6) + 'px';
      if (align === 'right') p.style.right = Math.max(8, innerWidth - r.right) + 'px';
      else { p.style.left = Math.max(8, r.left) + 'px'; p.style.transformOrigin = 'top left'; }
    } else if (x != null) {
      p.style.left = Math.min(x, innerWidth - 280) + 'px';
      p.style.top = Math.min(y, innerHeight - p.offsetHeight - 10) + 'px';
      p.style.transformOrigin = 'top left';
    }
    hydrate(p);
    openPop = p;
    return p;
  }

  function menuItem(icon, label, action, kbd = '', extra = '') {
    return `<button class="menu-item ${extra}" data-act="${action}">${ico(icon, 17)}<span>${esc(label)}</span>${kbd ? `<span class="kbd">${esc(kbd)}</span>` : ''}</button>`;
  }

  const MOD = IS_MAC ? '⌘' : 'Ctrl+';

  function openMenu() {
    const z = active ? Math.round(active.zoom * 100) : 100;
    const p = popover(`<div class="menu">
      ${menuItem('plus', 'Nouvel onglet', 'newtab', MOD + 'T')}
      ${menuItem('window', 'Nouvelle fenêtre', 'newwin', MOD + 'N')}
      ${menuItem('mask', 'Nouvelle fenêtre privée', 'private', MOD + 'Maj+N')}
      <div class="menu-sep"></div>
      <div class="menu-row"><span class="label">${ico('zoomIn', 17)} Zoom</span><div class="zoom-ctl"><button class="icon-btn sm" data-act="zoomout">${ico('zoomOut', 15)}</button><b id="menu-zoom">${z}%</b><button class="icon-btn sm" data-act="zoomin">${ico('zoomIn', 15)}</button><button class="icon-btn sm" data-act="fullscreen" title="Plein écran">${ico('fullscreen', 15)}</button></div></div>
      <div class="menu-sep"></div>
      ${menuItem('history', 'Historique', 'history', MOD + 'H')}
      ${menuItem('download', 'Téléchargements', 'downloads', MOD + 'J')}
      ${menuItem('bookmark', 'Favoris', 'bookmarks')}
      ${menuItem('key', 'Coffre-fort de mots de passe', 'vault')}
      <div class="menu-sep"></div>
      ${menuItem('find', 'Rechercher dans la page', 'find', MOD + 'F')}
      ${menuItem('print', 'Imprimer…', 'print', MOD + 'P')}
      ${menuItem('code', 'Outils de développement', 'devtools', 'F12')}
      <div class="menu-sep"></div>
      ${menuItem('shield', 'Confidentialité & sécurité', 'privacy')}
      ${menuItem('settings', 'Paramètres', 'settings')}
      ${menuItem('info', 'À propos de Gip 2.0', 'about')}
      <div class="menu-sep"></div>
      ${state.loggedIn ? menuItem('lock', 'Verrouiller Gip', 'lock') : ''}
      ${menuItem('power', 'Quitter', 'quit', '', 'danger')}
    </div>`, $('#btn-menu'), { cls: 'menu' });
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act;
      if (a === 'zoomin' || a === 'zoomout') { zoom(a === 'zoomin' ? 1 : -1); $('#menu-zoom').textContent = Math.round(active.zoom * 100) + '%'; return; }
      closePopover();
      runAction(a);
    });
  }

  function runAction(a) {
    const open = (u) => openInternal(u);
    switch (a) {
      case 'newtab': createTab(homepage()); break;
      case 'newwin': ui.invoke('ui:window', 'new'); break;
      case 'private': ui.invoke('ui:window', 'private'); break;
      case 'fullscreen': ui.invoke('ui:window', 'fullscreen'); break;
      case 'history': open('gip://history'); break;
      case 'downloads': open('gip://downloads'); break;
      case 'bookmarks': open('gip://bookmarks'); break;
      case 'vault': open('gip://vault'); break;
      case 'privacy': open('gip://privacy'); break;
      case 'settings': open('gip://settings'); break;
      case 'about': open('gip://about'); break;
      case 'account': open('gip://account'); break;
      case 'mail': open('gip://mail'); break;
      case 'find': openFind(); break;
      case 'print': try { active.wv.print(); } catch {} break;
      case 'devtools': try { active.wv.isDevToolsOpened() ? active.wv.closeDevTools() : active.wv.openDevTools(); } catch {} break;
      case 'lock': ui.invoke('ui:lock'); break;
      case 'quit': ui.invoke('ui:window', 'quit'); break;
    }
  }

  function openInternal(url) {
    const existing = tabs.find((t) => t.url.replace(/\/$/, '') === url || t.url.startsWith(url + '/') || t.url.startsWith(url + '?'));
    if (existing) { activate(existing); return; }
    if (active && HOME_URLS.includes(active.url)) { active.wv.loadURL_safe(url); active.url = url; updateToolbar(); }
    else createTab(url, { afterActive: true });
  }

  const SERVICES = [
    { id: 'search', name: 'Search', icon: 'search', c: '#4d7cff', url: 'gip://search' },
    { id: 'mail', name: 'Mail', icon: 'mail', c: '#ff5c8a', url: 'gip://mail' },
    { id: 'notes', name: 'Notes', icon: 'note', c: '#ffb547', url: 'gip://notes' },
    { id: 'vault', name: 'Coffre', icon: 'key', c: '#2ee59d', url: 'gip://vault' },
    { id: 'drive', name: 'Drive', icon: 'cloud', c: '#00c2ff', url: 'gip://drive' },
    { id: 'agenda', name: 'Agenda', icon: 'calendar', c: '#ff7a45', url: 'gip://agenda' },
    { id: 'privacy', name: 'Bouclier', icon: 'shield', c: '#7c5cff', url: 'gip://privacy' },
    { id: 'bookmarks', name: 'Favoris', icon: 'bookmark', c: '#a259ff', url: 'gip://bookmarks' },
    { id: 'history', name: 'Historique', icon: 'history', c: '#5b6488', url: 'gip://history' }
  ];

  function openServices() {
    const p = popover(`<div class="menu-title">Services Gip</div><div class="services-grid">${SERVICES.map((s, i) => `<button class="svc" data-url="${s.url}" style="animation-delay:${i * 0.035}s"><span class="sico" style="--c:${s.c}">${ico(s.icon, 22)}</span><span>${s.name}</span>${s.id === 'mail' && unread ? `<b class="badge">${unread}</b>` : ''}</button>`).join('')}</div>`, $('#btn-services'), { cls: 'services' });
    p.addEventListener('click', (e) => { const b = e.target.closest('.svc'); if (b) { closePopover(); openInternal(b.dataset.url); } });
  }

  function openAccount() {
    if (!state.loggedIn) {
      const p = popover(`<div class="account-head" style="--c:#b15cff"><div class="avatar lg" style="--c:#b15cff">${ico('mask', 26)}</div><b>Navigation privée</b><span class="muted small">Rien n'est enregistré. Tout est effacé à la fermeture.</span></div><div class="menu-body">${menuItem('window', 'Ouvrir une fenêtre normale', 'newwin')}</div>`, $('#btn-account'), { cls: 'account-pop' });
      p.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) { closePopover(); runAction(b.dataset.act); } });
      return;
    }
    const a = state.account;
    const p = popover(`<div class="account-head" style="--c:${esc(a.color)}">${avatarHTML(a, 'lg')}<b>${esc(a.name)}</b><span class="muted small">${state.guest ? 'Session invité — rien n\'est conservé' : esc(a.handle) + '@gip.local'}</span></div>
      <div class="menu-body">
        ${state.guest ? menuItem('user', 'Créer un compte Gip', 'lock') : menuItem('user', 'Gérer mon compte Gip', 'account')}
        ${state.guest ? '' : menuItem('mail', 'Gip Mail' + (unread ? ` · ${unread} non lu${unread > 1 ? 's' : ''}` : ''), 'mail')}
        ${menuItem('mask', 'Nouvelle fenêtre privée', 'private')}
        <div class="menu-sep"></div>
        ${menuItem('users', 'Changer de compte', 'lock')}
        ${menuItem('lock', 'Verrouiller Gip', 'lock')}
      </div>`, $('#btn-account'), { cls: 'account-pop' });
    p.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) { closePopover(); runAction(b.dataset.act); } });
  }

  function renderAccountButton() {
    const el = $('#tb-avatar');
    if (!state.loggedIn) { el.outerHTML = `<div class="avatar" id="tb-avatar" style="--c:#b15cff">${ico('mask', 18)}</div>`; return; }
    el.outerHTML = `<div class="avatar" id="tb-avatar" style="--c:${esc(state.account.color)}">${esc(state.account.name[0])}</div>`;
  }

  let unread = 0;
  function setUnread(n) {
    unread = n || 0;
    const b = $('#mail-badge');
    b.textContent = unread > 9 ? '9+' : unread;
    b.classList.toggle('hidden', !unread);
  }

  const SHIELD_TOGGLES = [
    ['blockAds', 'Bloquer les publicités'],
    ['blockTrackers', 'Bloquer les traqueurs'],
    ['blockThirdPartyCookies', 'Bloquer les cookies tiers'],
    ['httpsOnly', 'HTTPS partout'],
    ['fingerprintProtection', 'Anti-empreinte numérique'],
    ['stripTrackingParams', 'Nettoyer les liens (utm, fbclid…)']
  ];

  function openShield() {
    const s = active.shield || { ads: 0, trackers: 0, upgrades: 0, params: 0, hosts: [] };
    const on = settings.blockAds || settings.blockTrackers;
    const p = popover(`<div class="shield-head"><div class="shield-big ${on ? '' : 'off'}">${ico(on ? 'shield' : 'shieldOff', 24)}</div><div><b>Bouclier Gip ${on ? 'actif' : 'désactivé'}</b><div class="muted small">${esc(hostOf(active.url))}</div></div></div>
      <div class="shield-stats">
        <div class="stat"><b data-count="${s.ads}">0</b><span>Publicités bloquées</span></div>
        <div class="stat"><b data-count="${s.trackers}">0</b><span>Traqueurs bloqués</span></div>
        <div class="stat"><b data-count="${s.upgrades}">0</b><span>Passage en HTTPS</span></div>
        <div class="stat"><b data-count="${s.params}">0</b><span>Liens nettoyés</span></div>
      </div>
      ${state.loggedIn ? SHIELD_TOGGLES.map(([k, l]) => `<div class="toggle-row"><span>${l}</span><button class="switch ${settings[k] ? 'on' : ''}" data-k="${k}"></button></div>`).join('') : ''}
      ${s.hosts.length ? `<div class="menu-sep"></div><div class="muted small">Domaines bloqués sur cette page</div><div class="hosts">${s.hosts.map((h) => `<div>⛔ ${esc(h)}</div>`).join('')}</div>` : ''}
      <div class="menu-sep"></div>
      ${menuItem('shield', 'Tableau de bord confidentialité', 'privacy')}`, $('#btn-shield'), { cls: 'shield-pop' });
    animateCounters(p);
    p.addEventListener('click', async (e) => {
      const sw = e.target.closest('.switch');
      if (sw) {
        const k = sw.dataset.k;
        sw.classList.toggle('on');
        const s2 = await ui.invoke('ui:settings-set', { [k]: sw.classList.contains('on') });
        applySettings(s2);
        toast('Paramètre appliqué — rechargez la page pour l\'effet complet', { action: 'Recharger', onAction: () => active.wv.reload() });
        return;
      }
      const b = e.target.closest('[data-act]'); if (b) { closePopover(); runAction(b.dataset.act); }
    });
  }

  function animateCounters(root) {
    $$('[data-count]', root).forEach((el) => {
      const target = +el.dataset.count;
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 700);
        el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function openSiteInfo() {
    const u = active.url || '';
    let host = hostOf(u) || u;
    let status, icon, color;
    if (u.startsWith('https:')) { status = 'La connexion est sécurisée (HTTPS). Les informations échangées sont chiffrées.'; icon = 'lock'; color = 'var(--ok)'; }
    else if (u.startsWith('http:')) { status = 'Connexion non sécurisée. Ne saisissez aucune information sensible.'; icon = 'warn'; color = 'var(--warn)'; }
    else if (u.startsWith('gip:')) { status = 'Page interne de Gip. Vos données restent chiffrées sur cet appareil.'; icon = 'sparkle'; color = 'var(--accent)'; host = 'Gip 2.0'; }
    else { status = 'Page locale.'; icon = 'info'; color = 'var(--muted)'; }
    let origin = '';
    try { origin = new URL(u).origin; } catch {}
    const perms = (settings.sitePermissions || {})[origin] || {};
    const permLabels = { media: 'Caméra / micro', geolocation: 'Position', notifications: 'Notifications', 'clipboard-read': 'Presse-papiers', 'display-capture': 'Partage d\'écran', midi: 'MIDI' };
    const permRows = Object.entries(perms).map(([k, v]) => `<div class="toggle-row"><span>${esc(permLabels[k] || k)}</span><span class="muted small">${v === 'allow' ? 'Autorisé' : 'Bloqué'}</span></div>`).join('');
    const p = popover(`<h3>${esc(host)}</h3><div class="site-status"><span style="color:${color}">${ico(icon, 22)}</span><span class="small">${status}</span></div>
      ${permRows ? `<div class="muted small">Autorisations</div>${permRows}<div class="menu-sep"></div>` : ''}
      ${origin && !u.startsWith('gip:') ? menuItem('cookie', 'Effacer les cookies et données du site', 'clearsite') : ''}
      ${origin && !u.startsWith('gip:') && state.loggedIn ? menuItem('settings', 'Réinitialiser les autorisations', 'resetperm') : ''}`, $('#site-info'), { cls: 'site-pop', align: 'left' });
    p.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      closePopover();
      if (b.dataset.act === 'clearsite') { await ui.invoke('ui:clear-site-data', origin); toast('Données du site effacées', { action: 'Recharger', onAction: () => active.wv.reload() }); }
      if (b.dataset.act === 'resetperm') { const sp = { ...(settings.sitePermissions || {}) }; delete sp[origin]; applySettings(await ui.invoke('ui:settings-set', { sitePermissions: sp })); toast('Autorisations réinitialisées'); }
    });
  }

  /* --------------------------- Téléchargements --------------------------- */

  async function openDownloads() {
    const list = await ui.invoke('ui:downloads');
    for (const d of list) if (!downloads.has(d.id)) downloads.set(d.id, d);
    const p = popover(`<div class="menu-title">Téléchargements</div><div id="dl-list"></div><div class="menu-sep"></div>${menuItem('folder', 'Tous les téléchargements', 'downloads')}`, $('#btn-downloads'), { cls: 'dl-pop' });
    renderDlList();
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dl]');
      if (b) { ui.invoke('ui:download-action', { id: b.dataset.id, action: b.dataset.dl, file: b.dataset.path }); return; }
      const a = e.target.closest('[data-act]'); if (a) { closePopover(); runAction(a.dataset.act); }
    });
  }

  function renderDlList() {
    const box = $('#dl-list');
    if (!box) return;
    const items = [...downloads.values()].sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 12);
    if (!items.length) { box.innerHTML = '<div class="muted small" style="padding:14px">Aucun téléchargement</div>'; return; }
    box.innerHTML = items.map((d) => {
      const pct = d.total ? Math.round(d.received / d.total * 100) : 0;
      const prog = d.state === 'progressing';
      const stateTxt = prog ? (d.paused ? 'En pause · ' : '') + fmtBytes(d.received) + (d.total ? ' / ' + fmtBytes(d.total) : '') : d.state === 'completed' ? fmtBytes(d.total || d.received) + ' · Terminé' : d.state === 'cancelled' ? 'Annulé' : 'Échec';
      const actions = prog
        ? `<button class="icon-btn sm" data-dl="${d.paused ? 'resume' : 'pause'}" data-id="${esc(d.id)}" title="${d.paused ? 'Reprendre' : 'Pause'}">${ico(d.paused ? 'forward' : 'menu', 14)}</button><button class="icon-btn sm" data-dl="cancel" data-id="${esc(d.id)}" title="Annuler">${ico('x', 14)}</button>`
        : d.state === 'completed' ? `<button class="icon-btn sm" data-dl="open" data-id="${esc(d.id)}" data-path="${esc(d.path)}" title="Ouvrir">${ico('file', 14)}</button><button class="icon-btn sm" data-dl="show" data-id="${esc(d.id)}" data-path="${esc(d.path)}" title="Afficher dans le dossier">${ico('folder', 14)}</button>` : '';
      return `<div class="dl"><div class="fi">${ico('file', 18)}</div><div class="meta"><b title="${esc(d.name)}">${esc(d.name)}</b><span class="muted small">${stateTxt}</span>${prog ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>${actions}</div>`;
    }).join('');
  }

  function updateDlButton() {
    const btn = $('#btn-downloads');
    const prog = [...downloads.values()].filter((d) => d.state === 'progressing');
    btn.classList.toggle('active', prog.length > 0);
    const total = prog.reduce((s, d) => s + (d.total || 0), 0);
    const rec = prog.reduce((s, d) => s + (d.received || 0), 0);
    const pct = total ? rec / total : 0;
    $('#btn-downloads .ring circle').style.strokeDashoffset = String(94.2 * (1 - pct));
  }

  /* ------------------------------ Permissions ------------------------------ */

  const PERM_INFO = {
    media: ['camera', 'utiliser votre caméra et/ou votre micro'],
    geolocation: ['location', 'connaître votre position'],
    notifications: ['bell', 'vous envoyer des notifications'],
    'clipboard-read': ['copy', 'lire votre presse-papiers'],
    'display-capture': ['window', 'partager votre écran'],
    midi: ['volume', 'accéder à vos appareils MIDI'],
    midiSysex: ['volume', 'contrôler vos appareils MIDI'],
    hid: ['settings', 'accéder à des périphériques HID'],
    serial: ['settings', 'accéder aux ports série'],
    usb: ['settings', 'accéder à des appareils USB'],
    'idle-detection': ['user', 'savoir quand vous êtes inactif'],
    'window-management': ['window', 'gérer vos fenêtres']
  };

  function permissionPrompt(req) {
    const tab = tabs.find((t) => t.wcId === req.wcId);
    if (tab && tab !== active) activate(tab);
    const [icon, text] = PERM_INFO[req.permission] || ['info', 'utiliser « ' + req.permission + ' »'];
    let host = req.origin;
    try { host = new URL(req.origin).host; } catch {}
    const p = popover(`<div class="perm-ico">${ico(icon, 24)}</div><h3>${esc(host)}</h3><div class="muted">souhaite ${esc(text)}.</div>
      <label class="check"><input type="checkbox" id="perm-remember" ${IS_PRIVATE ? '' : 'checked'}> Mémoriser ma décision pour ce site</label>
      <div class="row"><button class="btn ghost" data-r="0">Bloquer</button><button class="btn primary" data-r="1"><span>Autoriser</span></button></div>`, null, { cls: 'perm-pop' });
    let answered = false;
    const answer = (allow) => {
      if (answered) return;
      answered = true;
      ui.invoke('ui:permission-response', { reqId: req.reqId, allow, remember: $('#perm-remember', p)?.checked });
      closePopover();
    };
    p.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) answer(b.dataset.r === '1'); });
    p._onClose = () => answer(false);
  }

  /* ------------------------------ Menu onglet ------------------------------ */

  function tabMenu(tab, x, y) {
    const p = popover(`<div class="menu">
      ${menuItem('plus', 'Nouvel onglet à droite', 'new')}
      ${menuItem('reload', 'Actualiser', 'reload')}
      ${menuItem('duplicate', 'Dupliquer', 'dup')}
      ${menuItem('pin', tab.pinned ? 'Détacher l\'onglet' : 'Épingler l\'onglet', 'pin')}
      ${menuItem(tab.muted ? 'volume' : 'mute', tab.muted ? 'Réactiver le son' : 'Couper le son du site', 'mute')}
      <div class="menu-sep"></div>
      ${menuItem('x', 'Fermer', 'close', MOD + 'W')}
      ${menuItem('x', 'Fermer les autres onglets', 'others')}
      ${menuItem('x', 'Fermer les onglets à droite', 'right')}
      <div class="menu-sep"></div>
      ${menuItem('restore', 'Rouvrir l\'onglet fermé', 'reopen', MOD + 'Maj+T')}
    </div>`, null, { cls: 'menu', x, y });
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      closePopover();
      const i = tabs.indexOf(tab);
      switch (b.dataset.act) {
        case 'new': createTab(homepage(), { index: i + 1 }); break;
        case 'reload': tab.wv.reload(); break;
        case 'dup': createTab(tab.url, { index: i + 1, title: tab.title }); break;
        case 'pin': {
          tab.pinned = !tab.pinned;
          tabs.splice(tabs.indexOf(tab), 1);
          const pos = tab.pinned ? 0 : tabs.filter((t) => t.pinned).length;
          tabs.splice(pos, 0, tab);
          $('#tabs').insertBefore(tab.el, tabs[pos + 1] ? tabs[pos + 1].el : null);
          renderTab(tab); break;
        }
        case 'mute': toggleMute(tab); break;
        case 'close': closeTab(tab); break;
        case 'others': for (const t of tabs.filter((t) => t !== tab && !t.pinned)) closeTab(t); break;
        case 'right': for (const t of tabs.slice(i + 1).filter((t) => !t.pinned)) closeTab(t); break;
        case 'reopen': reopenClosed(); break;
      }
    });
  }

  /* ------------------------------ Recherche ------------------------------ */

  function openFind() {
    if (!active || active.crashed) return;
    const fb = $('#findbar');
    fb.classList.remove('hidden');
    const inp = $('#find-input');
    inp.focus(); inp.select();
    if (inp.value) active.wv.findInPage(inp.value);
  }
  function closeFind(refocus = true) {
    const fb = $('#findbar');
    if (fb.classList.contains('hidden')) return;
    fb.classList.add('hidden');
    try { active && active.wv.stopFindInPage('clearSelection'); } catch {}
    if (refocus && active) try { active.wv.focus(); } catch {}
  }
  function bindFind() {
    const inp = $('#find-input');
    inp.addEventListener('input', () => {
      if (!inp.value) { try { active.wv.stopFindInPage('clearSelection'); } catch {} $('#find-count').textContent = '0/0'; $('#findbar').classList.remove('nomatch'); return; }
      active.wv.findInPage(inp.value);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && inp.value) active.wv.findInPage(inp.value, { forward: !e.shiftKey, findNext: true });
      if (e.key === 'Escape') closeFind();
    });
    $('#find-next').onclick = () => inp.value && active.wv.findInPage(inp.value, { forward: true, findNext: true });
    $('#find-prev').onclick = () => inp.value && active.wv.findInPage(inp.value, { forward: false, findNext: true });
    $('#find-close').onclick = () => closeFind();
  }

  /* ------------------------------ Zoom ------------------------------ */

  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  function zoom(dir) {
    if (!active) return;
    let z;
    if (dir === 0) z = 1;
    else {
      const i = ZOOMS.findIndex((v) => v >= active.zoom - 0.001);
      z = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (ZOOMS[i] === active.zoom || dir < 0 ? i : i - 1) + dir))] || 1;
    }
    active.zoom = z;
    try { active.wv.setZoomFactor(z); } catch {}
    updateToolbar();
  }

  /* ------------------------------ Raccourcis ------------------------------ */

  function handleShortcut(k) {
    const mod = IS_MAC ? k.meta : k.control;
    const key = (k.key || '').length === 1 ? k.key.toLowerCase() : k.key;
    if (key === 'Escape') {
      if (openPop) { if (openPop._onClose) openPop._onClose(); closePopover(); return true; }
      if (!$('#findbar').classList.contains('hidden')) { closeFind(); return true; }
      if (active && active.loading && document.activeElement !== $('#url')) { active.wv.stop(); return true; }
      return false;
    }
    if (!state || (!state.loggedIn && !IS_PRIVATE) || $('#browser').classList.contains('hidden')) return false;
    if (mod && k.shift && key === 't') { reopenClosed(); return true; }
    if (mod && k.shift && key === 'n') { runAction('private'); return true; }
    if (mod && k.shift && key === 'w') { ui.invoke('ui:window', 'close'); return true; }
    if (mod && k.shift && key === 'i') { runAction('devtools'); return true; }
    if (mod && k.shift && key === 'Delete') { openInternal('gip://privacy'); return true; }
    if (mod && key === 't') { createTab(homepage()); return true; }
    if (mod && key === 'n') { runAction('newwin'); return true; }
    if (mod && key === 'w') { if (active) closeTab(active); return true; }
    if ((mod && (key === 'l' || key === 'k')) || key === 'F6') { focusUrl(); return true; }
    if ((mod && key === 'r') || key === 'F5') { if (active) (k.shift ? active.wv.reloadIgnoringCache() : active.wv.reload()); return true; }
    if (mod && key === 'f') { openFind(); return true; }
    if (mod && key === 'd') { toggleBookmark(); return true; }
    if (mod && key === 'h') { runAction('history'); return true; }
    if (mod && key === 'j') { runAction('downloads'); return true; }
    if (mod && key === 'p') { runAction('print'); return true; }
    if (mod && key === 'q' && IS_MAC) { runAction('quit'); return true; }
    if (mod && key === 'Tab') {
      if (tabs.length > 1) { const i = tabs.indexOf(active); activate(tabs[(i + (k.shift ? -1 : 1) + tabs.length) % tabs.length]); }
      return true;
    }
    if (mod && /^[1-9]$/.test(key)) { const n = +key; activate(n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]); return true; }
    if (mod && (key === '=' || key === '+')) { zoom(1); return true; }
    if (mod && key === '-') { zoom(-1); return true; }
    if (mod && key === '0') { zoom(0); return true; }
    if (key === 'F11') { runAction('fullscreen'); return true; }
    if (key === 'F12') { runAction('devtools'); return true; }
    if (k.alt && key === 'ArrowLeft') { if (active && active.canBack) active.wv.goBack(); return true; }
    if (k.alt && key === 'ArrowRight') { if (active && active.canFwd) active.wv.goForward(); return true; }
    if (k.alt && key === 'Home') { if (active) active.wv.loadURL_safe(homepage()); return true; }
    return false;
  }

  /* ------------------------------ Toasts ------------------------------ */

  function toast(msg, { action, onAction, timeout = 3200 } = {}) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn primary sm"><span>${esc(action)}</span></button>` : ''}`;
    $('#toasts').appendChild(t);
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    if (action) t.querySelector('button').onclick = () => { kill(); onAction && onAction(); };
    setTimeout(kill, timeout);
  }

  /* ------------------------------ Liaisons ------------------------------ */

  let dragTab = null;

  function bindChrome() {
    bindAuth();
    bindOmnibox();
    bindFind();
    $('#newtab').onclick = () => createTab(homepage());
    $('#btn-back').onclick = () => active && active.wv.goBack();
    $('#btn-forward').onclick = () => active && active.wv.goForward();
    $('#btn-reload').onclick = (e) => { if (!active) return; if (active.loading) active.wv.stop(); else (e.shiftKey ? active.wv.reloadIgnoringCache() : active.wv.reload()); };
    $('#btn-home').onclick = () => { if (active) { active.wv.loadURL_safe(homepage()); } };
    $('#btn-star').onclick = toggleBookmark;
    $('#btn-menu').onclick = () => (openPop && openPop.classList.contains('menu') && !openPop.classList.contains('closing')) ? closePopover() : openMenu();
    $('#btn-services').onclick = () => openServices();
    $('#btn-account').onclick = () => openAccount();
    $('#btn-shield').onclick = () => openShield();
    $('#site-info').onclick = () => openSiteInfo();
    $('#btn-downloads').onclick = () => openDownloads();
    $('#zoom-ind').onclick = () => zoom(0);
    $('#crash-reload').onclick = () => { if (active) { active.crashed = false; updateCrash(); active.wv.reload(); } };
    $$('#winctl [data-win]').forEach((b) => { b.onclick = () => ui.invoke('ui:window', b.dataset.win); });
    $('#layer').addEventListener('mousedown', (e) => {
      if (e.target === $('#layer')) { if (openPop && openPop._onClose) openPop._onClose(); closePopover(); }
    });
    $('#bookmarks-bar').addEventListener('mousedown', (e) => {
      const b = e.target.closest('.bm'); if (!b) return;
      if (e.button === 1) { e.preventDefault(); createTab(b.dataset.url, { background: true, afterActive: true }); }
    });
    $('#bookmarks-bar').addEventListener('click', (e) => {
      const b = e.target.closest('.bm'); if (!b) return;
      if (e.ctrlKey || e.metaKey) createTab(b.dataset.url, { background: true, afterActive: true });
      else if (active) { active.wv.loadURL_safe(b.dataset.url); active.url = b.dataset.url; updateToolbar(); }
    });
    $('#titlebar').addEventListener('dblclick', (e) => { if (e.target.classList.contains('drag-fill') && !IS_MAC) ui.invoke('ui:window', 'maximize'); });
    $('#tabs').addEventListener('dblclick', (e) => { if (e.target.id === 'tabs') createTab(homepage()); });

    window.addEventListener('keydown', (e) => {
      if (handleShortcut({ key: e.key, control: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
    });
    window.addEventListener('resize', layoutTabs);
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applySettings(settings));

    ui.on('shortcut', (k) => handleShortcut(k));
    ui.on('tab:open', ({ url, background }) => { if (state && (state.loggedIn || IS_PRIVATE)) createTab(url, { background, afterActive: true }); });
    ui.on('window:state', (s) => { if ('maximized' in s) document.body.classList.toggle('maximized', s.maximized); });
    ui.on('shield:update', (s) => {
      const tab = tabs.find((t) => t.wcId === s.wcId);
      if (!tab) return;
      const before = tab.shield ? tab.shield.ads + tab.shield.trackers : 0;
      tab.shield = s;
      if (tab === active) {
        updateShieldButton();
        if (s.ads + s.trackers > before) { const c = $('#shield-count'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
      }
    });
    ui.on('permission:request', permissionPrompt);
    ui.on('download:update', (d) => {
      const prev = downloads.get(d.id);
      downloads.set(d.id, d);
      updateDlButton();
      renderDlList();
      if (!prev) toast('Téléchargement : ' + d.name, { action: 'Voir', onAction: openDownloads });
      if (d.state === 'completed' && prev && prev.state === 'progressing') {
        const b = $('#btn-downloads'); b.classList.remove('done'); void b.offsetWidth; b.classList.add('done');
        toast('✓ ' + d.name + ' téléchargé', { action: 'Ouvrir', onAction: () => ui.invoke('ui:download-action', { id: d.id, action: 'open', file: d.path }) });
      }
    });
    ui.on('settings:changed', (s) => { if (state) state.settings = s; applySettings(s); updateToolbar(); });
    ui.on('bookmarks:changed', (b) => { if (state) state.bookmarks = b; renderBookmarks(); updateToolbar(); });
    ui.on('mail:unread', (n) => { if (!IS_PRIVATE) setUnread(n); });
    ui.on('account:changed', (a) => { if (state && state.account && a.id === state.account.id) { state.account = a; renderAccountButton(); } });
  }

  init().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#f66;z-index:999">${esc(e.stack || e)}</pre>`); });
})();
