'use strict';
(async () => {
  const { call, esc, ico, $ } = G;
  document.title = 'Mon compte Gip';
  await G.boot();
  let info;
  try { info = await call('account.get'); if (!info.account) throw new Error('Gip est verrouillé'); } catch (e) { return G.lockedScreen(e.message); }
  const a = info.account;
  const page = G.shell('account', { title: 'Mon compte Gip', subtitle: 'Un compte 100 % local — aucune donnée ne quitte votre appareil', icon: 'user' });
  const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#a259ff', '#4d7cff'];

  page.insertAdjacentHTML('beforeend', `<div class="grid c2 stagger">
    <div class="card" style="text-align:center;padding:30px">
      <div class="avatar lg" id="av" style="--c:${esc(a.color)};margin:0 auto 14px">${esc(a.name[0])}</div>
      <h2 id="nm">${esc(a.name)}</h2>
      <p class="muted">${info.guest ? 'Session invité' : esc(info.address)}</p>
      <p class="muted small">Membre depuis le ${new Date(a.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      ${info.guest ? '' : `<div class="row" style="justify-content:center;margin-top:14px" id="cols">${COLORS.map((c) => `<button data-c="${c}" style="width:24px;height:24px;border-radius:50%;background:${c}"></button>`).join('')}</div>
      <button class="btn" id="rename" style="margin-top:16px">${ico('edit', 16)} Renommer</button>`}
    </div>
    <div class="card"><h2>${ico('lock', 18)} Sécurité</h2>
      <div class="setting"><div class="txt"><b>Chiffrement du profil</b><span>AES-256-GCM, clé dérivée par scrypt (N=32768)</span></div><span class="pill ok">Actif</span></div>
      <div class="setting"><div class="txt"><b>Clé Gip Mail</b><span>Paire X25519 générée sur cet appareil</span></div><span class="pill ok">Prête</span></div>
      <div class="setting"><div class="txt"><b>Télémétrie</b><span>Gip n'envoie aucune donnée d'utilisation</span></div><span class="pill ok">Aucune</span></div>
      ${info.guest ? '' : `<div class="row" style="margin-top:14px;flex-wrap:wrap"><button class="btn" id="pw">${ico('key', 16)} Changer le mot de passe</button><button class="btn" id="export">${ico('download', 16)} Exporter mes données</button></div>`}
      <button class="btn" id="lock" style="margin-top:10px">${ico('lock', 16)} Verrouiller Gip</button>
    </div>
    <div class="card"><h2>${ico('users', 18)} Comptes sur cet appareil</h2>
      ${info.accounts.map((x) => `<div class="list-item"><span class="avatar" style="--c:${esc(x.color)}">${esc(x.name[0])}</span><div class="main"><b>${esc(x.name)}</b><span>${esc(x.handle)}@gip.local</span></div>${x.id === a.id ? '<span class="pill ok">Connecté</span>' : ''}</div>`).join('') || '<p class="muted">Aucun</p>'}
      <p class="muted small">Pour changer de compte ou en créer un, verrouillez Gip.</p>
    </div>
    ${info.guest ? '' : `<div class="card" style="border-color:color-mix(in srgb,var(--danger) 40%,transparent)"><h2 style="color:var(--danger)">${ico('warn', 18)} Zone dangereuse</h2>
      <p class="muted">Supprime définitivement ce compte : historique, favoris, notes, coffre-fort, Drive et mails. Irréversible.</p>
      <button class="btn danger" id="del">${ico('trash', 16)} Supprimer mon compte</button></div>`}
  </div>`);

  $('#lock').onclick = () => call('account.lock');
  if (info.guest) return;
  $('#cols').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const r = await call('account.update', { color: b.dataset.c });
    $('#av').style.setProperty('--c', r.color);
    $('#av').animate([{ transform: 'scale(.8) rotate(-20deg)' }, { transform: 'none' }], { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  });
  $('#rename').onclick = async () => {
    const n = await G.prompt('Renommer le compte', { value: a.name });
    if (!n) return;
    const r = await call('account.update', { name: n });
    $('#nm').textContent = r.name; $('#av').textContent = r.name[0];
    G.toast('Nom mis à jour');
  };
  $('#pw').onclick = async () => {
    await G.modal({
      title: 'Changer le mot de passe principal',
      body: '<label class="lbl">Mot de passe actuel</label><input class="input" type="password" id="o"><label class="lbl">Nouveau mot de passe</label><input class="input" type="password" id="n"><label class="lbl">Confirmer</label><input class="input" type="password" id="c"><p class="muted small">Toutes vos données et fichiers Drive seront re-chiffrés.</p>',
      actions: [{ label: 'Annuler', value: null }, {
        label: 'Changer', primary: true, value: true,
        validate: async (m) => {
          const o = m.querySelector('#o').value, n = m.querySelector('#n').value, c = m.querySelector('#c').value;
          if (n !== c) { G.toast('Les mots de passe ne correspondent pas', true); return false; }
          try { await call('account.changePassword', { oldPassword: o, newPassword: n }); G.toast('🔐 Mot de passe changé, données re-chiffrées'); return true; } catch (e) { G.toast(e.message, true); return false; }
        }
      }]
    });
  };
  $('#export').onclick = async () => { if (await call('account.export')) G.toast('Export enregistré (non chiffré — gardez-le en lieu sûr)'); };
  $('#del').onclick = async () => {
    await G.modal({
      title: 'Supprimer définitivement le compte ?',
      body: '<p class="muted">Saisissez votre mot de passe pour confirmer.</p><input class="input" type="password" id="p">',
      actions: [{ label: 'Annuler', value: null }, {
        label: 'Supprimer', danger: true, value: true,
        validate: async (m) => { try { await call('account.delete', { password: m.querySelector('#p').value }); return true; } catch (e) { G.toast(e.message, true); return false; } }
      }]
    });
  };
})();
