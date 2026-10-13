'use strict';
(async () => {
  const { call, esc, ico, $ } = G;
  document.title = 'Favoris — Gip';
  await G.boot();
  let list;
  try { list = await call('bookmarks.list'); } catch (e) { return G.lockedScreen(e.message); }
  const page = G.shell('bookmarks', { title: 'Favoris', subtitle: 'Glissez pour réorganiser', actions: `<div class="search-field" style="width:240px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher"></div><button class="btn primary" id="add">${ico('plus', 16)} Ajouter</button>` });
  page.insertAdjacentHTML('beforeend', '<div class="card" style="padding:8px" id="list"></div>');
  let drag = null;

  function render() {
    const s = $('#s').value.toLowerCase();
    const items = list.filter((b) => !s || (b.title + b.url).toLowerCase().includes(s));
    $('#list').innerHTML = items.length ? items.map((b, i) => `<div class="list-item" draggable="${!s}" data-id="${esc(b.id)}" style="animation:rise .35s var(--spring) both ${Math.min(i, 20) * 0.025}s"><span class="muted" style="cursor:grab">⋮⋮</span><div class="fav">${b.favicon ? `<img src="${esc(b.favicon)}" data-letter="${esc((G.hostOf(b.url)[0] || '•').toUpperCase())}">` : G.favicon(b.url)}</div>
      <a class="main" href="${esc(b.url)}" style="color:inherit;text-decoration:none"><span class="t">${esc(b.title)}</span><span>${esc(b.url)}</span></a>
      <div class="acts"><button class="icon-btn" data-edit="${esc(b.id)}" title="Modifier">${ico('edit', 16)}</button><button class="icon-btn danger" data-del="${esc(b.id)}" title="Supprimer">${ico('trash', 16)}</button></div></div>`).join('')
      : `<div class="empty"><div class="big">${ico('star', 38)}</div><h3>Aucun favori</h3><p>Cliquez sur ★ dans la barre d'adresse ou faites Ctrl+D.</p></div>`;
  }

  async function edit(b) {
    const r = await G.modal({
      title: b ? 'Modifier le favori' : 'Nouveau favori',
      body: `<label class="lbl">Nom</label><input class="input" id="t" value="${esc(b ? b.title : '')}"><label class="lbl">Adresse</label><input class="input" id="u" value="${esc(b ? b.url : 'https://')}">`,
      actions: [{ label: 'Annuler', value: null }, { label: 'Enregistrer', primary: true, value: (m) => ({ title: m.querySelector('#t').value, url: m.querySelector('#u').value }) }]
    });
    if (!r || !r.url) return;
    list = b ? await call('bookmarks.update', { id: b.id, ...r }) : await call('bookmarks.add', r);
    render();
  }

  $('#s').addEventListener('input', render);
  $('#add').onclick = () => edit(null);
  $('#list').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]'); if (d) { list = await call('bookmarks.remove', d.dataset.del); G.toast('Favori supprimé'); render(); return; }
    const ed = e.target.closest('[data-edit]'); if (ed) edit(list.find((b) => b.id === ed.dataset.edit));
  });
  $('#list').addEventListener('dragstart', (e) => { const r = e.target.closest('.list-item'); if (r) { drag = r.dataset.id; r.style.opacity = '.4'; } });
  $('#list').addEventListener('dragend', (e) => { const r = e.target.closest('.list-item'); if (r) r.style.opacity = ''; });
  $('#list').addEventListener('dragover', (e) => e.preventDefault());
  $('#list').addEventListener('drop', async (e) => {
    e.preventDefault();
    const r = e.target.closest('.list-item'); if (!r || !drag || r.dataset.id === drag) return;
    list = await call('bookmarks.move', { id: drag, to: list.findIndex((b) => b.id === r.dataset.id) });
    render();
  });
  G.on('bookmarks:changed', (b) => { list = b; render(); });
  render();
})();
