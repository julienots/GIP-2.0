'use strict';
(async () => {
  const { call, esc, ico, $, timeAgo } = G;
  document.title = 'Gip Notes';
  await G.boot();
  let notes;
  try { notes = await call('notes.list'); } catch (e) { return G.lockedScreen(e.message); }
  const page = G.shell('notes', { title: 'Gip Notes', subtitle: 'Vos idées, chiffrées avec votre mot de passe', actions: `<div class="search-field" style="width:240px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher"></div><button class="btn primary" id="new">${ico('plus', 16)} Nouvelle note</button>` });
  page.insertAdjacentHTML('beforeend', '<div class="notes" id="list"></div>');
  const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#8a8fa3'];

  function render() {
    const s = $('#s').value.toLowerCase();
    const list = notes.filter((n) => !s || (n.title + ' ' + n.body).toLowerCase().includes(s)).sort((a, b) => (b.pinned - a.pinned) || (b.date - a.date));
    $('#list').innerHTML = list.length ? list.map((n, i) => `<div class="note" data-id="${esc(n.id)}" style="--c:${esc(n.color)};animation-delay:${Math.min(i, 15) * 0.035}s">${n.pinned ? `<span class="pin">${ico('pin', 16)}</span>` : ''}<h3>${esc(n.title || 'Sans titre')}</h3><p>${esc(n.body)}</p><div class="d">${timeAgo(n.date)}</div></div>`).join('')
      : `<div class="empty" style="column-span:all"><div class="big">${ico('note', 38)}</div><h3>${s ? 'Aucune note trouvée' : 'Aucune note'}</h3><p>Créez votre première note chiffrée.</p></div>`;
  }

  async function edit(note) {
    const n = note ? { ...note } : { title: '', body: '', color: COLORS[0], pinned: false };
    const r = await G.modal({
      wide: true,
      body: `<input class="ed-title" id="t" placeholder="Titre" value="${esc(n.title)}"><textarea class="ed-body" id="b" placeholder="Écrivez quelque chose…">${esc(n.body)}</textarea>
        <div class="row"><div class="editor-colors" id="cols">${COLORS.map((c) => `<button style="background:${c};color:${c}" data-c="${c}" class="${c === n.color ? 'on' : ''}"></button>`).join('')}</div><div class="spacer"></div>
        <button class="btn sm" id="pin">${ico('pin', 14)} ${n.pinned ? 'Désépingler' : 'Épingler'}</button></div>`,
      onOpen(m) {
        m.querySelector('#cols').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; n.color = b.dataset.c; m.querySelectorAll('#cols button').forEach((x) => x.classList.toggle('on', x === b)); });
        m.querySelector('#pin').onclick = (e) => { n.pinned = !n.pinned; e.currentTarget.lastChild.textContent = ' ' + (n.pinned ? 'Désépingler' : 'Épingler'); };
      },
      actions: [
        ...(note ? [{ label: 'Supprimer', danger: true, value: 'delete' }] : []),
        { label: 'Fermer', value: null },
        { label: 'Enregistrer', primary: true, value: (m) => ({ ...n, title: m.querySelector('#t').value, body: m.querySelector('#b').value }) }
      ]
    });
    if (r === 'delete') { await call('notes.delete', note.id); notes = notes.filter((x) => x.id !== note.id); G.toast('Note supprimée'); }
    else if (r) {
      const saved = await call('notes.save', r);
      notes = notes.filter((x) => x.id !== saved.id); notes.unshift(saved);
      G.toast('Note enregistrée 🔒');
    }
    render();
  }

  $('#new').onclick = () => edit(null);
  $('#s').addEventListener('input', G.debounce(render, 100));
  $('#list').addEventListener('click', (e) => { const c = e.target.closest('.note'); if (c) edit(notes.find((n) => n.id === c.dataset.id)); });
  render();
})();
