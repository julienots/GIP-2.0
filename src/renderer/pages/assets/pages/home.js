'use strict';
(async () => {
  const { call, esc, ico, $, $$, hostOf, countUp } = G;
  document.title = 'Nouvel onglet';
  const settings = await G.boot();
  let data;
  try { data = await call('home.summary'); } catch (e) { data = null; }

  const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#a259ff', '#4d7cff', '#3fb6a8'];
  const colorFor = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return COLORS[Math.abs(h) % COLORS.length]; };

  const wall = (settings && settings.wallpaper) || 'aurora';
  document.body.insertAdjacentHTML('afterbegin', `<div class="wall ${esc(wall)}"><div class="stars"></div><i></i><i></i><i></i></div>`);
  const page = $('#page');
  const name = data ? data.account.name : '';
  const engine = (settings && settings.searchEngine) || 'gip';
  const engines = await call('search.engines').catch(() => ({ gip: 'Gip Search' }));

  page.innerHTML = `<div class="home">
    <div class="hero">
      <div class="brand"><span class="lg">G</span>Gip <span class="grad">2.0</span></div>
      <div class="clock" id="clock"></div>
      <div class="greet" id="greet"></div>
    </div>
    <div class="hsearch">
      <form id="sf" autocomplete="off">
        ${ico('search', 20)}
        <input id="q" placeholder="Rechercher sur le web en toute confidentialité…" autofocus>
        <span class="engine" id="engine" title="Moteur de recherche">${esc(engines[engine] || 'Gip Search')}</span>
        <button class="go" type="submit" title="Rechercher">${ico('forward', 20)}</button>
      </form>
      <div class="hsug hidden" id="sug"></div>
    </div>
    <div class="svcs">${G.SERVICES.slice(0, 7).map((s) => `<a href="${s.url}" style="--c:${s.c}"><span class="s">${ico(s.icon, 15)}</span>${s.name.replace('Gip ', '')}</a>`).join('')}</div>
    <div class="dial" id="dial"></div>
    <div class="widgets" id="widgets"></div>
    <div class="foot">🔒 Chiffré de bout en bout sur cet appareil · Aucune télémétrie <a href="gip://settings">Personnaliser</a></div>
  </div>`;

  /* Horloge */
  function tick() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0'), m = String(d.getMinutes()).padStart(2, '0');
    $('#clock').innerHTML = `<b>${h}</b><span class="colon">:</span>${m}`;
    const hr = d.getHours();
    const hello = hr < 5 ? 'Bonne nuit' : hr < 12 ? 'Bonjour' : hr < 18 ? 'Bon après-midi' : 'Bonsoir';
    $('#greet').innerHTML = `${hello}${name ? `, <b>${esc(name)}</b>` : ''} · ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  }
  tick();
  setInterval(tick, 1000);

  /* Recherche */
  async function go(q) {
    q = q.trim();
    if (!q) return;
    if (/^(https?|gip):/i.test(q)) location.href = q;
    else if (!/\s/.test(q) && /^[^\s/]+\.[a-z]{2,}(\/.*)?$/i.test(q)) location.href = 'https://' + q;
    else if (engine === 'gip') location.href = 'gip://search?q=' + encodeURIComponent(q);
    else location.href = await call('search.external', { engine, q });
  }
  const q = $('#q');
  let sel = -1, items = [];
  $('#sf').addEventListener('submit', (e) => { e.preventDefault(); go(sel >= 0 ? items[sel] : q.value); });
  q.addEventListener('input', G.debounce(async () => {
    const v = q.value.trim();
    if (!v) { $('#sug').classList.add('hidden'); return; }
    items = await call('search.suggest', v).catch(() => []);
    sel = -1;
    renderSug();
  }, 120));
  function renderSug() {
    const box = $('#sug');
    if (!items.length) { box.classList.add('hidden'); return; }
    box.innerHTML = items.map((s, i) => `<div data-i="${i}" class="${i === sel ? 'sel' : ''}">${ico('search', 16)}${esc(s)}</div>`).join('');
    box.classList.remove('hidden');
  }
  q.addEventListener('keydown', (e) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; renderSug(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; renderSug(); e.preventDefault(); }
    if (e.key === 'Escape') $('#sug').classList.add('hidden');
  });
  q.addEventListener('blur', () => setTimeout(() => $('#sug').classList.add('hidden'), 150));
  $('#sug').addEventListener('mousedown', (e) => { const d = e.target.closest('[data-i]'); if (d) go(items[+d.dataset.i]); });
  $('#engine').onclick = () => { location.href = 'gip://settings#search'; };
  setTimeout(() => q.focus(), 100);

  /* Accès rapide */
  let dial = data ? data.speedDial : [];
  function renderDial() {
    $('#dial').innerHTML = dial.map((d, i) => {
      const h = hostOf(d.url);
      return `<a class="tile" href="${esc(d.url)}" style="--c:${colorFor(h)};animation-delay:${0.25 + i * 0.04}s"><span class="ti"><img src="https://${esc(h)}/favicon.ico" alt="" data-letter="${esc((d.title || h)[0] || '•').toUpperCase()}"></span><span>${esc(d.title || h)}</span><button class="rm" data-i="${i}" title="Retirer">${ico('x', 12)}</button></a>`;
    }).join('') + (data ? `<button class="tile add" id="add" style="animation-delay:${0.25 + dial.length * 0.04}s"><span class="ti">${ico('plus', 22)}</span><span>Ajouter</span></button>` : '');
    $$('.tile img').forEach((img) => img.addEventListener('error', () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: img.dataset.letter })); }));
  }
  renderDial();
  $('#dial').addEventListener('click', async (e) => {
    const rm = e.target.closest('.rm');
    if (rm) { e.preventDefault(); dial.splice(+rm.dataset.i, 1); dial = await call('speedDial.set', dial); renderDial(); return; }
    if (e.target.closest('#add')) {
      const r = await G.modal({
        title: 'Ajouter un raccourci',
        body: '<label class="lbl">Nom</label><input class="input" id="dn" placeholder="Mon site"><label class="lbl">Adresse</label><input class="input" id="du" placeholder="https://exemple.fr">',
        actions: [{ label: 'Annuler', value: null }, { label: 'Ajouter', primary: true, value: (m) => ({ title: m.querySelector('#dn').value, url: m.querySelector('#du').value }) }]
      });
      if (r && r.url) {
        let url = r.url.trim();
        if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
        dial.push({ title: r.title || hostOf(url), url });
        dial = await call('speedDial.set', dial);
        renderDial();
      }
    }
  });

  /* Widgets */
  if (data) {
    const st = data.stats;
    const w = [];
    w.push(`<a class="widget" href="gip://privacy" style="animation-delay:.45s"><h3>${ico('shield', 16)} Bouclier</h3><div class="num" data-n="${st.blockedTotal}">0</div><div class="muted small">pubs & traqueurs bloqués · <span data-n="${st.upgradedTotal}">0</span> passages HTTPS</div></a>`);
    if (!data.guest) w.push(`<a class="widget" href="gip://mail" style="animation-delay:.5s"><h3>${ico('mail', 16)} Gip Mail</h3><div class="num">${data.unread}</div><div class="muted small">${data.unread ? 'message' + (data.unread > 1 ? 's' : '') + ' non lu' + (data.unread > 1 ? 's' : '') : 'Boîte de réception à jour ✨'}</div></a>`);
    w.push(`<a class="widget" href="gip://agenda" style="animation-delay:.55s"><h3>${ico('calendar', 16)} À venir</h3>${data.events.length ? data.events.map((e) => `<div class="line"><i class="dotc" style="--c:${esc(e.color)}"></i><b>${esc(new Date(e.date + 'T00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))}</b>${esc(e.time)} ${esc(e.title)}</div>`).join('') : '<div class="muted small">Aucun événement prévu</div>'}</a>`);
    w.push(`<a class="widget" href="gip://notes" style="animation-delay:.6s"><h3>${ico('note', 16)} Notes épinglées</h3>${data.notes.length ? data.notes.map((n) => `<div class="line"><i class="dotc" style="--c:${esc(n.color)}"></i>${esc(n.title || 'Sans titre')}</div>`).join('') : '<div class="muted small">Épinglez des notes pour les voir ici</div>'}</a>`);
    $('#widgets').innerHTML = w.join('');
    $$('[data-n]').forEach((el) => countUp(el, +el.dataset.n, 1200));
  }
  if (G.on) G.on('mail:unread', () => {});
})();
