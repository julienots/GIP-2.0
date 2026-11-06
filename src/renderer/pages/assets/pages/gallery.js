'use strict';
(async () => {
  const { call, esc, ico, $, $$ } = G;
  const settings = (await G.boot()) || {};
  document.body.insertAdjacentHTML('afterbegin', '<div class="bg-blobs"><i></i><i></i><i></i></div>');
  const id = new URLSearchParams(location.search).get('id');
  const data = id ? await call('gallery.get', id).catch(() => null) : null;
  const page = $('#page');
  if (!data) {
    page.innerHTML = `<div class="landing"><div class="empty"><div class="big">${ico('images', 40)}</div><h2>Galerie expirée</h2><p>Ouvrez une page web puis choisissez « Toutes les images de la page » dans le menu (Ctrl+Maj+G).</p></div></div>`;
    return;
  }
  const host = G.hostOf(data.url);
  document.title = 'Images — ' + (data.title || host);
  const src = data.images.map((x) => ({
    image: x.url, thumb: x.url, title: x.alt || decodeURIComponent((x.url.split('/').pop() || '').split('?')[0]).slice(0, 100),
    page: data.url, width: x.width, height: x.height, source: host, provider: 'Page · ' + x.kind, kind: x.kind
  }));
  const kinds = [...new Set(src.map((x) => x.kind))];
  page.innerHTML = `<div class="sbar"><a class="lg" href="gip://search?type=images"><span class="grad">Gip</span> Galerie</a>
      <div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(data.title || host)}</b><a class="small" href="${esc(data.url)}">${esc(data.url)}</a></div></div>
    <div class="ibar">
      <label class="fsel"><span>Taille min.</span><select id="min"><option value="0">Toutes</option><option value="100">100 px</option><option value="300" selected>300 px</option><option value="800">800 px</option></select></label>
      <label class="fsel"><span>Origine</span><select id="kind"><option value="">Toutes</option>${kinds.map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>
      <label class="fsel"><span>Tri</span><select id="sort"><option value="page">Ordre de la page</option><option value="big">Plus grandes d'abord</option></select></label>
      <span class="spacer"></span><span class="imeta" id="imeta"></span>
      <button class="btn sm" id="sel">${ico('check', 15)} Sélection</button>
      <button class="btn sm primary" id="dl">${ico('download', 15)} Tout télécharger</button>
    </div>
    <div class="igrid" id="grid"></div>`;

  let shown = [];
  let selecting = false;
  const picked = new Set();
  // Les dimensions inconnues sont mesurées au chargement de la vignette.
  function render() {
    const min = +$('#min').value; const kind = $('#kind').value; const sort = $('#sort').value;
    shown = src.filter((x) => (!kind || x.kind === kind) && (!(x.width && x.height) || Math.max(x.width, x.height) >= min));
    if (sort === 'big') shown = [...shown].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    $('#grid').innerHTML = shown.map((x, i) => {
      const ratio = x.width && x.height ? Math.max(0.4, Math.min(2.5, x.height / x.width)) : 0.75;
      return `<figure class="itile ${picked.has(x.image) ? 'picked' : ''}" data-i="${i}"><div class="ibox" style="padding-top:${(ratio * 100).toFixed(1)}%"><img src="${esc(x.thumb)}" alt="" loading="lazy"></div>
        <figcaption><span class="it">${esc(x.title || 'Image')}</span><span class="is">${x.width ? `${x.width}×${x.height} · ` : ''}${esc(x.kind)}</span></figcaption><span class="tick">${ico('check', 14)}</span></figure>`;
    }).join('') || `<div class="empty" style="column-span:all"><h3>Aucune image</h3><p>Réduisez la taille minimale.</p></div>`;
    $('#imeta').textContent = shown.length + ' / ' + src.length + ' images' + (picked.size ? ` · ${picked.size} sélectionnée(s)` : '');
    $('#dl').innerHTML = `${ico('download', 15)} ${picked.size ? `Télécharger la sélection (${picked.size})` : 'Tout télécharger'}`;
  }
  $('#grid').addEventListener('load', (e) => {
    const img = e.target; if (img.tagName !== 'IMG') return;
    const t = img.closest('.itile'); const x = shown[+t.dataset.i];
    if (x && !x.width && img.naturalWidth) {
      x.width = img.naturalWidth; x.height = img.naturalHeight;
      t.querySelector('.is').textContent = `${x.width}×${x.height} · ${x.kind}`;
      if (Math.max(x.width, x.height) < +$('#min').value) t.classList.add('broken');
    }
  }, true);
  $('#grid').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.closest('.itile')?.classList.add('broken'); }, true);
  $('#grid').addEventListener('click', (e) => {
    const t = e.target.closest('.itile'); if (!t) return;
    const x = shown[+t.dataset.i];
    if (selecting) { picked.has(x.image) ? picked.delete(x.image) : picked.add(x.image); t.classList.toggle('picked'); $('#imeta').textContent = `${shown.length} / ${src.length} images · ${picked.size} sélectionnée(s)`; $('#dl').innerHTML = `${ico('download', 15)} ${picked.size ? `Télécharger la sélection (${picked.size})` : 'Tout télécharger'}`; return; }
    G.lightbox(shown, +t.dataset.i);
  });
  $('#sel').onclick = () => { selecting = !selecting; $('#sel').classList.toggle('primary', selecting); document.body.classList.toggle('selecting', selecting); if (!selecting) { picked.clear(); render(); } };
  for (const s of ['#min', '#kind', '#sort']) $(s).onchange = render;
  $('#dl').onclick = async () => {
    const list = picked.size ? [...picked] : shown.map((x) => x.image);
    const urls = list.filter((u) => /^https?:/.test(u));
    if (!urls.length) return G.toast('Rien à télécharger');
    if (urls.length > 10 && !(await G.confirm('Télécharger', `Télécharger ${urls.length} images dans votre dossier Téléchargements ?`, { ok: 'Télécharger' }))) return;
    G.toast((await call('download.many', urls)) + ' téléchargements lancés');
  };
  render();
})();
