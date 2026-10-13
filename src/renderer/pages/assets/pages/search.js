'use strict';
(async () => {
  const { call, esc, ico, $, hostOf } = G;
  await G.boot();
  document.body.insertAdjacentHTML('afterbegin', '<div class="bg-blobs"><i></i><i></i><i></i></div>');
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').trim();
  let pageNo = 0;
  document.title = q ? q + ' — Gip Search' : 'Gip Search';
  const engines = await call('search.engines').catch(() => ({}));

  const page = $('#page');
  page.innerHTML = `<div class="sbar"><a class="lg" href="gip://search"><span class="grad">Gip</span> Search</a>
    <form id="f"><input id="q" value="${esc(q)}" placeholder="Rechercher en privé…" autocomplete="off"><button class="go">${ico('search', 18)}</button></form></div>
    ${q ? `<nav class="tabs"><a class="on" href="#">${'Web'}</a><a href="https://duckduckgo.com/?ia=images&iax=images&q=${encodeURIComponent(q)}">Images</a><a href="https://duckduckgo.com/?ia=news&iar=news&q=${encodeURIComponent(q)}">Actualités</a><a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}">Cartes</a><a href="https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}">Wikipédia</a></nav>` : ''}
    <div id="body"></div>`;
  $('#f').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#q').value.trim(); if (v) location.href = 'gip://search?q=' + encodeURIComponent(v); });

  if (!q) {
    $('#body').innerHTML = `<div class="landing"><div><h1><span class="grad">Gip</span> Search</h1><p class="muted">Vos recherches passent par un proxy Gip : sans cookies, sans historique, sans profil publicitaire.</p></div></div>`;
    $('#q').focus();
    return;
  }

  $('#body').innerHTML = `<div class="sres"><div id="results">${'<div class="skeleton skel"></div>'.repeat(5)}</div>
    <aside class="side"><div class="card"><h2>${ico('shield', 18)} Recherche privée</h2>
      <div class="priv">${ico('check', 16)}<span>Aucun cookie ni identifiant envoyé</span></div>
      <div class="priv">${ico('check', 16)}<span>Requête relayée par Gip — votre profil reste chez vous</span></div>
      <div class="priv">${ico('check', 16)}<span>Annonces et liens sponsorisés retirés</span></div>
      <div class="muted small" style="margin-top:10px">Rechercher aussi sur :</div>
      <div class="ext">${Object.entries(engines).filter(([k]) => k !== 'gip').map(([k, n]) => `<button class="btn sm" data-eng="${k}">${esc(n)}</button>`).join('')}</div>
    </div></aside></div>`;

  $('.ext').addEventListener('click', async (e) => { const b = e.target.closest('[data-eng]'); if (b) location.href = await call('search.external', { engine: b.dataset.eng, q }); });

  function instantAnswer() {
    // Calculatrice
    if (/^[\d\s+\-*/().,%^]+$/.test(q) && /\d/.test(q) && /[+\-*/^%]/.test(q)) {
      try {
        const expr = q.replace(/,/g, '.').replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
        if (/^[\d\s+\-*/().]+$/.test(expr.replace(/\*\*/g, '*'))) {
          const v = safeEval(expr);
          if (Number.isFinite(v)) return `<div class="answer"><div class="muted small">${esc(q)} =</div><div class="big">${esc(+v.toPrecision(12))}</div></div>`;
        }
      } catch {}
    }
    // Conversion °C/°F
    let m = q.match(/^(-?\d+(?:[.,]\d+)?)\s*°?\s*(c|f)\b/i);
    if (m) {
      const n = parseFloat(m[1].replace(',', '.'));
      const r = m[2].toLowerCase() === 'c' ? `${+(n * 9 / 5 + 32).toFixed(2)} °F` : `${+((n - 32) * 5 / 9).toFixed(2)} °C`;
      return `<div class="answer"><div class="muted small">${esc(q)}</div><div class="big">${esc(r)}</div></div>`;
    }
    // Mot de passe
    if (/^(mot de passe|password|générer mot de passe)$/i.test(q)) return '<div class="answer" id="pw"><div class="muted small">Mot de passe généré localement</div><div class="big mono" id="pwv">…</div></div>';
    // Heure
    if (/^(heure|quelle heure|time)$/i.test(q)) return `<div class="answer"><div class="muted small">Heure locale</div><div class="big">${new Date().toLocaleTimeString('fr-FR')}</div></div>`;
    return '';
  }

  // Évaluateur arithmétique sûr (pas de eval)
  function safeEval(s) {
    const toks = s.match(/\d+(?:\.\d+)?|\*\*|[+\-*/()]/g) || [];
    let i = 0;
    const peek = () => toks[i];
    const next = () => toks[i++];
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(); const r = term(); v = o === '+' ? v + r : v - r; } return v; }
    function term() { let v = pow(); while (peek() === '*' || peek() === '/') { const o = next(); const r = pow(); v = o === '*' ? v * r : v / r; } return v; }
    function pow() { const b = unary(); if (peek() === '**') { next(); return Math.pow(b, pow()); } return b; }
    function unary() { if (peek() === '-') { next(); return -unary(); } if (peek() === '+') { next(); return unary(); } return prim(); }
    function prim() { const t = next(); if (t === '(') { const v = expr(); next(); return v; } const n = parseFloat(t); if (Number.isNaN(n)) throw new Error('bad'); return n; }
    const v = expr();
    if (i !== toks.length) throw new Error('bad');
    return v;
  }

  async function load() {
    const box = $('#results');
    const t0 = performance.now();
    try {
      const r = await call('search.query', { q, page: pageNo });
      const ms = Math.round(performance.now() - t0);
      const ans = pageNo === 0 ? instantAnswer() : '';
      const html = r.results.map((x, i) => `<div class="res" style="animation-delay:${i * 0.035}s"><div class="h"><span class="f"><img src="https://${esc(x.host)}/favicon.ico" alt="" data-letter="${esc((x.host[0] || '•').toUpperCase())}"></span><span>${esc(x.host)}</span></div><a class="t" href="${esc(x.url)}">${esc(x.title)}</a>${x.snippet ? `<p>${esc(x.snippet)}</p>` : ''}</div>`).join('');
      if (pageNo === 0) {
        box.innerHTML = ans + `<div class="meta">${ico('shield', 14)} ${r.results.length} résultats privés · ${ms} ms</div>` + (html || `<div class="empty"><div class="big">${ico('search', 36)}</div><h3>Aucun résultat</h3><p>Essayez d'autres mots-clés ou un autre moteur à droite.</p></div>`);
      } else {
        box.querySelector('.more')?.remove();
        box.insertAdjacentHTML('beforeend', html);
      }
      if (r.results.length >= 10) {
        box.insertAdjacentHTML('beforeend', '<div class="more"><button class="btn" id="more">Plus de résultats</button></div>');
        $('#more').onclick = () => { pageNo++; $('#more').disabled = true; load(); };
      }
      const pw = $('#pwv');
      if (pw) pw.textContent = await call('vault.generate', { length: 20 });
    } catch (e) {
      box.innerHTML = instantAnswer() + `<div class="empty"><div class="big">${ico('globe', 36)}</div><h3>Recherche indisponible</h3><p>${esc(e.message)}<br>Vérifiez votre connexion internet ou utilisez un autre moteur.</p></div>`;
    }
  }
  load();
})();
