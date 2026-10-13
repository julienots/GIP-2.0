'use strict';
(async () => {
  const { call, esc, ico, $ } = G;
  document.title = 'Gip Agenda';
  await G.boot();
  let events;
  try { events = await call('agenda.list'); } catch (e) { return G.lockedScreen(e.message); }
  const page = G.shell('agenda', { title: 'Gip Agenda', subtitle: 'Votre emploi du temps, chiffré', actions: `<button class="btn primary" id="new">${ico('plus', 16)} Événement</button>` });
  page.insertAdjacentHTML('beforeend', `<div class="card"><div class="cal-head"><button class="icon-btn" id="prev">${ico('back', 18)}</button><h2 id="month"></h2><button class="icon-btn" id="next">${ico('forward', 18)}</button><div class="spacer"></div><button class="btn sm" id="today">Aujourd'hui</button></div><div class="cal" id="cal"></div></div>`);
  const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45'];
  let cursor = new Date(); cursor.setDate(1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function render() {
    $('#month').textContent = cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const start = new Date(cursor);
    const dow = (start.getDay() + 6) % 7;
    start.setDate(1 - dow);
    const today = iso(new Date());
    let html = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = iso(d);
      const evs = events.filter((e) => e.date === k).sort((a, b) => a.time.localeCompare(b.time));
      html += `<div class="day ${d.getMonth() !== cursor.getMonth() ? 'other' : ''} ${k === today ? 'today' : ''}" data-d="${k}" style="animation-delay:${i * 0.008}s"><span class="n">${d.getDate()}</span>${evs.map((e) => `<div class="ev" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.time)} ${esc(e.title)}</div>`).join('')}</div>`;
    }
    $('#cal').innerHTML = html;
  }

  async function edit(ev, date) {
    const e = ev ? { ...ev } : { title: '', date: date || iso(new Date()), time: '', notes: '', color: COLORS[0] };
    const r = await G.modal({
      title: ev ? 'Modifier l\'événement' : 'Nouvel événement',
      body: `<label class="lbl">Titre</label><input class="input" id="t" value="${esc(e.title)}" placeholder="Réunion, anniversaire…">
        <div class="row"><div style="flex:1"><label class="lbl">Date</label><input class="input" type="date" id="d" value="${esc(e.date)}"></div><div style="flex:1"><label class="lbl">Heure</label><input class="input" type="time" id="h" value="${esc(e.time)}"></div></div>
        <label class="lbl">Notes</label><textarea class="textarea" id="n" style="min-height:70px">${esc(e.notes)}</textarea>
        <div class="row" style="margin-top:12px" id="cols">${COLORS.map((c) => `<button style="width:26px;height:26px;border-radius:50%;background:${c};${c === e.color ? 'box-shadow:0 0 0 3px var(--pop),0 0 0 5px ' + c : ''}" data-c="${c}"></button>`).join('')}</div>`,
      onOpen(m) { m.querySelector('#cols').addEventListener('click', (x) => { const b = x.target.closest('[data-c]'); if (!b) return; e.color = b.dataset.c; m.querySelectorAll('#cols button').forEach((y) => { y.style.boxShadow = y === b ? `0 0 0 3px var(--pop),0 0 0 5px ${y.dataset.c}` : ''; }); }); },
      actions: [...(ev ? [{ label: 'Supprimer', danger: true, value: 'delete' }] : []), { label: 'Annuler', value: null }, { label: 'Enregistrer', primary: true, value: (m) => ({ id: e.id, title: m.querySelector('#t').value, date: m.querySelector('#d').value, time: m.querySelector('#h').value, notes: m.querySelector('#n').value, color: e.color }) }]
    });
    if (r === 'delete') { await call('agenda.delete', ev.id); events = events.filter((x) => x.id !== ev.id); }
    else if (r) { const s = await call('agenda.save', r); events = events.filter((x) => x.id !== s.id); events.push(s); G.toast('Événement enregistré'); }
    render();
  }

  $('#prev').onclick = () => { cursor.setMonth(cursor.getMonth() - 1); render(); };
  $('#next').onclick = () => { cursor.setMonth(cursor.getMonth() + 1); render(); };
  $('#today').onclick = () => { cursor = new Date(); cursor.setDate(1); render(); };
  $('#new').onclick = () => edit(null);
  $('#cal').addEventListener('click', (e) => {
    const ev = e.target.closest('.ev');
    if (ev) return edit(events.find((x) => x.id === ev.dataset.id));
    const d = e.target.closest('.day');
    if (d) edit(null, d.dataset.d);
  });
  render();
})();
