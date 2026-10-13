'use strict';
(async () => {
  const { call, esc, ico, $ } = G;
  document.title = 'À propos de Gip 2.0';
  await G.boot();
  const i = await call('app.info');
  const page = G.shell('about');
  page.innerHTML = `<div style="text-align:center;padding:40px 0 20px">
      <div style="width:110px;height:110px;border-radius:34px;margin:0 auto 22px;background:var(--grad);display:grid;place-items:center;color:#fff;font-size:58px;font-weight:900;box-shadow:0 30px 60px -20px var(--accent);animation:popIn .9s var(--spring) both">G</div>
      <h1 style="font-size:46px">Gip <span class="grad">2.0</span></h1>
      <p class="muted" style="font-size:16px">Le navigateur libre, privé et chiffré.</p>
      <span class="pill ok">${ico('check', 14)} Gip est à jour — version ${esc(i.version)}</span>
    </div>
    <div class="grid c3 stagger" style="margin-top:20px">
      <div class="card"><div style="color:#7c5cff">${ico('shield', 24)}</div><h2 style="margin-top:8px">Bouclier intégré</h2><p class="muted small">${i.adRules} règles anti-pub, ${i.trackerRules} règles anti-traqueurs, HTTPS forcé, cookies tiers bloqués, anti-empreinte.</p></div>
      <div class="card"><div style="color:#2ee59d">${ico('lock', 24)}</div><h2 style="margin-top:8px">Comptes chiffrés</h2><p class="muted small">Chaque compte est chiffré en AES-256-GCM avec une clé dérivée de votre mot de passe. Aucun serveur, aucune télémétrie.</p></div>
      <div class="card"><div style="color:#ff5c8a">${ico('sparkle', 24)}</div><h2 style="margin-top:8px">Services Gip</h2><p class="muted small">Search, Mail (E2E), Notes, Coffre-fort, Drive, Agenda — tous internes et privés.</p></div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Informations techniques</h2>
      ${[['Version de Gip', i.version], ['Moteur Chromium', i.chrome], ['Electron', i.electron], ['Node.js', i.node], ['V8', i.v8], ['Système', i.platform + ' / ' + i.arch]].map(([k, v]) => `<div class="setting" style="padding:9px 0"><div class="txt">${k}</div><span class="mono muted">${esc(v)}</span></div>`).join('')}
    </div>
    <p class="muted small" style="text-align:center;margin-top:24px">Fait avec ❤️ · Licence MIT</p>`;
})();
