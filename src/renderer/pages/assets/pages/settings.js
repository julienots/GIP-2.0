'use strict';
(async () => {
  const { call, esc, ico, $, $$ } = G;
  document.title = 'Paramètres — Gip';
  let s;
  try { s = await G.boot(); if (!s) throw new Error('Gip est verrouillé'); } catch (e) { return G.lockedScreen(e.message); }
  const engines = await call('search.engines');
  const page = G.shell('settings', { title: 'Paramètres', subtitle: 'Personnalisez Gip 2.0', icon: 'settings', color: '#5b6488' });
  const ACCENTS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#a259ff', '#4d7cff'];
  const WALLS = [['aurora', 'Aurore', '#7c5cff,#00c2ff'], ['sunset', 'Coucher de soleil', '#ff7a45,#ff5c8a'], ['ocean', 'Océan', '#0066ff,#00e5c3'], ['forest', 'Forêt', '#1f9d55,#9be15d'], ['minimal', 'Minimal', 'var(--card2),var(--card2)']];

  const sw = (k, t, d) => `<div class="setting"><div class="txt"><b>${t}</b><span>${d}</span></div><button class="switch ${s[k] ? 'on' : ''}" data-k="${k}"></button></div>`;
  page.insertAdjacentHTML('beforeend', `<div class="grid c2 stagger">
    <div class="card"><h2>${ico('sun', 18)} Apparence</h2>
      <div class="setting"><div class="txt"><b>Thème</b><span>Clair, sombre ou selon le système</span></div>
        <select class="select" id="theme" style="width:160px"><option value="dark">Sombre</option><option value="light">Clair</option><option value="system">Système</option></select></div>
      <div class="setting"><div class="txt"><b>Couleur d'accent</b><span>Utilisée dans toute l'interface</span></div>
        <div class="row" id="accents">${ACCENTS.map((c) => `<button data-c="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};transition:transform .2s var(--spring);${c === s.accent ? `transform:scale(1.25);box-shadow:0 0 0 2px var(--bg),0 0 0 4px ${c}` : ''}"></button>`).join('')}</div></div>
      <div class="setting" style="display:block"><div class="txt"><b>Fond de la page d'accueil</b></div>
        <div class="row" id="walls" style="margin-top:10px;flex-wrap:wrap">${WALLS.map(([k, l, g]) => `<button data-w="${k}" style="width:92px;height:60px;border-radius:12px;background:linear-gradient(135deg,${g});position:relative;transition:transform .25s var(--spring);${s.wallpaper === k ? 'box-shadow:0 0 0 3px var(--accent);transform:scale(1.05)' : ''}"><span style="position:absolute;bottom:4px;left:6px;font-size:11px;color:#fff;text-shadow:0 1px 4px #000">${l}</span></button>`).join('')}</div></div>
      ${sw('animations', 'Animations', 'Transitions et effets fluides')}
      ${sw('showBookmarksBar', 'Barre de favoris', 'Afficher sous la barre d\'adresse')}
    </div>
    <div class="card" id="search"><h2>${ico('search', 18)} Recherche & démarrage</h2>
      <div class="setting"><div class="txt"><b>Moteur de recherche</b><span>Gip Search protège vos requêtes par un proxy</span></div>
        <select class="select" id="engine" style="width:180px">${Object.entries(engines).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select></div>
      <div class="setting"><div class="txt"><b>Page d'accueil</b><span>Page ouverte au démarrage et dans les nouveaux onglets</span></div>
        <input class="input" id="homepage" style="width:220px" value="${esc(s.homepage)}"></div>
      ${sw('saveHistory', 'Enregistrer l\'historique', 'Stocké chiffré sur cet appareil uniquement')}
      ${sw('clearOnExit', 'Tout effacer à la fermeture', 'Historique, cookies et cache supprimés en quittant')}
    </div>
    <div class="card"><h2>${ico('shield', 18)} Confidentialité</h2>
      ${sw('blockAds', 'Bloquer les publicités', 'Bouclier Gip')}
      ${sw('blockTrackers', 'Bloquer les traqueurs', 'Bouclier Gip')}
      ${sw('blockThirdPartyCookies', 'Bloquer les cookies tiers', 'Recommandé')}
      ${sw('httpsOnly', 'HTTPS partout', 'Recommandé')}
      <a class="btn" href="gip://privacy" style="margin-top:12px">${ico('shield', 16)} Tableau de bord complet</a>
    </div>
    <div class="card"><h2>${ico('info', 18)} Raccourcis clavier</h2>
      ${[['Ctrl+T', 'Nouvel onglet'], ['Ctrl+Maj+T', 'Rouvrir l\'onglet fermé'], ['Ctrl+Maj+N', 'Fenêtre privée'], ['Ctrl+L', 'Barre d\'adresse'], ['Ctrl+F', 'Rechercher dans la page'], ['Ctrl+D', 'Ajouter aux favoris'], ['Ctrl+H / J', 'Historique / Téléchargements'], ['Ctrl+Tab', 'Onglet suivant'], ['Ctrl+1…9', 'Aller à l\'onglet'], ['Ctrl + / − / 0', 'Zoom'], ['F11 / F12', 'Plein écran / Outils dev']].map(([k, l]) => `<div class="setting" style="padding:8px 0"><div class="txt">${l}</div><span class="pill mono">${k}</span></div>`).join('')}
    </div>
  </div>`);

  $('#theme').value = s.theme;
  $('#engine').value = s.searchEngine;
  const set = async (patch, msg = 'Paramètre enregistré') => { s = await call('settings.set', patch); G.applyTheme(s); G.toast(msg); };
  $$('.switch[data-k]').forEach((b) => b.onclick = () => { b.classList.toggle('on'); set({ [b.dataset.k]: b.classList.contains('on') }); });
  $('#theme').onchange = (e) => set({ theme: e.target.value }, 'Thème appliqué');
  $('#engine').onchange = (e) => set({ searchEngine: e.target.value }, 'Moteur : ' + engines[e.target.value]);
  $('#homepage').onchange = (e) => { let v = e.target.value.trim() || 'gip://home'; if (!/^[a-z]+:/i.test(v)) v = 'https://' + v; e.target.value = v; set({ homepage: v }); };
  $('#accents').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    $$('#accents button').forEach((x) => { x.style.transform = ''; x.style.boxShadow = ''; });
    b.style.transform = 'scale(1.25)'; b.style.boxShadow = `0 0 0 2px var(--bg),0 0 0 4px ${b.dataset.c}`;
    set({ accent: b.dataset.c }, 'Couleur appliquée');
  });
  $('#walls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    $$('#walls button').forEach((x) => { x.style.boxShadow = ''; x.style.transform = ''; });
    b.style.boxShadow = '0 0 0 3px var(--accent)'; b.style.transform = 'scale(1.05)';
    set({ wallpaper: b.dataset.w }, 'Fond d\'accueil changé');
  });
  if (location.hash) setTimeout(() => { const el = document.querySelector(location.hash); if (el) { el.scrollIntoView({ behavior: 'smooth' }); el.animate([{ boxShadow: '0 0 0 3px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600 }); } }, 300);
})();
