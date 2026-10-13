'use strict';
(async () => {
  const { call, esc, ico, $, fmtBytes, timeAgo } = G;
  document.title = 'Téléchargements — Gip';
  await G.boot();
  let list;
  try { list = await call('downloads.list'); } catch (e) { return G.lockedScreen(e.message); }
  const live = new Map();
  const page = G.shell('downloads', { title: 'Téléchargements', subtitle: 'Fichiers enregistrés dans votre dossier Téléchargements', icon: 'download', color: '#3fb6a8', actions: `<div class="search-field" style="width:240px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher"></div><button class="btn" id="clear">${ico('trash', 16)} Vider la liste</button>` });
  page.insertAdjacentHTML('beforeend', '<div class="card" style="padding:8px" id="list"></div>');

  function render() {
    const s = $('#s').value.toLowerCase();
    const all = [...live.values(), ...list.filter((d) => !live.has(d.id))].filter((d) => !s || d.name.toLowerCase().includes(s));
    $('#list').innerHTML = all.length ? all.map((d, i) => {
      const prog = d.state === 'progressing';
      const pct = d.total ? Math.round(d.received / d.total * 100) : 0;
      return `<div class="list-item" data-id="${esc(d.id)}" style="animation:rise .35s var(--spring) both ${Math.min(i, 20) * 0.025}s"><div class="fav" style="color:#3fb6a8">${ico('file', 18)}</div>
        <div class="main"><b>${esc(d.name)}</b><span>${prog ? `${fmtBytes(d.received)} / ${fmtBytes(d.total)} — ${pct}%` : d.state === 'completed' ? `${fmtBytes(d.total || d.received)} · ${timeAgo(d.date)}` : d.state === 'cancelled' ? 'Annulé' : 'Échec'} · ${esc(G.hostOf(d.url))}</span>
        ${prog ? `<div style="height:4px;border-radius:2px;background:var(--field);margin-top:6px"><i style="display:block;height:100%;width:${pct}%;background:var(--grad);border-radius:2px;transition:width .3s"></i></div>` : ''}</div>
        <div class="acts" style="opacity:1">${d.state === 'completed' ? `<button class="btn sm" data-a="open">Ouvrir</button><button class="icon-btn" data-a="show" title="Afficher dans le dossier">${ico('folder', 16)}</button><button class="icon-btn danger" data-a="remove" title="Retirer de la liste">${ico('x', 16)}</button>` : ''}</div></div>`;
    }).join('') : `<div class="empty"><div class="big">${ico('download', 38)}</div><h3>Aucun téléchargement</h3></div>`;
  }

  $('#s').addEventListener('input', render);
  $('#clear').onclick = async () => { await call('downloads.clear'); list = []; render(); };
  $('#list').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    const id = a.closest('[data-id]').dataset.id;
    const ok = await call('downloads.action', { id, action: a.dataset.a });
    if (a.dataset.a === 'remove') { list = list.filter((d) => d.id !== id); render(); }
    else if (!ok) G.toast('Fichier introuvable (déplacé ou supprimé ?)', true);
  });
  G.on('download:update', (d) => {
    if (d.state === 'progressing') live.set(d.id, d);
    else { live.delete(d.id); if (!d.private) { list = [d, ...list.filter((x) => x.id !== d.id)]; } }
    render();
  });
  render();
})();
