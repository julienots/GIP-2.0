'use strict';
(async () => {
  const { esc, ico, $, call } = G;
  await G.boot().catch(() => {});
  document.body.insertAdjacentHTML('afterbegin', '<div class="bg-blobs"><i></i><i></i><i></i></div>');
  const p = new URLSearchParams(location.search);
  const code = +p.get('code');
  const url = p.get('url') || '';
  const desc = p.get('desc') || '';
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  document.title = host || 'Erreur';

  const KNOWN = {
    '-105': ['🔍', 'Site introuvable', `Impossible de trouver l'adresse IP du serveur de ${host}. Vérifiez l'orthographe de l'adresse.`],
    '-106': ['📡', 'Pas de connexion internet', 'Vérifiez votre câble réseau, votre Wi-Fi ou votre modem.'],
    '-102': ['🚫', 'Connexion refusée', `${host} a refusé la connexion.`],
    '-118': ['⏳', 'Délai dépassé', `${host} met trop de temps à répondre.`],
    '-109': ['🛰️', 'Adresse inaccessible', `${host} est inaccessible.`],
    '-7': ['⏳', 'Délai dépassé', `${host} met trop de temps à répondre.`],
    '-20': ['🛡️', 'Bloqué par le Bouclier Gip', 'Cette page a été bloquée pour protéger votre vie privée.'],
    '-21': ['🔄', 'Réseau modifié', 'Votre connexion réseau a changé.']
  };
  let [emoji, title, text] = KNOWN[String(code)] || ['😕', 'Cette page ne s\'affiche pas', `${host || 'Le site'} ne répond pas correctement.`];
  const isSsl = code <= -200 && code > -300 || /SSL|CERT/i.test(desc);
  const httpsUpgrade = url.startsWith('https:') && (isSsl || code === -102 || code === -109 || code === -118 || code === -7 || code === -100 || code === -101 || code === -111 || code === -15);
  if (isSsl) { emoji = '🔐'; title = 'Connexion non sécurisée'; text = `Le certificat de ${host} n'est pas valide. Des pirates pourraient tenter d'intercepter vos informations.`; }

  $('#page').innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:20px">
    <div style="max-width:560px;animation:rise .6s var(--spring) both">
      <div style="font-size:72px;animation:floaty 3s ease-in-out infinite;display:inline-block">${emoji}</div>
      <h1 style="font-size:30px;margin:14px 0 8px">${esc(title)}</h1>
      <p class="muted" style="font-size:15px">${esc(text)}</p>
      <p class="muted small mono" style="margin-top:14px">${esc(desc || 'ERR')} (${code})</p>
      ${httpsUpgrade ? `<div class="card" style="margin-top:18px"><b>${ico('lock', 16)} HTTPS partout est actif</b><p class="muted small">Ce site ne prend peut-être pas en charge les connexions chiffrées. Vous pouvez continuer en HTTP non sécurisé.</p><button class="btn" id="http">${ico('warn', 16)} Continuer en HTTP (non sécurisé)</button></div>` : ''}
      <div class="row" style="margin-top:22px;gap:8px"><button class="btn primary" id="retry">${ico('reload', 16)} Réessayer</button><a class="btn" href="gip://home">Accueil</a>
      ${host ? `<a class="btn" href="gip://search?q=${encodeURIComponent(host)}">${ico('search', 16)} Rechercher</a>` : ''}</div>
    </div></div>`;
  $('#retry').onclick = () => { if (url) location.href = url; else history.back(); };
  const h = $('#http');
  if (h) h.onclick = async () => { await call('privacy.allowHttp', host).catch(() => {}); location.href = url.replace(/^https:/, 'http:'); };
})();
