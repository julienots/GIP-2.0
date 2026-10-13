'use strict';
(async () => {
  const { call, esc, ico, $ } = G;
  document.title = 'Historique — Gip';
  await G.boot();
  let res;
  try { res = await call('history.list', { limit: 500 }); } catch (e) { return G.lockedScreen(e.message); }
  const page = G.shell('history', { title: 'Historique', subtitle: 'Stocké uniquement sur cet appareil, chiffré', actions: `<div class="search-field" style="width:260px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher dans l'historique"></div><button class="btn danger" id="clear">${ico('trash', 16)} Effacer…</button>` });
  page.insertAdjacentHTML('beforeend', '<div class="card" style="padding:8px 8px 16px" id="list"></div>');

  function dayLabel(ts) {
    const d = new Date(ts); const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((t - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    if (diff === 0) return 'Aujourd\'hui';
    if (diff === 1) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: diff > 300 ? 'numeric' : undefined });
  }

  function render() {
    const items = res.items;
    if (!items.length) { $('#list').innerHTML = `<div class="empty"><div class="big">${ico('history', 38)}</div><h3>Aucun historique</h3><p>Les pages visitées apparaîtront ici.</p></div>`; return; }
    let html = '', last = '';
    items.forEach((h, i) => {
      const lbl = dayLabel(h.date);
      if (lbl !== last) { html += `<div class="group-title">${esc(lbl)}</div>`; last = lbl; }
      html += `<div class="list-item" data-id="${esc(h.id)}" style="animation:rise .35s var(--spring) both ${Math.min(i, 20) * 0.015}s"><span class="muted small mono" style="width:44px">${new Date(h.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span><div class="fav">${h.favicon ? `<img src="${esc(h.favicon)}" data-letter="${esc((G.hostOf(h.url)[0] || '•').toUpperCase())}">` : G.favicon(h.url)}</div>
        <a class="main" href="${esc(h.url)}" style="color:inherit;text-decoration:none"><span class="t">${esc(h.title || h.url)}</span><span>${esc(h.url)}</span></a>
        <div class="acts"><button class="icon-btn danger" data-del="${esc(h.id)}" title="Supprimer">${ico('x', 16)}</button></div></div>`;
    });
    if (res.total > items.length) html += `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="more">Afficher plus (${res.total - items.length})</button></div>`;
    $('#list').innerHTML = html;
  }

  async function load(more) {
    const q = $('#s').value;
    const r = await call('history.list', { q, limit: 500, offset: more ? res.items.length : 0 });
    res = more ? { total: r.total, items: res.items.concat(r.items) } : r;
    render();
  }

  $('#s').addEventListener('input', G.debounce(() => load(false), 150));
  $('#list').addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) { await call('history.delete', d.dataset.del); const row = d.closest('.list-item'); row.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(30px)' }], { duration: 220 }).onfinish = () => { res.items = res.items.filter((x) => x.id !== d.dataset.del); render(); }; }
    if (e.target.closest('#more')) load(true);
  });
  $('#clear').onclick = async () => {
    const r = await G.modal({
      title: 'Effacer l\'historique',
      body: '<label class="lbl">Période</label><select class="select" id="p"><option value="3600000">Dernière heure</option><option value="86400000">Dernières 24 heures</option><option value="604800000">7 derniers jours</option><option value="0" selected>Tout l\'historique</option></select>',
      actions: [{ label: 'Annuler', value: null }, { label: 'Effacer', danger: true, value: (m) => +m.querySelector('#p').value }]
    });
    if (r === null || r === undefined) return;
    await call('history.clear', { since: r ? Date.now() - r : 0 });
    G.toast('Historique effacé');
    load(false);
  };
  render();
})();
