'use strict';
(async () => {
  const { call, esc, ico, $, $$, fmtBytes, timeAgo } = G;
  document.title = 'Gip Drive';
  await G.boot();
  let state;
  try { state = await call('drive.list'); } catch (e) { return G.lockedScreen(e.message); }
  const page = G.shell('drive', { title: 'Gip Drive', subtitle: 'Stockage chiffré sur votre appareil', actions: `<div class="search-field" style="width:220px">${ico('search', 16)}<input class="input" id="s" placeholder="Rechercher"></div><label class="btn primary">${ico('upload', 16)} Importer<input type="file" id="file" multiple hidden></label>` });
  page.insertAdjacentHTML('beforeend', `
    <div class="card" id="drop" style="border:2px dashed var(--line);text-align:center;padding:28px;margin-bottom:18px;transition:.2s">
      <div style="color:var(--accent2);display:inline-block">${ico('cloud', 34)}</div>
      <div><b>Glissez vos fichiers ici</b></div><div class="muted small">Chaque fichier est chiffré en AES-256-GCM avant d'être écrit sur le disque</div>
      <div style="margin:14px auto 0;max-width:360px"><div class="muted small" id="usage"></div><div style="height:6px;border-radius:3px;background:var(--field);margin-top:6px;overflow:hidden"><i id="ubar" style="display:block;height:100%;width:0;background:var(--grad);transition:width .8s var(--ease)"></i></div></div>
    </div>
    <div class="grid c3 stagger" id="list"></div>`);

  const TYPE_ICON = (t, n) => t.startsWith('image/') ? 'image' : /pdf|text|document|word|sheet/.test(t) || /\.(txt|md|pdf|docx?|xlsx?)$/i.test(n) ? 'note' : 'file';

  function render() {
    const s = $('#s').value.toLowerCase();
    const files = state.files.filter((f) => !s || f.name.toLowerCase().includes(s));
    const quota = 5 * 1024 * 1024 * 1024;
    $('#usage').textContent = `${fmtBytes(state.usage)} utilisés · ${state.files.length} fichier${state.files.length > 1 ? 's' : ''}`;
    requestAnimationFrame(() => { $('#ubar').style.width = Math.max(1, Math.min(100, state.usage / quota * 100)) + '%'; });
    $('#list').innerHTML = files.length ? files.map((f) => `<div class="card" data-id="${esc(f.id)}" style="padding:16px;cursor:pointer;transition:transform .3s var(--spring)">
      <div class="row"><div style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--field);color:var(--accent2)">${ico(TYPE_ICON(f.type, f.name), 20)}</div>
      <div style="flex:1;min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(f.name)}">${esc(f.name)}</b><span class="muted small">${fmtBytes(f.size)} · ${timeAgo(f.date)}</span></div></div>
      <div class="row" style="margin-top:12px;gap:4px"><button class="btn sm" data-a="view">${ico('eye', 14)} Aperçu</button><button class="icon-btn" data-a="save" title="Enregistrer sur l'ordinateur">${ico('download', 16)}</button><button class="icon-btn" data-a="rename" title="Renommer">${ico('edit', 16)}</button><button class="icon-btn danger" data-a="del" title="Supprimer">${ico('trash', 16)}</button></div></div>`).join('')
      : `<div class="empty" style="grid-column:1/-1"><div class="big">${ico('folder', 36)}</div><h3>${s ? 'Aucun fichier trouvé' : 'Votre Drive est vide'}</h3></div>`;
  }

  async function reload() { state = await call('drive.list'); render(); }

  async function upload(files) {
    for (const f of files) {
      try {
        G.toast('Chiffrement de ' + f.name + '…');
        const bytes = new Uint8Array(await f.arrayBuffer());
        await call('drive.upload', { name: f.name, type: f.type, bytes });
      } catch (e) { G.toast(e.message, true); }
    }
    G.toast('✓ Fichiers chiffrés et enregistrés');
    reload();
  }

  async function preview(id) {
    const f = state.files.find((x) => x.id === id);
    const p = await call('drive.preview', id);
    if (!p) return G.toast('Fichier trop volumineux pour l\'aperçu', true);
    let body;
    if (p.type.startsWith('image/')) body = `<img src="${p.dataUrl}" style="max-width:100%;border-radius:12px;display:block;margin:auto">`;
    else if (p.type.startsWith('video/')) body = `<video src="${p.dataUrl}" controls style="width:100%;border-radius:12px"></video>`;
    else if (p.type.startsWith('audio/')) body = `<audio src="${p.dataUrl}" controls style="width:100%"></audio>`;
    else if (p.type.startsWith('text/') || /\.(txt|md|json|csv|js|css|html|xml|log)$/i.test(p.name)) {
      const txt = new TextDecoder().decode(Uint8Array.from(atob(p.dataUrl.split(',')[1]), (c) => c.charCodeAt(0)));
      body = `<pre class="mono card" style="white-space:pre-wrap;max-height:60vh;overflow:auto;font-size:12.5px">${esc(txt.slice(0, 200000))}</pre>`;
    } else body = `<div class="empty"><div class="big">${ico('file', 36)}</div><p>Aperçu non disponible pour ce type de fichier.<br>Enregistrez-le pour l'ouvrir.</p></div>`;
    const r = await G.modal({ title: f.name, wide: true, body, actions: [{ label: 'Fermer', value: null }, { label: 'Enregistrer sur l\'ordinateur', primary: true, value: 'save' }] });
    if (r === 'save') call('drive.save', id);
  }

  $('#file').addEventListener('change', (e) => { upload([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop');
  for (const ev of ['dragenter', 'dragover']) document.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; drop.style.transform = 'scale(1.01)'; });
  for (const ev of ['dragleave', 'drop']) document.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = ''; drop.style.transform = ''; });
  document.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); });
  $('#s').addEventListener('input', G.debounce(render, 100));
  $('#list').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-id]'); if (!card) return;
    const id = card.dataset.id;
    const a = (e.target.closest('[data-a]') || {}).dataset?.a || 'view';
    if (a === 'view') preview(id);
    else if (a === 'save') { if (await call('drive.save', id)) G.toast('Fichier déchiffré et enregistré'); }
    else if (a === 'rename') { const f = state.files.find((x) => x.id === id); const n = await G.prompt('Renommer', { value: f.name }); if (n) { await call('drive.rename', { id, name: n }); reload(); } }
    else if (a === 'del') { if (await G.confirm('Supprimer ce fichier ?', 'Il sera définitivement effacé de Gip Drive.', { danger: true, ok: 'Supprimer' })) { await call('drive.delete', id); G.toast('Fichier supprimé'); reload(); } }
  });
  render();
})();
