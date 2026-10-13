'use strict';
(async () => {
  const { call, esc, ico, $, $$, timeAgo, fmtDate } = G;
  document.title = 'Gip Mail';
  await G.boot();
  let me;
  try { me = await call('account.get'); } catch (e) { return G.lockedScreen(e.message); }
  if (me.guest) return G.lockedScreen('Gip Mail nécessite un compte Gip. Le mode invité ne conserve aucune donnée.');
  const page = G.shell('mail');

  let folder = 'inbox';
  let inbox = [], sent = [], current = null;
  const colorFor = (s) => { const C = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45']; let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return C[Math.abs(h) % C.length]; };

  page.innerHTML = `<div class="mhead"><div class="hico">${ico('mail', 22)}</div><div><h1>Gip Mail</h1><span class="e2e">${ico('lock', 13)} Chiffré de bout en bout (X25519 + AES-256-GCM)</span></div><div class="spacer"></div>
    <div class="search-field" style="width:280px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher dans les mails"></div></div>
    <div class="mail" id="mail">
      <div class="folders">
        <button class="btn primary compose" id="compose">${ico('edit', 18)} Nouveau message</button>
        <button class="folder on" data-f="inbox">${ico('inbox', 18)} Réception <span class="n hidden" id="n"></span></button>
        <button class="folder" data-f="sent">${ico('send', 18)} Envoyés</button>
        <div class="addr"><span class="muted">Votre adresse</span><b>${esc(me.address)}</b><button class="btn sm" id="copyaddr" style="margin-top:8px">${ico('copy', 14)} Copier</button></div>
      </div>
      <div class="list" id="list"></div>
      <div class="reader" id="reader"></div>
    </div>`;

  async function load() {
    [inbox, sent] = await Promise.all([call('mail.inbox'), call('mail.sent')]);
    const unread = inbox.filter((m) => !m.read).length;
    $('#n').textContent = unread; $('#n').classList.toggle('hidden', !unread);
    renderList();
  }

  function items() {
    const s = $('#s').value.toLowerCase();
    const src = folder === 'inbox' ? inbox : sent.map((m) => ({ ...m, from: 'À : ' + m.to.join(', '), read: true }));
    return s ? src.filter((m) => (m.subject + ' ' + m.body + ' ' + m.from).toLowerCase().includes(s)) : src;
  }

  function renderList() {
    const list = items();
    $('#list').innerHTML = list.length ? list.map((m, i) => `<div class="msg ${m.read ? '' : 'unread'} ${current && current.id === m.id ? 'on' : ''}" data-id="${esc(m.id)}" style="animation-delay:${Math.min(i, 12) * 0.03}s">
      <div class="avatar" style="--c:${colorFor(m.from)}">${esc((m.from.replace('À : ', '')[0] || '?'))}</div>
      <div class="body"><div class="top"><b>${esc(m.from)}</b><span>${timeAgo(m.date)}</span></div><div class="sub">${esc(m.subject)}</div><div class="prev">${esc(m.body.slice(0, 120))}</div></div></div>`).join('')
      : `<div class="empty"><div class="big">${ico(folder === 'inbox' ? 'inbox' : 'send', 36)}</div><h3>${folder === 'inbox' ? 'Boîte de réception vide' : 'Aucun message envoyé'}</h3><p>Écrivez à un autre compte Gip de cet appareil.<br>Vos messages sont chiffrés avec sa clé publique.</p></div>`;
    if (!current) $('#reader').innerHTML = `<div class="empty"><div class="big">${ico('mail', 38)}</div><h3>Sélectionnez un message</h3></div>`;
  }

  async function open(id) {
    const m = items().find((x) => x.id === id);
    if (!m) return;
    current = m;
    if (folder === 'inbox' && !m.read) { m.read = true; call('mail.read', id); const n = inbox.filter((x) => !x.read).length; $('#n').textContent = n; $('#n').classList.toggle('hidden', !n); }
    $('#mail').classList.add('reading');
    $('#reader').innerHTML = `<article><div class="row" style="margin-bottom:10px"><button class="icon-btn" id="back" title="Retour">${ico('back', 18)}</button><div class="spacer"></div>
      ${folder === 'inbox' ? `<button class="btn sm" id="reply">${ico('send', 14)} Répondre</button>` : ''}<button class="btn sm danger" id="del">${ico('trash', 14)} Supprimer</button></div>
      <h2>${esc(m.subject)}</h2>
      <div class="from"><div class="avatar" style="--c:${colorFor(m.from)}">${esc(m.from.replace('À : ', '')[0] || '?')}</div><div class="who"><b>${esc(m.from)}</b><div class="muted small">${esc(m.fromAddress || '')} · ${fmtDate(m.date)}</div></div>${m.encrypted !== false ? `<span class="pill ok">${ico('lock', 12)} Chiffré</span>` : ''}</div>
      <div class="content">${esc(m.body)}</div></article>`;
    renderList();
    $('#back').onclick = () => { current = null; $('#mail').classList.remove('reading'); renderList(); };
    $('#del').onclick = async () => { if (await G.confirm('Supprimer ce message ?', 'Il sera définitivement effacé.', { danger: true, ok: 'Supprimer' })) { await call('mail.delete', id); current = null; load(); G.toast('Message supprimé'); } };
    const rep = $('#reply');
    if (rep) rep.onclick = () => compose({ to: m.fromAddress, subject: m.subject.startsWith('Re:') ? m.subject : 'Re: ' + m.subject, body: `\n\n— Le ${fmtDate(m.date)}, ${m.from} a écrit :\n> ${m.body.split('\n').join('\n> ')}` });
  }

  async function compose(pre = {}) {
    const dir = (await call('mail.directory')).filter((a) => a.address !== me.address);
    await G.modal({
      title: 'Nouveau message',
      wide: true,
      body: `<div class="recips"><label class="lbl">À</label><input class="input" id="to" placeholder="prenom@gip.local" value="${esc(pre.to || '')}"><div class="dir hidden" id="dir"></div></div>
        <label class="lbl">Objet</label><input class="input" id="subj" value="${esc(pre.subject || '')}">
        <label class="lbl">Message</label><textarea class="textarea" id="body" rows="10" style="min-height:220px">${esc(pre.body || '')}</textarea>
        <p class="e2e">${ico('lock', 13)} Ce message sera chiffré avec la clé publique du destinataire.</p>`,
      onOpen(m) {
        const to = m.querySelector('#to');
        const box = m.querySelector('#dir');
        const show = () => {
          const parts = to.value.split(/[,;]\s*/);
          const cur = parts[parts.length - 1].toLowerCase();
          const res = dir.filter((a) => (a.name + a.address).toLowerCase().includes(cur));
          if (!res.length) return box.classList.add('hidden');
          box.innerHTML = res.map((a) => `<div data-a="${esc(a.address)}"><span class="avatar" style="--c:${esc(a.color)};width:28px;height:28px;font-size:12px">${esc(a.name[0])}</span><span><b>${esc(a.name)}</b> <span class="muted small">${esc(a.address)}</span></span></div>`).join('');
          box.classList.remove('hidden');
        };
        to.addEventListener('focus', show);
        to.addEventListener('input', show);
        to.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
        box.addEventListener('mousedown', (e) => {
          const d = e.target.closest('[data-a]'); if (!d) return;
          e.preventDefault();
          const parts = to.value.split(/[,;]\s*/); parts[parts.length - 1] = d.dataset.a;
          to.value = parts.join(', ') + ', ';
          box.classList.add('hidden');
        });
        if (pre.to) setTimeout(() => m.querySelector('#body').focus(), 80);
      },
      actions: [{ label: 'Annuler', value: null }, {
        label: 'Envoyer', primary: true,
        validate: async (m) => {
          try {
            await call('mail.send', { to: m.querySelector('#to').value, subject: m.querySelector('#subj').value, body: m.querySelector('#body').value });
            G.toast('✉️ Message chiffré et envoyé');
            load();
            return true;
          } catch (e) { G.toast(e.message, true); return false; }
        },
        value: true
      }]
    });
  }

  $('#compose').onclick = () => compose();
  $('#copyaddr').onclick = () => { navigator.clipboard.writeText(me.address); G.toast('Adresse copiée'); };
  $$('.folder').forEach((b) => b.onclick = () => { folder = b.dataset.f; current = null; $$('.folder').forEach((x) => x.classList.toggle('on', x === b)); renderList(); });
  $('#list').addEventListener('click', (e) => { const m = e.target.closest('.msg'); if (m) open(m.dataset.id); });
  $('#s').addEventListener('input', G.debounce(renderList, 120));
  G.on('mail:new', load);
  load();
})();
