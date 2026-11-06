'use strict';
(async () => {
  const { call, esc, ico, $, $$ } = G;
  const settings = (await G.boot()) || {};
  document.body.insertAdjacentHTML('afterbegin', '<div class="bg-blobs"><i></i><i></i><i></i></div>');
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').trim();
  const TYPES = ['web', 'images', 'videos', 'news'];
  const type = TYPES.includes(params.get('type')) ? params.get('type') : 'web';
  let safe = ['strict', 'moderate', 'off'].includes(params.get('safe')) ? params.get('safe') : (settings.safeSearch || 'moderate');
  const useProxy = settings.imageProxy !== false;
  const px = (u) => (u && useProxy && /^https?:/.test(u) ? 'gip://img/?u=' + encodeURIComponent(u) : u || '');
  let pageNo = 0;
  const TITLES = { web: 'Gip Search', images: 'Gip Images', videos: 'Gip Vidéos', news: 'Gip Actualités' };
  document.title = q ? q + ' — ' + TITLES[type] : TITLES[type];
  const engines = await call('search.engines').catch(() => ({}));
  const SAFE_LABEL = { strict: 'Strict', moderate: 'Modéré', off: 'Désactivé' };

  const link = (t, extra = {}) => {
    const p = new URLSearchParams({ q, ...(t !== 'web' ? { type: t } : {}), ...extra });
    if (params.get('safe')) p.set('safe', safe);
    return 'gip://search?' + p.toString();
  };
  const page = $('#page');
  page.innerHTML = `<div class="sbar"><a class="lg" href="gip://search${type !== 'web' ? '?type=' + type : ''}"><span class="grad">Gip</span> ${type === 'images' ? 'Images' : type === 'videos' ? 'Vidéos' : type === 'news' ? 'Actualités' : 'Search'}</a>
    <form id="f"><input id="q" value="${esc(q)}" placeholder="${type === 'images' ? 'Rechercher des images, photos, fonds d\'écran…' : 'Rechercher en privé…'}" autocomplete="off"><button class="go">${ico('search', 18)}</button></form>
    <div class="safe-pick" title="Filtre de contenu (SafeSearch)">${ico('shield', 15)}<select id="safe">${Object.entries(SAFE_LABEL).map(([k, l]) => `<option value="${k}" ${k === safe ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${q ? `<nav class="tabs">
      <a class="${type === 'web' ? 'on' : ''}" href="${link('web')}">${ico('globe', 14)} Web</a>
      <a class="${type === 'images' ? 'on' : ''}" href="${link('images')}">${ico('images', 14)} Images</a>
      <a class="${type === 'videos' ? 'on' : ''}" href="${link('videos')}">${ico('video', 14)} Vidéos</a>
      <a class="${type === 'news' ? 'on' : ''}" href="${link('news')}">${ico('news', 14)} Actualités</a>
      <a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}">Cartes</a>
      <a href="https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}">Wikipédia</a>
      <a href="gip://ai?q=${encodeURIComponent(q)}" class="ai-link">${ico('sparkle', 14)} Demander à Gip IA</a></nav>` : ''}
    <div id="body"></div>`;
  $('#f').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#q').value.trim(); if (v) location.href = 'gip://search?' + new URLSearchParams({ q: v, ...(type !== 'web' ? { type } : {}) }).toString(); });
  $('#safe').addEventListener('change', async (e) => {
    safe = e.target.value;
    try { await call('settings.set', { safeSearch: safe }); } catch {}
    const p = new URLSearchParams(location.search); p.delete('safe'); location.search = p.toString();
  });

  if (!q) {
    const t = TITLES[type].split(' ');
    $('#body').innerHTML = `<div class="landing"><div><h1><span class="grad">${t[0]}</span> ${t.slice(1).join(' ')}</h1><p class="muted">${type === 'images' ? 'Photos, illustrations et fonds d\'écran de tout le web : DuckDuckGo, Bing, Openverse et Wikimedia Commons réunis, sans pistage.' : 'Vos recherches passent par un proxy Gip : sans cookies, sans historique, sans profil publicitaire.'}</p>
      <div class="landing-tabs">${TYPES.map((k) => `<a class="btn sm ${k === type ? 'primary' : ''}" href="gip://search${k !== 'web' ? '?type=' + k : ''}">${TITLES[k]}</a>`).join('')}</div></div></div>`;
    $('#q').focus();
    return;
  }

  function fallbackLinks() {
    const e = encodeURIComponent(q);
    const kp = safe === 'off' ? '-2' : safe === 'strict' ? '1' : '-1';
    const adlt = safe === 'off' ? 'off' : safe === 'strict' ? 'strict' : 'moderate';
    const map = {
      web: [['DuckDuckGo', `https://duckduckgo.com/?kp=${kp}&q=${e}`], ['Brave', `https://search.brave.com/search?q=${e}`], ['Startpage', `https://www.startpage.com/do/search?q=${e}`]],
      images: [['DuckDuckGo Images', `https://duckduckgo.com/?ia=images&iax=images&kp=${kp}&q=${e}`], ['Bing Images', `https://www.bing.com/images/search?adlt=${adlt}&q=${e}`], ['Google Images', `https://www.google.com/search?tbm=isch&safe=${safe === 'off' ? 'off' : 'active'}&q=${e}`], ['Openverse', `https://openverse.org/search/image?q=${e}`], ['Wikimedia Commons', `https://commons.wikimedia.org/w/index.php?search=${e}&title=Special:MediaSearch&type=image`], ['Unsplash', `https://unsplash.com/s/photos/${e}`], ['Pexels', `https://www.pexels.com/search/${e}/`], ['Flickr', `https://www.flickr.com/search/?text=${e}`]],
      videos: [['DuckDuckGo Vidéos', `https://duckduckgo.com/?ia=videos&iax=videos&kp=${kp}&q=${e}`], ['YouTube', `https://www.youtube.com/results?search_query=${e}`], ['PeerTube', `https://sepiasearch.org/search?search=${e}`], ['Vimeo', `https://vimeo.com/search?q=${e}`]],
      news: [['DuckDuckGo Actualités', `https://duckduckgo.com/?ia=news&iar=news&kp=${kp}&q=${e}`], ['Google Actualités', `https://news.google.com/search?q=${e}&hl=fr`], ['Bing Actualités', `https://www.bing.com/news/search?q=${e}`]]
    };
    return `<div class="ext">${map[type].map(([n, u]) => `<a class="btn sm" href="${u}">${esc(n)}</a>`).join('')}</div>`;
  }

  /* ======================= Réponses instantanées ======================= */
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


  /* ============================== Web ============================== */
  async function runWeb() {
    $('#body').innerHTML = `<div class="sres"><div id="results">${'<div class="skeleton skel"></div>'.repeat(5)}</div>
      <aside class="side"><div class="card"><h2>${ico('shield', 18)} Recherche privée</h2>
        <div class="priv">${ico('check', 16)}<span>Aucun cookie ni identifiant envoyé</span></div>
        <div class="priv">${ico('check', 16)}<span>Requête relayée par Gip — votre profil reste chez vous</span></div>
        <div class="priv">${ico('check', 16)}<span>Annonces et liens sponsorisés retirés</span></div>
        <div class="priv">${ico('filter', 16)}<span>Filtre de contenu : <b>${SAFE_LABEL[safe]}</b></span></div>
        <div class="muted small" style="margin-top:10px">Rechercher aussi sur :</div>
        <div class="ext">${Object.entries(engines).filter(([k]) => k !== 'gip').map(([k, n]) => `<button class="btn sm" data-eng="${k}">${esc(n)}</button>`).join('')}</div>
      </div></aside></div>`;
    $('.side .ext').addEventListener('click', async (e) => { const b = e.target.closest('[data-eng]'); if (b) location.href = await call('search.external', { engine: b.dataset.eng, q }); });

    async function load() {
      const box = $('#results');
      const t0 = performance.now();
      try {
        const r = await call('search.query', { q, page: pageNo, safe });
        const ms = Math.round(performance.now() - t0);
        const ans = pageNo === 0 ? instantAnswer() : '';
        const html = r.results.map((x, i) => `<div class="res" style="animation-delay:${i * 0.035}s"><div class="h"><span class="f"><img src="https://${esc(x.host)}/favicon.ico" alt="" data-letter="${esc((x.host[0] || '•').toUpperCase())}"></span><span>${esc(x.host)}</span></div><a class="t" href="${esc(x.url)}">${esc(x.title)}</a>${x.snippet ? `<p>${esc(x.snippet)}</p>` : ''}</div>`).join('');
        if (pageNo === 0) {
          box.innerHTML = ans + `<div class="meta">${ico('shield', 14)} ${r.results.length} résultats privés · ${ms} ms</div><div id="istrip"></div>` + (html || `<div class="empty"><div class="big">${ico('search', 36)}</div><h3>Aucun résultat</h3><p>Essayez d'autres mots-clés ou un autre moteur à droite.</p></div>`);
          imageStrip();
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
        box.innerHTML = instantAnswer() + `<div class="empty"><div class="big">${ico('globe', 36)}</div><h3>Recherche indisponible</h3><p>${esc(e.message)}<br>Vérifiez votre connexion internet ou utilisez un autre moteur.</p>${fallbackLinks()}</div>`;
      }
    }
    async function imageStrip() {
      try {
        const r = await call('search.images', { q, safe, sources: ['ddg', 'bing'] });
        const list = r.results.slice(0, 8);
        if (!list.length) return;
        $('#istrip').innerHTML = `<div class="istrip"><a class="ih" href="${link('images')}">${ico('images', 15)} Images pour « ${esc(q)} » <span>Tout voir →</span></a><div class="row-imgs">${list.map((x) => `<a href="${link('images')}"><img src="${esc(px(x.thumb))}" alt="${esc(x.title)}" loading="lazy"></a>`).join('')}</div></div>`;
      } catch {}
    }
    load();
  }

  /* ============================== Images ============================== */
  async function runImages() {
    const F = { size: params.get('size') || '', color: params.get('color') || '', type: params.get('itype') || '', layout: params.get('layout') || '', license: params.get('license') || '' };
    const source = params.get('src') || 'all';
    const opt = (name, key, list) => `<label class="fsel"><span>${name}</span><select data-f="${key}">${list.map(([v, l]) => `<option value="${v}" ${F[key] === v || (key === 'src' && source === v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    $('#body').innerHTML = `<div class="ibar">
      ${opt('Source', 'src', [['all', 'Toutes les sources'], ['ddg', 'DuckDuckGo'], ['bing', 'Bing'], ['openverse', 'Openverse (libres)'], ['commons', 'Wikimedia Commons']])}
      ${opt('Taille', 'size', [['', 'Toutes'], ['small', 'Petite'], ['medium', 'Moyenne'], ['large', 'Grande'], ['wallpaper', 'Fond d\'écran']])}
      ${opt('Couleur', 'color', [['', 'Toutes'], ['color', 'Couleur'], ['mono', 'Noir et blanc'], ['red', 'Rouge'], ['orange', 'Orange'], ['yellow', 'Jaune'], ['green', 'Vert'], ['teal', 'Turquoise'], ['blue', 'Bleu'], ['purple', 'Violet'], ['pink', 'Rose'], ['brown', 'Marron'], ['black', 'Noir'], ['gray', 'Gris'], ['white', 'Blanc']])}
      ${opt('Type', 'type', [['', 'Tous'], ['photo', 'Photo'], ['clipart', 'Illustration'], ['gif', 'Animation (GIF)'], ['transparent', 'Transparent'], ['line', 'Dessin au trait']])}
      ${opt('Format', 'layout', [['', 'Tous'], ['square', 'Carré'], ['wide', 'Paysage'], ['tall', 'Portrait']])}
      ${opt('Licence', 'license', [['', 'Toutes'], ['any', 'Creative Commons'], ['public', 'Domaine public'], ['share', 'Partage autorisé'], ['modify', 'Modification autorisée'], ['commercial', 'Usage commercial']])}
      <span class="spacer"></span><span class="imeta" id="imeta"></span>
      <button class="btn sm" id="dlall" title="Télécharger toutes les images affichées">${ico('download', 15)} Tout télécharger</button>
    </div>
    <div id="srcstat" class="srcstat"></div>
    <div class="igrid" id="grid">${'<div class="skeleton iskel"></div>'.repeat(18)}</div>
    <div id="sentinel" class="sentinel"></div>`;
    $('.ibar').addEventListener('change', (e) => {
      const s = e.target.closest('select[data-f]'); if (!s) return;
      const p = new URLSearchParams(location.search);
      const k = s.dataset.f === 'type' ? 'itype' : s.dataset.f;
      if (s.value && s.value !== 'all') p.set(k, s.value); else p.delete(k);
      location.search = p.toString();
    });

    const all = [];
    let loading = false, done = false;
    const grid = $('#grid');
    async function load() {
      if (loading || done) return;
      loading = true;
      try {
        const r = await call('search.images', { q, page: pageNo, safe, filters: F, sources: [source] });
        if (pageNo === 0) grid.innerHTML = '';
        const start = all.length;
        all.push(...r.results.filter((x) => !all.some((y) => y.image === x.image)));
        const fresh = all.slice(start);
        grid.insertAdjacentHTML('beforeend', fresh.map((x, i) => {
          const ratio = x.width && x.height ? Math.max(0.4, Math.min(2.5, x.height / x.width)) : 0.75;
          return `<figure class="itile" data-i="${start + i}" style="animation-delay:${(i % 30) * 0.02}s"><div class="ibox" style="padding-top:${(ratio * 100).toFixed(1)}%"><img src="${esc(px(x.thumb))}" data-raw="${esc(x.thumb)}" alt="${esc(x.title)}" loading="lazy"></div>
            <figcaption><span class="it">${esc(x.title || x.source)}</span><span class="is">${esc(x.source)}${x.width ? ` · ${x.width}×${x.height}` : ''}</span></figcaption></figure>`;
        }).join(''));
        const st = Object.entries(r.sources || {});
        $('#srcstat').innerHTML = st.map(([k, s]) => `<span class="chip ${s.ok ? 'ok' : 'ko'}" title="${esc(s.ok ? s.count + ' résultats' : s.error)}">${s.ok ? ico('check', 12) : ico('warn', 12)} ${esc(s.name)}${s.ok ? ' · ' + s.count : ''}</span>`).join('') + `<span class="chip">${ico('filter', 12)} Filtre : ${SAFE_LABEL[safe]}</span>`;
        $('#imeta').textContent = all.length + ' images';
        if (!fresh.length) done = true;
        if (!all.length) grid.innerHTML = `<div class="empty" style="column-span:all"><div class="big">${ico('images', 36)}</div><h3>Aucune image</h3><p>Essayez d'autres mots-clés, retirez des filtres ou ouvrez une autre source :</p>${fallbackLinks()}</div>`;
        pageNo++;
      } catch (e) {
        if (pageNo === 0) grid.innerHTML = `<div class="empty" style="column-span:all"><div class="big">${ico('globe', 36)}</div><h3>Recherche d'images indisponible</h3><p>${esc(e.message)}</p>${fallbackLinks()}</div>`;
        done = true;
      }
      loading = false;
    }
    // Image introuvable via le relais → essai direct, sinon masquée
    grid.addEventListener('error', (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG') return;
      if (img.dataset.raw && img.src !== img.dataset.raw) { img.src = img.dataset.raw; return; }
      img.closest('.itile')?.classList.add('broken');
    }, true);
    grid.addEventListener('click', (e) => { const t = e.target.closest('.itile'); if (t) G.lightbox(all, +t.dataset.i, { px }); });
    new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) load(); }, { rootMargin: '1200px' }).observe($('#sentinel'));
    $('#dlall').onclick = async () => {
      const n = all.length;
      if (!n) return;
      if (!(await G.confirm('Tout télécharger', `Télécharger les ${n} images affichées dans votre dossier Téléchargements ?`, { ok: 'Télécharger' }))) return;
      const c = await call('download.many', all.map((x) => x.image));
      G.toast(c + ' téléchargements lancés');
    };
    load();
  }

  /* ============================== Vidéos ============================== */
  async function runVideos() {
    $('#body').innerHTML = `<div class="vgrid" id="vgrid">${'<div class="skeleton vskel"></div>'.repeat(12)}</div><div class="more"><button class="btn hidden" id="more">Plus de vidéos</button></div>`;
    const grid = $('#vgrid');
    async function load() {
      try {
        const r = await call('search.videos', { q, page: pageNo, safe });
        if (pageNo === 0) grid.innerHTML = '';
        grid.insertAdjacentHTML('beforeend', r.results.map((v, i) => `<a class="vcard" href="${esc(v.url)}" style="animation-delay:${(i % 20) * 0.03}s">
          <div class="vthumb">${v.thumb ? `<img src="${esc(px(v.thumb))}" data-raw="${esc(v.thumb)}" alt="" loading="lazy">` : ''}${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}<span class="play">${ico('video', 22)}</span></div>
          <div class="vt">${esc(v.title)}</div>
          <div class="vs muted small">${esc(v.publisher || '')}${v.uploader ? ' · ' + esc(v.uploader) : ''}${v.published ? ' · ' + esc(new Date(v.published).toLocaleDateString('fr-FR')) : ''}${v.views ? ' · ' + new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v.views) + ' vues' : ''}</div></a>`).join(''));
        if (!grid.children.length) grid.innerHTML = `<div class="empty"><h3>Aucune vidéo</h3>${fallbackLinks()}</div>`;
        $('#more').classList.toggle('hidden', r.results.length < 20);
        $('#more').disabled = false;
        pageNo++;
      } catch (e) {
        if (pageNo === 0) grid.innerHTML = `<div class="empty"><div class="big">${ico('video', 36)}</div><h3>Recherche de vidéos indisponible</h3><p>${esc(e.message)}</p>${fallbackLinks()}</div>`;
      }
    }
    grid.addEventListener('error', (e) => { const img = e.target; if (img.tagName === 'IMG' && img.dataset.raw && img.src !== img.dataset.raw) img.src = img.dataset.raw; }, true);
    $('#more').onclick = () => { $('#more').disabled = true; load(); };
    load();
  }

  /* ============================== Actualités ============================== */
  async function runNews() {
    $('#body').innerHTML = `<div class="nlist" id="nlist">${'<div class="skeleton skel"></div>'.repeat(6)}</div><div class="more"><button class="btn hidden" id="more">Plus d'articles</button></div>`;
    const box = $('#nlist');
    async function load() {
      try {
        const r = await call('search.news', { q, page: pageNo, safe });
        if (pageNo === 0) box.innerHTML = '';
        box.insertAdjacentHTML('beforeend', r.results.map((n, i) => `<a class="ncard" href="${esc(n.url)}" style="animation-delay:${(i % 20) * 0.03}s">
          <div class="nt"><div class="muted small">${esc(n.source)}${n.date ? ' · ' + G.timeAgo(n.date) : ''}</div><h3>${esc(n.title)}</h3><p>${esc(n.excerpt)}</p></div>
          ${n.image ? `<img src="${esc(px(n.image))}" data-raw="${esc(n.image)}" alt="" loading="lazy">` : ''}</a>`).join(''));
        if (!box.children.length) box.innerHTML = `<div class="empty"><h3>Aucun article</h3>${fallbackLinks()}</div>`;
        $('#more').classList.toggle('hidden', r.results.length < 15);
        $('#more').disabled = false;
        pageNo++;
      } catch (e) {
        if (pageNo === 0) box.innerHTML = `<div class="empty"><div class="big">${ico('news', 36)}</div><h3>Actualités indisponibles</h3><p>${esc(e.message)}</p>${fallbackLinks()}</div>`;
      }
    }
    box.addEventListener('error', (e) => { const img = e.target; if (img.tagName === 'IMG') { if (img.dataset.raw && img.src !== img.dataset.raw) img.src = img.dataset.raw; else img.remove(); } }, true);
    $('#more').onclick = () => { $('#more').disabled = true; load(); };
    load();
  }

  ({ web: runWeb, images: runImages, videos: runVideos, news: runNews })[type]();
})();
