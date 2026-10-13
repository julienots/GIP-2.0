'use strict';
(async () => {
  const { call, esc, ico, $, hostOf, timeAgo } = G;
  document.title = 'Coffre-fort Gip';
  await G.boot();
  let items;
  try { items = await call('vault.list'); } catch (e) { return G.lockedScreen(e.message); }
  const page = G.shell('vault', { title: 'Coffre-fort', subtitle: 'Mots de passe chiffrés en AES-256 — vous seul détenez la clé', actions: `<div class="search-field" style="width:240px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher"></div><button class="btn" id="gen">${ico('dice', 16)} Générateur</button><button class="btn primary" id="new">${ico('plus', 16)} Ajouter</button>` });
  page.insertAdjacentHTML('beforeend', `<div class="grid c3 stagger" id="stats" style="margin-bottom:18px"></div><div class="card" style="padding:8px"><div id="list"></div></div>`);

  function strength(p) {
    let s = 0;
    if (!p) return 0;
    if (p.length >= 8) s++; if (p.length >= 12) s++; if (p.length >= 16) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/\d/.test(p)) s++; if (/[^\w]/.test(p)) s++;
    return Math.min(4, Math.floor(s * 4 / 6 + 0.5));
  }
  const SL = [['Très faible', 'bad'], ['Faible', 'bad'], ['Moyen', 'warn'], ['Fort', 'ok'], ['Excellent', 'ok']];

  function render() {
    const s = $('#s').value.toLowerCase();
    const counts = {}; for (const i of items) counts[i.password] = (counts[i.password] || 0) + 1;
    const weak = items.filter((i) => strength(i.password) < 2).length;
    const reused = items.filter((i) => counts[i.password] > 1).length;
    $('#stats').innerHTML = `<div class="card"><div class="muted small">Identifiants</div><b style="font-size:28px">${items.length}</b></div>
      <div class="card"><div class="muted small">Mots de passe faibles</div><b style="font-size:28px;color:${weak ? 'var(--warn)' : 'var(--ok)'}">${weak}</b></div>
      <div class="card"><div class="muted small">Réutilisés</div><b style="font-size:28px;color:${reused ? 'var(--danger)' : 'var(--ok)'}">${reused}</b></div>`;
    const list = items.filter((i) => !s || (i.site + ' ' + i.username).toLowerCase().includes(s));
    $('#list').innerHTML = list.length ? list.map((i, k) => {
      const st = strength(i.password);
      return `<div class="list-item" data-id="${esc(i.id)}" style="animation:rise .4s var(--spring) both ${Math.min(k, 15) * 0.03}s"><div class="fav">${G.favicon(i.site.includes('://') ? i.site : 'https://' + i.site)}</div>
        <div class="main"><b>${esc(i.site || 'Sans nom')}</b><span>${esc(i.username)}</span></div>
        <span class="pill ${SL[st][1]}">${SL[st][0]}</span>${counts[i.password] > 1 ? '<span class="pill bad">Réutilisé</span>' : ''}
        <div class="acts" style="opacity:1"><button class="icon-btn" data-a="user" title="Copier l'identifiant">${ico('user', 16)}</button><button class="icon-btn" data-a="pass" title="Copier le mot de passe">${ico('copy', 16)}</button><button class="icon-btn" data-a="open" title="Ouvrir le site">${ico('globe', 16)}</button><button class="icon-btn" data-a="edit" title="Modifier">${ico('edit', 16)}</button></div></div>`;
    }).join('') : `<div class="empty"><div class="big">${ico('key', 38)}</div><h3>Votre coffre est vide</h3><p>Ajoutez vos identifiants : ils sont chiffrés avec votre mot de passe principal.</p></div>`;
  }

  async function edit(item) {
    const it = item ? { ...item } : { site: '', username: '', password: await call('vault.generate', { length: 20 }), notes: '' };
    const r = await G.modal({
      title: item ? 'Modifier l\'identifiant' : 'Nouvel identifiant',
      body: `<label class="lbl">Site web</label><input class="input" id="site" value="${esc(it.site)}" placeholder="exemple.fr">
        <label class="lbl">Identifiant / e-mail</label><input class="input" id="user" value="${esc(it.username)}">
        <label class="lbl">Mot de passe</label><div class="row"><input class="input mono" id="pass" type="password" value="${esc(it.password)}"><button class="icon-btn" id="eye" title="Afficher">${ico('eye', 17)}</button><button class="icon-btn" id="regen" title="Générer">${ico('dice', 17)}</button></div>
        <div class="row" style="margin-top:8px"><span id="st" class="pill"></span><span class="spacer"></span><button class="btn sm" id="breach">${ico('shield', 14)} Vérifier les fuites</button></div>
        <label class="lbl">Notes</label><textarea class="textarea" id="notes" style="min-height:70px">${esc(it.notes || '')}</textarea>`,
      onOpen(m) {
        const pass = m.querySelector('#pass');
        const upd = () => { const s = strength(pass.value); const st = m.querySelector('#st'); st.className = 'pill ' + SL[s][1]; st.textContent = 'Robustesse : ' + SL[s][0]; };
        pass.addEventListener('input', upd); upd();
        m.querySelector('#eye').onclick = () => { pass.type = pass.type === 'password' ? 'text' : 'password'; };
        m.querySelector('#regen').onclick = async () => { pass.value = await call('vault.generate', { length: 20 }); pass.type = 'text'; upd(); };
        m.querySelector('#breach').onclick = async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Vérification…';
          const r = await call('vault.breachCheck', pass.value);
          b.disabled = false;
          b.innerHTML = !r.checked ? 'Vérification impossible (hors ligne)' : r.count ? `⚠️ Trouvé dans ${r.count.toLocaleString('fr-FR')} fuites !` : '✅ Aucune fuite connue';
        };
      },
      actions: [
        ...(item ? [{ label: 'Supprimer', danger: true, value: 'delete' }] : []),
        { label: 'Annuler', value: null },
        { label: 'Enregistrer', primary: true, value: (m) => ({ id: it.id, site: m.querySelector('#site').value, username: m.querySelector('#user').value, password: m.querySelector('#pass').value, notes: m.querySelector('#notes').value }) }
      ]
    });
    if (r === 'delete') {
      if (await G.confirm('Supprimer cet identifiant ?', 'Cette action est irréversible.', { danger: true, ok: 'Supprimer' })) { await call('vault.delete', item.id); items = items.filter((x) => x.id !== item.id); G.toast('Identifiant supprimé'); }
    } else if (r) {
      const saved = await call('vault.save', r);
      items = items.filter((x) => x.id !== saved.id); items.unshift(saved);
      G.toast('Enregistré dans le coffre 🔐');
    }
    render();
  }

  async function generator() {
    const opts = { length: 20, upper: true, lower: true, digits: true, symbols: true };
    await G.modal({
      title: 'Générateur de mots de passe',
      body: `<div class="card mono" id="out" style="font-size:20px;word-break:break-all;text-align:center;padding:22px"></div>
        <label class="lbl">Longueur : <b id="lv">20</b></label><input type="range" min="8" max="64" value="20" id="len" style="width:100%;accent-color:var(--accent)">
        ${[['upper', 'Majuscules (A-Z)'], ['lower', 'Minuscules (a-z)'], ['digits', 'Chiffres (0-9)'], ['symbols', 'Symboles (!@#…)']].map(([k, l]) => `<div class="setting"><div class="txt"><b>${l}</b></div><button class="switch on" data-k="${k}"></button></div>`).join('')}`,
      onOpen(m) {
        const gen = async () => { const out = m.querySelector('#out'); out.textContent = await call('vault.generate', opts); out.animate([{ opacity: 0.3, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 250 }); };
        m.querySelector('#len').addEventListener('input', (e) => { opts.length = +e.target.value; m.querySelector('#lv').textContent = opts.length; gen(); });
        m.querySelectorAll('.switch').forEach((s) => s.onclick = () => { s.classList.toggle('on'); opts[s.dataset.k] = s.classList.contains('on'); gen(); });
        m.querySelector('#out').onclick = gen;
        gen();
      },
      actions: [{ label: 'Fermer', value: null }, { label: 'Copier', primary: true, value: (m) => { call('vault.copy', m.querySelector('#out').textContent); G.toast('Copié — effacé du presse-papiers dans 30 s'); return true; } }]
    });
  }

  $('#new').onclick = () => edit(null);
  $('#gen').onclick = generator;
  $('#s').addEventListener('input', G.debounce(render, 100));
  $('#list').addEventListener('click', async (e) => {
    const row = e.target.closest('.list-item'); if (!row) return;
    const it = items.find((x) => x.id === row.dataset.id);
    const a = e.target.closest('[data-a]');
    const act = a ? a.dataset.a : 'edit';
    if (act === 'user') { await call('vault.copy', it.username); G.toast('Identifiant copié'); }
    else if (act === 'pass') { await call('vault.copy', it.password); G.toast('Mot de passe copié — effacé dans 30 s'); }
    else if (act === 'open') { location.href = it.site.includes('://') ? it.site : 'https://' + it.site; }
    else edit(it);
  });
  render();
})();
