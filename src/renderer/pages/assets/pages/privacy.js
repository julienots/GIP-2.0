'use strict';
(async () => {
  const { call, esc, ico, $, $$, countUp } = G;
  document.title = 'Bouclier Gip — Confidentialité';
  await G.boot();
  let data;
  try { data = await call('privacy.stats'); } catch (e) { return G.lockedScreen(e.message); }
  const info = await call('app.info');
  const page = G.shell('privacy', { title: 'Bouclier Gip', subtitle: 'Votre vie privée, protégée par défaut' });

  const st = data.stats;
  const s = data.settings;
  const score = ['blockAds', 'blockTrackers', 'httpsOnly', 'blockThirdPartyCookies', 'fingerprintProtection', 'sendGPC', 'stripTrackingParams'].filter((k) => s[k]).length;
  const pct = Math.round(score / 7 * 100);

  page.insertAdjacentHTML('beforeend', `
    <div class="grid" style="grid-template-columns:minmax(260px,320px) 1fr;gap:16px;align-items:start" id="top">
      <div class="card" style="text-align:center;animation:rise .6s var(--spring) both">
        <svg viewBox="0 0 120 120" width="180" height="180" style="display:block;margin:6px auto">
          <defs><linearGradient id="sg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ee59d"/><stop offset="1" stop-color="#00c2ff"/></linearGradient></defs>
          <circle cx="60" cy="60" r="50" fill="none" stroke="var(--field)" stroke-width="10"/>
          <circle id="arc" cx="60" cy="60" r="50" fill="none" stroke="url(#sg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="314" stroke-dashoffset="314" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 1.4s cubic-bezier(.2,.9,.25,1)"/>
          <text x="60" y="58" text-anchor="middle" font-size="26" font-weight="800" fill="currentColor" id="pct">0%</text>
          <text x="60" y="76" text-anchor="middle" font-size="9" fill="var(--muted)">niveau de protection</text>
        </svg>
        <b>${pct >= 85 ? 'Protection maximale 🛡️' : pct >= 55 ? 'Bonne protection' : 'Protection réduite'}</b>
        <p class="muted small">${info.adRules + info.trackerRules} règles de blocage intégrées · aucune télémétrie</p>
      </div>
      <div class="grid c3 stagger" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        ${[['blockedTotal', 'Pubs & traqueurs bloqués', 'shield', '#7c5cff'], ['upgradedTotal', 'Connexions passées en HTTPS', 'lock', '#2ee59d'], ['cookiesBlockedTotal', 'Cookies tiers bloqués', 'cookie', '#ffb547'], ['paramsStripped', 'Liens nettoyés du pistage', 'sparkle', '#00c2ff']].map(([k, l, i, c]) => `<div class="card"><div style="color:${c}">${ico(i, 22)}</div><b style="font-size:30px;display:block;margin-top:6px" data-n="${st[k] || 0}">0</b><span class="muted small">${l}</span></div>`).join('')}
        <div class="card"><div style="color:#ff5c8a">${ico('fingerprint', 22)}</div><b style="font-size:18px;display:block;margin-top:10px">${s.fingerprintProtection ? 'Actif' : 'Inactif'}</b><span class="muted small">Anti-empreinte (canvas, WebGL, audio)</span></div>
        <div class="card"><div style="color:#a259ff">${ico('mask', 22)}</div><b style="font-size:18px;display:block;margin-top:10px">${s.sendGPC ? 'Envoyé' : 'Désactivé'}</b><span class="muted small">Global Privacy Control & Do Not Track</span></div>
      </div>
    </div>

    <div class="grid c2" style="margin-top:16px">
      <div class="card"><h2>Protections</h2>
        ${[['blockAds', 'Bloquer les publicités', 'Supprime les bannières et régies publicitaires'], ['blockTrackers', 'Bloquer les traqueurs', 'Analytics, pixels, profilage inter-sites'], ['blockThirdPartyCookies', 'Bloquer les cookies tiers', 'Empêche le suivi d\'un site à l\'autre'], ['httpsOnly', 'HTTPS partout', 'Force les connexions chiffrées'], ['fingerprintProtection', 'Anti-empreinte numérique', 'Brouille canvas, WebGL, audio, matériel'], ['stripTrackingParams', 'Nettoyer les liens', 'Retire utm_*, fbclid, gclid…'], ['sendGPC', 'Global Privacy Control', 'Signale votre refus de la revente des données']].map(([k, t, d]) => `<div class="setting"><div class="txt"><b>${t}</b><span>${d}</span></div><button class="switch ${s[k] ? 'on' : ''}" data-k="${k}"></button></div>`).join('')}
      </div>
      <div>
        <div class="card"><h2>Effacer les données de navigation</h2>
          ${[['history', 'Historique de navigation', true], ['cookies', 'Cookies (vous serez déconnecté des sites)', true], ['cache', 'Images et fichiers en cache', true], ['storage', 'Stockage des sites (localStorage, IndexedDB…)', false], ['downloads', 'Liste des téléchargements', false], ['permissions', 'Autorisations des sites', false]].map(([k, l, on]) => `<label class="setting" style="cursor:pointer"><div class="txt"><b style="font-weight:500">${l}</b></div><input type="checkbox" data-c="${k}" ${on ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"></label>`).join('')}
          <button class="btn danger" id="clear" style="margin-top:12px;width:100%">${ico('trash', 16)} Effacer maintenant</button>
        </div>
        <div class="card" style="margin-top:16px"><h2>Autorisations des sites</h2><div id="perms"></div></div>
      </div>
    </div>`);

  requestAnimationFrame(() => {
    $('#arc').style.strokeDashoffset = String(314 * (1 - pct / 100));
    countUp($('#pct'), pct, 1400);
    const t = $('#pct'); const obs = new MutationObserver(() => { if (!t.textContent.endsWith('%')) t.textContent += '%'; }); obs.observe(t, { childList: true, characterData: true, subtree: true });
    $$('[data-n]').forEach((el) => countUp(el, +el.dataset.n, 1300));
  });

  function renderPerms() {
    const p = data.sitePermissions || {};
    const keys = Object.keys(p);
    const L = { media: 'Caméra/micro', geolocation: 'Position', notifications: 'Notifications', 'clipboard-read': 'Presse-papiers', 'display-capture': 'Partage d\'écran', midi: 'MIDI' };
    $('#perms').innerHTML = keys.length ? keys.map((o) => `<div class="list-item"><div class="fav">${G.favicon(o)}</div><div class="main"><b>${esc(o)}</b><span>${Object.entries(p[o]).map(([k, v]) => `${L[k] || k} : ${v === 'allow' ? '✅' : '⛔'}`).join(' · ')}</span></div><button class="icon-btn danger" data-o="${esc(o)}" title="Réinitialiser">${ico('trash', 16)}</button></div>`).join('') : '<p class="muted small">Aucune autorisation enregistrée.</p>';
  }
  renderPerms();

  $$('.switch[data-k]').forEach((sw) => sw.onclick = async () => {
    sw.classList.toggle('on');
    await call('settings.set', { [sw.dataset.k]: sw.classList.contains('on') });
    G.toast('Protection mise à jour');
  });
  $('#clear').onclick = async () => {
    const types = $$('[data-c]').filter((c) => c.checked).map((c) => c.dataset.c);
    if (!types.length) return;
    if (!await G.confirm('Effacer les données ?', 'Les éléments sélectionnés seront supprimés définitivement.', { danger: true, ok: 'Effacer' })) return;
    await call('privacy.clear', { types });
    G.toast('🧹 Données effacées');
  };
  $('#perms').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    const sp = { ...data.sitePermissions }; delete sp[b.dataset.o];
    await call('settings.set', { sitePermissions: sp });
    data.sitePermissions = sp; renderPerms();
  });
})();
