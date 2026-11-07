/* Gip 2.0 — utilitaires communs des pages internes */
'use strict';
(function () {
  const { ico, hydrate } = window.GipIcons;
  const api = window.gip;

  const SERVICES = [
    { id: 'search', name: 'Gip Search', icon: 'search', c: '#4d7cff', url: 'gip://search' },
    { id: 'images', name: 'Gip Images', icon: 'images', c: '#ff4fd8', url: 'gip://search?type=images' },
    { id: 'ai', name: 'Gip IA', icon: 'sparkle', c: '#00d4a6', url: 'gip://ai' },
    { id: 'mail', name: 'Gip Mail', icon: 'mail', c: '#ff5c8a', url: 'gip://mail' },
    { id: 'notes', name: 'Gip Notes', icon: 'note', c: '#ffb547', url: 'gip://notes' },
    { id: 'vault', name: 'Coffre-fort', icon: 'key', c: '#2ee59d', url: 'gip://vault' },
    { id: 'drive', name: 'Gip Drive', icon: 'cloud', c: '#00c2ff', url: 'gip://drive' },
    { id: 'agenda', name: 'Gip Agenda', icon: 'calendar', c: '#ff7a45', url: 'gip://agenda' },
    { id: 'privacy', name: 'Bouclier', icon: 'shield', c: '#7c5cff', url: 'gip://privacy' },
    { id: 'bookmarks', name: 'Favoris', icon: 'bookmark', c: '#a259ff', url: 'gip://bookmarks' },
    { id: 'history', name: 'Historique', icon: 'history', c: '#5b6488', url: 'gip://history' },
    { id: 'downloads', name: 'Téléchargements', icon: 'download', c: '#3fb6a8', url: 'gip://downloads' }
  ];

  // Services réservés à la version bureau (aucun pour l'instant).
  if (document.documentElement.classList.contains('android')) for (let i = SERVICES.length - 1; i >= 0; i--) if (SERVICES[i].desktop) SERVICES.splice(i, 1);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function cleanErr(e) { return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

  async function call(method, arg) {
    if (!api) throw new Error('API Gip indisponible');
    try { return await api.call(method, arg); } catch (e) { throw new Error(cleanErr(e)); }
  }

  function applyTheme(s) {
    if (!s) return;
    const root = document.documentElement;
    let t = s.theme;
    if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    root.dataset.theme = t || 'dark';
    if (s.accent) root.style.setProperty('--accent', s.accent);
    root.classList.toggle('no-anim', s.animations === false);
  }

  async function boot() {
    const s = await call('settings.get').catch(() => null);
    applyTheme(s);
    if (api) api.on('settings:changed', applyTheme);
    return s;
  }

  function shell(activeId, opts = {}) {
    document.body.insertAdjacentHTML('afterbegin', '<div class="bg-blobs"><i></i><i></i><i></i></div>');
    const main = $('#page');
    const wrap = document.createElement('div');
    wrap.className = 'shell';
    wrap.innerHTML = `<nav class="rail"><a class="logo" href="gip://home" title="Accueil Gip">G</a>
      ${SERVICES.filter((s) => !['downloads'].includes(s.id)).map((s) => `<a class="svc ${s.id === activeId ? 'on' : ''}" data-svc="${s.id}" href="${s.url}" style="--c:${s.c}">${ico(s.icon, 20)}<span class="tip">${s.name}</span></a>`).join('')}
      <div class="bottom"><a class="svc ${activeId === 'settings' ? 'on' : ''}" href="gip://settings" style="--c:#5b6488">${ico('settings', 20)}<span class="tip">Paramètres</span></a>
      <a class="svc ${activeId === 'account' ? 'on' : ''}" href="gip://account" style="--c:#7c5cff">${ico('user', 20)}<span class="tip">Mon compte</span></a></div></nav>`;
    main.replaceWith(wrap);
    main.classList.add('page');
    wrap.appendChild(main);
    call('mail.unread').then((n) => setMailDot(n)).catch(() => {});
    if (api) api.on('mail:unread', setMailDot);
    if (opts.title) {
      const svc = SERVICES.find((s) => s.id === activeId) || { c: opts.color || '#7c5cff', icon: opts.icon || 'sparkle' };
      main.insertAdjacentHTML('afterbegin', `<header class="page-head"><div class="hico" style="--c:${opts.color || svc.c}">${ico(opts.icon || svc.icon, 26)}</div><div><h1>${esc(opts.title)}</h1>${opts.subtitle ? `<p>${esc(opts.subtitle)}</p>` : ''}</div><div class="spacer"></div><div class="head-actions row">${opts.actions || ''}</div></header>`);
    }
    hydrate();
    return main;
  }

  function setMailDot(n) {
    const a = $('.rail [data-svc="mail"]');
    if (!a) return;
    let d = a.querySelector('.dot');
    if (!n) { if (d) d.remove(); return; }
    if (!d) { d = document.createElement('b'); d.className = 'dot'; a.appendChild(d); }
    d.textContent = n > 9 ? '9+' : n;
  }

  function toast(msg, isErr) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
  }

  function modal({ title, body, actions = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${title ? `<h2>${esc(title)}</h2>` : ''}<div class="modal-body">${body || ''}</div><div class="acts">${actions.map((a, i) => `<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div>`;
      document.body.appendChild(back);
      hydrate(back);
      const close = (v) => { back.classList.add('out'); setTimeout(() => back.remove(), 200); resolve(v); };
      back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
      back.addEventListener('click', async (e) => {
        const b = e.target.closest('.acts [data-i]');
        if (!b) return;
        const a = actions[+b.dataset.i];
        if (a.validate) { const ok = await a.validate(back); if (!ok) return; }
        close(typeof a.value === 'function' ? a.value(back) : a.value);
      });
      back.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = actions.findIndex((a) => a.primary); if (p >= 0) back.querySelector(`[data-i="${p}"]`).click(); }
      });
      if (onOpen) onOpen(back);
      const f = back.querySelector('input, textarea, select');
      setTimeout(() => (f || back.querySelector('.btn.primary') || back.querySelector('.btn')).focus(), 50);
    });
  }

  function confirm(title, text, { danger = false, ok = 'Confirmer' } = {}) {
    return modal({ title, body: `<p class="muted">${esc(text)}</p>`, actions: [{ label: 'Annuler', value: false }, { label: ok, value: true, primary: !danger, danger }] });
  }

  function prompt(title, { label = '', value = '', type = 'text', placeholder = '' } = {}) {
    return modal({
      title,
      body: `${label ? `<label class="lbl">${esc(label)}</label>` : ''}<input class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}">`,
      actions: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: (m) => m.querySelector('input').value }]
    });
  }

  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  function timeAgo(ts) {
    const d = (ts - Date.now()) / 1000;
    const a = Math.abs(d);
    if (a < 60) return 'à l\'instant';
    if (a < 3600) return rtf.format(Math.round(d / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(d / 3600), 'hour');
    if (a < 86400 * 7) return rtf.format(Math.round(d / 86400), 'day');
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDate(ts, withTime = true) {
    return new Date(ts).toLocaleString('fr-FR', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtBytes(n) { const u = ['o', 'Ko', 'Mo', 'Go']; let i = 0; n = n || 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
  function favicon(url, size = 18) {
    const h = hostOf(url);
    if (String(url).startsWith('gip:')) return '<span class="grad" style="font-weight:900">G</span>';
    if (!h) return ico('globe', size);
    const letter = esc(h[0].toUpperCase());
    return `<img src="https://${esc(h)}/favicon.ico" width="${size}" height="${size}" alt="" data-letter="${letter}" loading="lazy">`;
  }
  // Remplace les favicons introuvables par une lettre
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.letter) { const s = document.createElement('span'); s.textContent = img.dataset.letter; img.replaceWith(s); }
  }, true);

  function lockedScreen(msg) {
    document.body.innerHTML = `<div class="locked"><div><div class="empty"><div class="big">${ico('lock', 38)}</div><h2>Fonction indisponible</h2><p>${esc(msg)}</p><a class="btn primary" href="gip://home">Retour à l'accueil</a></div></div></div>`;
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  function countUp(el, target, ms = 900) {
    const t0 = performance.now();
    const fmt = new Intl.NumberFormat('fr-FR');
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); el.textContent = fmt.format(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  window.G = { call, on: (c, f) => api && api.on(c, f), boot, shell, toast, modal, confirm, prompt, esc, $, $$, ico, hydrate, timeAgo, fmtDate, fmtBytes, hostOf, favicon, lockedScreen, debounce, countUp, SERVICES, applyTheme };
})();
