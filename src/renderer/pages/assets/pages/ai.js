'use strict';
(async () => {
  const { call, esc, ico, $, $$ } = G;
  const params = new URLSearchParams(location.search);
  const PANEL = params.get('panel') === '1';
  document.title = 'Gip IA';
  let s;
  try { s = await G.boot(); if (!s) throw new Error('Gip est verrouillé'); } catch (e) { return G.lockedScreen(e.message); }
  if (PANEL) document.body.classList.add('panel');

  let cfg = await call('ai.config');
  const me = await call('account.get').catch(() => ({}));
  const myName = me && me.account ? me.account.name : '';
  let view = ['chat', 'settings', 'mcp', 'server'].includes(params.get('view')) ? params.get('view') : 'chat';
  let current = null; // conversation affichée
  let waitingNew = false;
  let live = null; // état du rendu en direct

  let page;
  if (PANEL) { page = $('#page'); page.classList.add('page', 'ai-panel'); }
  else page = G.shell('ai', { title: 'Gip IA', subtitle: 'Votre assistant, connecté au navigateur et à vos serveurs MCP', icon: 'sparkle', color: '#00d4a6' });

  const TABS = [['chat', 'sparkle', 'Discussion'], ['settings', 'settings', 'Modèle & clés'], ['mcp', 'plug', 'Serveurs MCP'], ['server', 'bot', 'Gip pour vos IA']];
  page.insertAdjacentHTML('beforeend', `<nav class="ai-tabs">${TABS.map(([k, i, l]) => `<button data-v="${k}">${ico(i, 15)}<span>${l}</span></button>`).join('')}</nav><div id="view"></div>`);
  $('.ai-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) show(b.dataset.v); });

  function show(v) {
    view = v;
    $$('.ai-tabs [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    ({ chat: renderChat, settings: renderSettings, mcp: renderMcp, server: renderServer })[v]();
  }

  /* =========================== Rendu Markdown =========================== */
  function safeHref(u) { return /^(https?:|gip:|mailto:)/i.test(u) ? u : '#'; }
  function inline(t) {
    return t
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, u) => /^https?:/i.test(u) ? `<img class="md-img" src="${u}" alt="${a}" loading="lazy">` : m)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => `<a href="${safeHref(u)}">${a}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, p, u) => `${p}<a href="${u}">${u.length > 70 ? u.slice(0, 67) + '…' : u}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>');
  }
  function md(src) {
    const codes = [];
    let t = esc(String(src || '')).replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (m, lang, code) => { codes.push(`<pre class="code"><button class="cp" data-copy>${ico('copy', 13)}</button><code>${code.replace(/\n$/, '')}</code></pre>`); return `\u0000${codes.length - 1}\u0000`; });
    const inl = [];
    t = t.replace(/`([^`\n]+)`/g, (m, c) => { inl.push(`<code>${c}</code>`); return `\u0001${inl.length - 1}\u0001`; });
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const line of t.split('\n')) {
      let m;
      if (/^\u0000\d+\u0000$/.test(line.trim())) { flush(); out.push(line.trim()); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { flush(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { flush(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      if ((m = line.match(/^&gt;\s?(.*)/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
      if (/^\|.*\|$/.test(line.trim())) {
        flush();
        if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
        out.push(`<div class="trow">${line.trim().slice(1, -1).split('|').map((c) => `<span>${inline(c.trim())}</span>`).join('')}</div>`);
        continue;
      }
      flush();
      out.push(line.trim() ? `<p>${inline(line)}</p>` : '');
    }
    flush();
    return out.join('').replace(/\u0001(\d+)\u0001/g, (m, i) => inl[i]).replace(/\u0000(\d+)\u0000/g, (m, i) => codes[i]);
  }

  /* =========================== Discussion =========================== */
  function toolLabel(it) {
    const name = it.label || String(it.name || '').replace(/^gip_/, '').replace(/^mcp_[^_]+(?:_[^_]+)*?__/, '');
    return name.replace(/_/g, ' ');
  }
  function toolHTML(it) {
    const isMcp = String(it.name).startsWith('mcp_');
    const st = it.running ? '<span class="spin"></span>' : it.isError ? ico('warn', 14) : ico('check', 14);
    const pv = it.preview || {};
    return `<details class="tool ${it.isError ? 'err' : ''} ${it.running ? 'run' : ''}" data-tid="${esc(it.id || '')}"><summary>${st}<span class="tn">${isMcp ? ico('plug', 13) : ico('globe', 13)} ${esc(toolLabel(it))}</span><span class="ts muted">${esc(it.server || (isMcp ? 'MCP' : 'Gip'))}</span></summary>
      <div class="tbody"><div class="muted small">Arguments</div><pre>${esc(JSON.stringify(it.input || {}, null, 2))}</pre>
      ${pv.image ? `<img class="shot" src="${pv.image}" alt="">` : ''}${pv.text ? `<div class="muted small">Résultat</div><pre>${esc(pv.text)}</pre>` : ''}</div></details>`;
  }
  function itemHTML(it) {
    if (it.role === 'user') return `<div class="msg user"><div class="bubble">${md(it.text)}</div></div>`;
    if (it.role === 'assistant') return `<div class="msg bot"><div class="av">${ico('sparkle', 16)}</div><div class="bubble md">${md(it.text)}</div></div>`;
    if (it.role === 'thinking') return `<details class="think"><summary>${ico('sparkle', 13)} Réflexion</summary><div class="md">${md(it.text)}</div></details>`;
    if (it.role === 'tool') return toolHTML(it);
    if (it.role === 'note') return `<div class="note muted small">${esc(it.text)}</div>`;
    return '';
  }

  async function renderChat() {
    const ready = cfg.provider === 'openai' ? !!cfg.openaiBase : cfg.hasAnthropicKey;
    $('#view').innerHTML = `<div class="chat ${PANEL ? 'compact' : ''}">
      ${PANEL ? '' : `<aside class="convs"><button class="btn primary sm block" id="new">${ico('plus', 15)} Nouvelle discussion</button><div id="clist"></div></aside>`}
      <section class="thread">
        ${PANEL ? `<div class="pbar"><select class="select" id="pconv"></select><button class="icon-btn sm" id="new" title="Nouvelle discussion">${ico('plus', 16)}</button></div>` : ''}
        <div id="msgs" class="msgs"></div>
        <div class="composer">
          <div class="ctx" id="ctx"></div>
          <div class="cbox"><textarea id="input" rows="1" placeholder="${ready ? 'Demandez n\'importe quoi… (Entrée pour envoyer)' : 'Configurez d\'abord une IA dans « Modèle & clés »'}"></textarea>
          <button class="btn primary" id="send" title="Envoyer">${ico('send', 17)}</button><button class="btn danger hidden" id="stop" title="Arrêter">${ico('stop', 17)}</button></div>
          <div class="cfoot muted small"><span id="modelname"></span><span class="spacer"></span><span id="toolcount"></span></div>
        </div>
      </section></div>`;
    $('#modelname').textContent = cfg.provider === 'openai' ? `${cfg.openaiModel} · ${cfg.openaiBase}` : ((cfg.models.find((m) => m.id === cfg.model) || { name: cfg.model }).name + ' · effort ' + cfg.effort);
    call('ai.tools').then((t) => { const mcp = t.filter((x) => x.origin === 'mcp').length; $('#toolcount').textContent = `${t.length - mcp} outils navigateur · ${mcp} outils MCP`; }).catch(() => {});
    $('#new').onclick = () => { current = null; live = null; drawThread(); $('#input').focus(); refreshList(); };
    const inp = $('#input');
    inp.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 220) + 'px'; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    $('#send').onclick = send;
    $('#stop').onclick = () => current && call('ai.stop', current.id);
    $('#msgs').addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) { navigator.clipboard.writeText(c.parentElement.querySelector('code').innerText); G.toast('Copié'); }
      const a = e.target.closest('[data-confirm]');
      if (a) { call('ai.confirm', { reqId: a.dataset.req, allow: a.dataset.confirm !== 'no', always: a.dataset.confirm === 'always' }); a.closest('.confirm').remove(); }
      const sug = e.target.closest('[data-sug]');
      if (sug) { inp.value = sug.dataset.sug; send(); }
    });
    updateCtx();
    await refreshList();
    if (current) await openChat(current.id); else drawThread();
    const q = params.get('q');
    if (q && !renderChat.didQ) { renderChat.didQ = true; inp.value = q; send(); }
    inp.focus();
  }

  async function updateCtx() {
    const t = await call('ai.activeTab').catch(() => null);
    const el = $('#ctx'); if (!el) return;
    el.innerHTML = t && !String(t.url).startsWith('gip://') ? `<label class="ctxchip"><input type="checkbox" id="withpage" checked> ${ico('globe', 13)} <span>${esc(t.title || G.hostOf(t.url))}</span></label>` : '';
  }

  async function refreshList() {
    const list = await call('ai.chats').catch(() => []);
    if (PANEL) {
      const sel = $('#pconv'); if (!sel) return;
      sel.innerHTML = `<option value="">Nouvelle discussion</option>` + list.map((c) => `<option value="${c.id}" ${current && current.id === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('');
      sel.onchange = () => { if (sel.value) openChat(sel.value); else { current = null; drawThread(); } };
      return;
    }
    const box = $('#clist'); if (!box) return;
    box.innerHTML = list.map((c) => `<div class="conv ${current && current.id === c.id ? 'on' : ''}" data-id="${c.id}"><span class="ct">${c.running ? '<span class="spin"></span>' : ''}${esc(c.title)}</span><span class="muted small">${G.timeAgo(c.updated)}</span><button class="icon-btn sm del" title="Supprimer">${ico('trash', 14)}</button></div>`).join('') || '<div class="muted small" style="padding:10px">Aucune discussion</div>';
    box.onclick = async (e) => {
      const d = e.target.closest('.del'); const row = e.target.closest('.conv'); if (!row) return;
      if (d) { if (await G.confirm('Supprimer', 'Supprimer cette discussion ?', { danger: true, ok: 'Supprimer' })) { await call('ai.deleteChat', row.dataset.id); if (current && current.id === row.dataset.id) { current = null; drawThread(); } refreshList(); } return; }
      openChat(row.dataset.id);
    };
  }

  async function openChat(id) {
    try { current = await call('ai.chat', id); } catch { current = null; }
    live = null;
    drawThread();
    setRunning(current && current.running);
    refreshList();
  }

  function drawThread() {
    const box = $('#msgs'); if (!box) return;
    if (!current) {
      const SUG = ['Résume la page que je regarde', 'Trouve des photos de la Patagonie en haute définition', 'Quelles sont les actualités du jour ?', 'Compare les 3 premiers résultats pour « meilleur ordinateur portable 2026 »'];
      box.innerHTML = `<div class="hello"><div class="orb">${ico('sparkle', 30)}</div><h2>Bonjour${myName ? ' ' + esc(myName) : ''} 👋</h2><p class="muted">Je peux lire vos pages, chercher sur le web et en images, piloter vos onglets et utiliser vos serveurs MCP.</p>
        <div class="sugs">${SUG.map((t) => `<button class="sug" data-sug="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
      return;
    }
    box.innerHTML = current.items.map(itemHTML).join('');
    G.hydrate(box);
    box.scrollTop = box.scrollHeight;
  }

  function setRunning(on) {
    $('#send')?.classList.toggle('hidden', !!on);
    $('#stop')?.classList.toggle('hidden', !on);
  }

  async function send() {
    const inp = $('#input');
    const text = inp.value.trim();
    if (!text) return;
    if (current && current.running) return;
    inp.value = ''; inp.style.height = 'auto';
    if (!current) { current = { id: null, items: [] }; waitingNew = true; }
    current.items.push({ role: 'user', text });
    drawThread();
    live = { text: null, think: null };
    setRunning(true);
    const box = $('#msgs');
    box.insertAdjacentHTML('beforeend', '<div class="typing"><i></i><i></i><i></i></div>');
    box.scrollTop = box.scrollHeight;
    try {
      const id = await call('ai.send', { chatId: current.id, text, withPage: !!($('#withpage') && $('#withpage').checked) });
      current.id = id; waitingNew = false;
    } catch (e) {
      $('.typing')?.remove();
      setRunning(false);
      box.insertAdjacentHTML('beforeend', `<div class="aerr">${ico('warn', 16)} ${esc(e.message)}${/clé|Configurez/.test(e.message) ? ' <button class="btn sm" id="gocfg">Configurer</button>' : ''}</div>`);
      $('#gocfg') && ($('#gocfg').onclick = () => show('settings'));
      if (!current.id) current = null;
    }
  }

  G.on('ai:event', (ev) => {
    if (view !== 'chat') { if (ev.type === 'done') refreshList(); return; }
    if (!current) return;
    if (current.id == null && waitingNew && ev.type === 'start') { current.id = ev.chatId; waitingNew = false; }
    if (ev.chatId !== current.id) { if (ev.type === 'done') refreshList(); return; }
    const box = $('#msgs'); if (!box) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const typing = () => $('.typing');
    if (ev.type === 'start') { current.running = true; refreshList(); }
    else if (ev.type === 'thinking') {
      typing()?.remove();
      if (!live.think) { box.insertAdjacentHTML('beforeend', `<details class="think live" open><summary>${ico('sparkle', 13)} Réflexion…</summary><div class="md"></div></details>`); live.think = { el: box.lastElementChild, text: '' }; G.hydrate(live.think.el); }
      live.think.text += ev.delta;
      live.think.el.querySelector('.md').innerHTML = md(live.think.text);
    } else if (ev.type === 'text') {
      typing()?.remove();
      if (live.think) { live.think.el.open = false; live.think.el.classList.remove('live'); live.think.el.querySelector('summary').lastChild.textContent = ' Réflexion'; live.think = null; }
      if (!live.text) { box.insertAdjacentHTML('beforeend', `<div class="msg bot"><div class="av">${ico('sparkle', 16)}</div><div class="bubble md"></div></div>`); live.text = { el: box.lastElementChild.querySelector('.bubble'), text: '' }; G.hydrate(box.lastElementChild); }
      live.text.text += ev.delta;
      live.text.el.innerHTML = md(live.text.text);
    } else if (ev.type === 'step') { live.text = null; live.think = null; }
    else if (ev.type === 'tool_start') {
      typing()?.remove();
      box.insertAdjacentHTML('beforeend', toolHTML({ id: ev.id, name: ev.name, label: ev.label, server: ev.server, input: ev.input, running: true }));
      G.hydrate(box.lastElementChild);
      box.insertAdjacentHTML('beforeend', '<div class="typing"><i></i><i></i><i></i></div>');
    } else if (ev.type === 'tool_end') {
      const el = box.querySelector(`.tool[data-tid="${CSS.escape(ev.id)}"]`);
      if (el) { const it = { id: ev.id, name: el.dataset.name, preview: ev.preview, isError: ev.isError }; el.classList.remove('run'); el.classList.toggle('err', ev.isError); el.querySelector('summary').firstElementChild.outerHTML = ev.isError ? ico('warn', 14) : ico('check', 14); const tb = el.querySelector('.tbody'); tb.insertAdjacentHTML('beforeend', `${ev.preview.image ? `<img class="shot" src="${ev.preview.image}" alt="">` : ''}${ev.preview.text ? `<div class="muted small">Résultat</div><pre>${esc(ev.preview.text)}</pre>` : ''}`); void it; }
    } else if (ev.type === 'confirm') {
      typing()?.remove();
      box.insertAdjacentHTML('beforeend', `<div class="confirm"><div><b>${ico('shield', 15)} Autoriser l'action « ${esc(String(ev.label).replace(/_/g, ' '))} » ?</b><div class="muted small">${esc(ev.server)} · ${esc(JSON.stringify(ev.input).slice(0, 300))}</div></div>
        <div class="row"><button class="btn sm" data-confirm="no" data-req="${ev.reqId}">Refuser</button><button class="btn sm" data-confirm="always" data-req="${ev.reqId}">Toujours (session)</button><button class="btn sm primary" data-confirm="yes" data-req="${ev.reqId}">Autoriser</button></div></div>`);
      G.hydrate(box.lastElementChild);
    } else if (ev.type === 'error') {
      typing()?.remove();
      box.insertAdjacentHTML('beforeend', `<div class="aerr">${ico('warn', 16)} ${esc(ev.message)}</div>`);
    } else if (ev.type === 'stopped') {
      typing()?.remove();
      box.insertAdjacentHTML('beforeend', '<div class="note muted small">Réponse arrêtée.</div>');
    } else if (ev.type === 'done') {
      typing()?.remove();
      current.running = false;
      setRunning(false);
      live = null;
      refreshList();
      // Ré-affichage depuis l'historique enregistré (erreurs conservées en bas)
      const errs = [...box.querySelectorAll('.aerr, .note')].map((x) => x.outerHTML).join('');
      call('ai.chat', current.id).then((c) => { current = c; drawThread(); if (errs) { box.insertAdjacentHTML('beforeend', errs); G.hydrate(box); box.scrollTop = box.scrollHeight; } }).catch(() => {});
      return;
    }
    if (atBottom) box.scrollTop = box.scrollHeight;
  });

  /* =========================== Réglages =========================== */
  const PRESETS = [
    ['Ollama (local)', 'http://localhost:11434/v1', 'llama3.1'],
    ['LM Studio (local)', 'http://localhost:1234/v1', 'local-model'],
    ['OpenRouter', 'https://openrouter.ai/api/v1', 'meta-llama/llama-3.1-70b-instruct'],
    ['Mistral AI', 'https://api.mistral.ai/v1', 'mistral-large-latest'],
    ['Groq', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'],
    ['OpenAI', 'https://api.openai.com/v1', 'gpt-4o']
  ];
  function renderSettings() {
    const custom = !cfg.models.some((m) => m.id === cfg.model);
    $('#view').innerHTML = `<div class="grid c2 stagger">
      <div class="card"><h2>${ico('sparkle', 18)} Fournisseur d'IA</h2>
        <div class="seg" id="prov"><button data-p="anthropic">Claude (Anthropic)</button><button data-p="openai">Compatible OpenAI</button></div>
        <div id="pa" class="${cfg.provider === 'openai' ? 'hidden' : ''}">
          <label class="lbl">Clé d'API Anthropic</label>
          <div class="row"><input class="input" id="akey" type="password" placeholder="sk-ant-…" value="${esc(cfg.anthropicKey)}"><button class="btn" id="test">Tester</button></div>
          <div class="muted small" style="margin-top:6px">Créez une clé sur <a href="https://platform.claude.com/settings/keys">platform.claude.com</a>. Elle est stockée chiffrée dans votre compte Gip.</div>
          <label class="lbl">Modèle</label>
          <select class="select" id="model">${cfg.models.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}<option value="__custom">Autre (identifiant)…</option></select>
          <input class="input ${custom ? '' : 'hidden'}" id="mcustom" style="margin-top:8px" placeholder="claude-…" value="${custom ? esc(cfg.model) : ''}">
          <label class="lbl">Effort de réflexion</label>
          <select class="select" id="effort"><option value="low">Faible — réponses rapides</option><option value="medium">Moyen (recommandé)</option><option value="high">Élevé</option><option value="xhigh">Très élevé</option><option value="max">Maximum</option></select>
        </div>
        <div id="po" class="${cfg.provider === 'openai' ? '' : 'hidden'}">
          <label class="lbl">Préréglage</label>
          <div class="row" style="flex-wrap:wrap">${PRESETS.map((p, i) => `<button class="btn sm" data-preset="${i}">${esc(p[0])}</button>`).join('')}</div>
          <label class="lbl">Adresse de l'API (…/v1)</label><input class="input" id="obase" value="${esc(cfg.openaiBase)}">
          <label class="lbl">Clé d'API (facultative pour Ollama / LM Studio)</label><input class="input" id="okey" type="password" value="${esc(cfg.openaiKey)}">
          <label class="lbl">Modèle</label><input class="input" id="omodel" value="${esc(cfg.openaiModel)}">
          <div class="muted small" style="margin-top:6px">Le modèle doit prendre en charge l'appel d'outils (« function calling ») pour utiliser le navigateur et MCP.</div>
        </div>
      </div>
      <div class="card"><h2>${ico('shield', 18)} Sécurité & outils</h2>
        <div class="setting"><div class="txt"><b>Confirmation des actions</b><span>Demander avant que l'IA agisse (ouvrir, cliquer, saisir, outils MCP)</span></div>
          <select class="select" id="confirm" style="width:200px"><option value="actions">Actions uniquement</option><option value="always">Tous les outils</option><option value="never">Jamais (autonome)</option></select></div>
        <div class="setting"><div class="txt"><b>Outils du navigateur</b><span>Onglets, lecture de pages, captures, recherches, favoris, notes</span></div><button class="switch ${cfg.browserTools ? 'on' : ''}" id="btools"></button></div>
        <div class="setting"><div class="txt"><b>Autoriser l'exécution de JavaScript</b><span>Outil avancé run_javascript (pour l'assistant et le serveur MCP)</span></div><button class="switch ${cfg.allowScripts ? 'on' : ''}" id="scripts"></button></div>
        <label class="lbl">Instructions personnalisées</label>
        <textarea class="textarea" id="sys" placeholder="Ex. : Réponds toujours de façon concise. Je suis développeur web.">${esc(cfg.systemExtra)}</textarea>
      </div></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn primary" id="save">${ico('check', 16)} Enregistrer</button></div>`;
    let provider = cfg.provider;
    const segs = () => $$('#prov [data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === provider));
    segs();
    $('#prov').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; provider = b.dataset.p; segs(); $('#pa').classList.toggle('hidden', provider !== 'anthropic'); $('#po').classList.toggle('hidden', provider !== 'openai'); };
    $('#model').value = custom ? '__custom' : cfg.model;
    $('#model').onchange = () => $('#mcustom').classList.toggle('hidden', $('#model').value !== '__custom');
    $('#effort').value = cfg.effort;
    $('#confirm').value = cfg.confirm;
    for (const id of ['#btools', '#scripts']) $(id).onclick = (e) => e.currentTarget.classList.toggle('on');
    $$('[data-preset]').forEach((b) => b.onclick = () => { const p = PRESETS[+b.dataset.preset]; $('#obase').value = p[1]; $('#omodel').value = p[2]; });
    const collect = () => ({
      provider, anthropicKey: $('#akey').value, model: $('#model').value === '__custom' ? $('#mcustom').value.trim() : $('#model').value, effort: $('#effort').value,
      openaiBase: $('#obase').value.trim(), openaiKey: $('#okey').value, openaiModel: $('#omodel').value.trim(),
      confirm: $('#confirm').value, browserTools: $('#btools').classList.contains('on'), allowScripts: $('#scripts').classList.contains('on'), systemExtra: $('#sys').value
    });
    $('#save').onclick = async () => { try { cfg = await call('ai.setConfig', collect()); G.toast('Réglages de Gip IA enregistrés'); renderSettings(); } catch (e) { G.toast(e.message, true); } };
    $('#test').onclick = async () => {
      try { cfg = await call('ai.setConfig', collect()); const r = await call('ai.testKey'); G.toast('✓ Connexion réussie : ' + r.model); } catch (e) { G.toast(e.message, true); }
    };
  }

  /* =========================== Serveurs MCP =========================== */
  const MCP_PRESETS = [
    { name: 'Fichiers (Documents)', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Documents'], hint: 'Lire et écrire dans un dossier. Nécessite Node.js.' },
    { name: 'Mémoire', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], hint: 'Graphe de connaissances persistant.' },
    { name: 'Fetch (pages web)', type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], hint: 'Télécharge des pages en Markdown. Nécessite uv (Python).' },
    { name: 'Réflexion séquentielle', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], hint: 'Raisonnement étape par étape.' },
    { name: 'GitHub', type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer VOTRE_JETON_GITHUB' }, hint: 'Dépôts, issues, pull requests (jeton GitHub requis).' },
    { name: 'Serveur HTTP', type: 'http', url: 'https://', hint: 'N\'importe quel serveur MCP distant (Streamable HTTP ou SSE).' }
  ];
  function dot(st) { return `<span class="sdot ${st}"></span>`; }
  function renderMcp() {
    const list = cfg.mcpServers;
    $('#view').innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div><h2 style="margin:0">${ico('plug', 18)} Serveurs MCP connectés à Gip IA</h2><div class="muted small">Les outils de ces serveurs sont disponibles pour l'assistant. Protocole : stdio (programme local), Streamable HTTP ou SSE.</div></div>
      <div class="row"><button class="btn sm" id="import">${ico('upload', 15)} Importer une config JSON</button><button class="btn sm primary" id="add">${ico('plus', 15)} Ajouter</button></div></div>
      <div class="slist">${list.map((sv) => `<div class="srv" data-id="${sv.id}">${dot(sv.status)}<div class="sinfo"><b>${esc(sv.name)}</b><div class="muted small mono">${sv.type === 'stdio' ? esc(sv.command + ' ' + (sv.args || []).join(' ')) : esc(sv.url)}</div>
        <div class="small ${sv.status === 'error' ? 'bad' : 'muted'}">${sv.status === 'connected' ? `Connecté · ${sv.toolCount} outil(s)${sv.serverName ? ' · ' + esc(sv.serverName) : ''}` : sv.status === 'connecting' ? 'Connexion…' : sv.status === 'error' ? esc(sv.error) : sv.enabled ? 'Déconnecté' : 'Désactivé'}</div></div>
        <div class="row"><button class="btn sm" data-a="tools" ${sv.status !== 'connected' ? 'disabled' : ''}>Outils</button><button class="btn sm" data-a="connect">${ico('refresh', 14)} ${sv.status === 'connected' ? 'Reconnecter' : 'Connecter'}</button><button class="icon-btn sm" data-a="edit" title="Modifier">${ico('edit', 15)}</button><button class="icon-btn sm" data-a="del" title="Supprimer">${ico('trash', 15)}</button></div></div>`).join('') || `<div class="empty" style="padding:30px"><div class="big">${ico('plug', 34)}</div><h3>Aucun serveur MCP</h3><p>Ajoutez-en un pour donner de nouveaux pouvoirs à Gip IA.</p></div>`}</div></div>
      <h3 style="margin:22px 0 10px">Ajout rapide</h3>
      <div class="grid c3">${MCP_PRESETS.map((p, i) => `<button class="card preset" data-p="${i}"><b>${esc(p.name)}</b><span class="muted small">${esc(p.hint)}</span><span class="mono small muted">${esc(p.type === 'stdio' ? p.command + ' ' + p.args.join(' ') : p.url)}</span></button>`).join('')}</div>`;
    G.hydrate($('#view'));
    $('#add').onclick = () => editServer({ type: 'stdio', enabled: true });
    $('#import').onclick = importJson;
    $$('.preset').forEach((b) => b.onclick = () => { const p = MCP_PRESETS[+b.dataset.p]; editServer({ ...p, enabled: true }); });
    $('.slist').onclick = async (e) => {
      const b = e.target.closest('[data-a]'); const row = e.target.closest('.srv'); if (!b || !row) return;
      const id = row.dataset.id; const sv = cfg.mcpServers.find((x) => x.id === id);
      if (b.dataset.a === 'connect') { row.querySelector('.sdot').className = 'sdot connecting'; cfg = await call('ai.connectServer', id).catch((er) => { G.toast(er.message, true); return cfg; }); renderMcp(); }
      if (b.dataset.a === 'edit') editServer(sv);
      if (b.dataset.a === 'del' && await G.confirm('Supprimer', `Supprimer le serveur « ${sv.name} » ?`, { danger: true, ok: 'Supprimer' })) { cfg = await call('ai.removeServer', id); renderMcp(); }
      if (b.dataset.a === 'tools') {
        const tools = await call('ai.serverTools', id);
        G.modal({ title: `Outils de ${sv.name}`, wide: true, body: `<div class="tlist">${tools.map((t) => `<div><b class="mono">${esc(t.name)}</b><div class="muted small">${esc(t.description)}</div></div>`).join('')}</div>` });
      }
    };
  }

  const kv = (o, sep) => Object.entries(o || {}).map(([k, v]) => k + sep + v).join('\n');
  const parseKv = (t, sep) => Object.fromEntries(String(t).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(sep); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + sep.length).trim()] : null; }).filter(Boolean));

  async function editServer(sv) {
    const r = await G.modal({
      title: sv.id ? 'Modifier le serveur MCP' : 'Ajouter un serveur MCP', wide: true,
      body: `<label class="lbl">Nom</label><input class="input" id="sname" value="${esc(sv.name || '')}" placeholder="Mon serveur">
        <label class="lbl">Type de connexion</label><select class="select" id="stype"><option value="stdio">Programme local (stdio)</option><option value="http">Distant — Streamable HTTP</option><option value="sse">Distant — SSE (ancien)</option></select>
        <div id="fstdio"><label class="lbl">Commande</label><input class="input mono" id="scmd" value="${esc(sv.command || '')}" placeholder="npx, uvx, node, python…">
          <label class="lbl">Arguments</label><input class="input mono" id="sargs" value="${esc((sv.args || []).map((a) => /\s/.test(a) ? `"${a}"` : a).join(' '))}" placeholder="-y @modelcontextprotocol/server-memory">
          <label class="lbl">Variables d'environnement (une par ligne, CLE=valeur)</label><textarea class="textarea mono" id="senv" style="min-height:70px">${esc(kv(sv.env, '='))}</textarea></div>
        <div id="fhttp"><label class="lbl">Adresse</label><input class="input mono" id="surl" value="${esc(sv.url || '')}" placeholder="https://exemple.com/mcp">
          <label class="lbl">En-têtes HTTP (un par ligne, Nom: valeur)</label><textarea class="textarea mono" id="shead" style="min-height:70px" placeholder="Authorization: Bearer …">${esc(kv(sv.headers, ': '))}</textarea></div>
        <div class="setting"><div class="txt"><b>Activé</b><span>Se connecter automatiquement au déverrouillage de Gip</span></div><button class="switch ${sv.enabled !== false ? 'on' : ''}" id="sen"></button></div>
        <p class="muted small">⚠️ Un serveur stdio lance un programme sur votre ordinateur avec vos droits. N'ajoutez que des serveurs de confiance.</p>`,
      onOpen: (m) => {
        const t = m.querySelector('#stype'); t.value = sv.type || 'stdio';
        const sync = () => { m.querySelector('#fstdio').classList.toggle('hidden', t.value !== 'stdio'); m.querySelector('#fhttp').classList.toggle('hidden', t.value === 'stdio'); };
        t.onchange = sync; sync();
        m.querySelector('#sen').onclick = (e) => e.currentTarget.classList.toggle('on');
      },
      actions: [{ label: 'Annuler', value: null }, {
        label: 'Enregistrer et connecter', primary: true, value: (m) => ({
          id: sv.id, name: m.querySelector('#sname').value.trim() || 'Serveur MCP', type: m.querySelector('#stype').value,
          command: m.querySelector('#scmd').value.trim(), args: m.querySelector('#sargs').value, env: parseKv(m.querySelector('#senv').value, '='),
          url: m.querySelector('#surl').value.trim(), headers: parseKv(m.querySelector('#shead').value, ':'), enabled: m.querySelector('#sen').classList.contains('on')
        })
      }]
    });
    if (!r) return;
    G.toast('Connexion à « ' + r.name + ' »…');
    try { cfg = await call('ai.saveServer', r); const sv2 = cfg.mcpServers.find((x) => x.name === r.name); G.toast(sv2 && sv2.status === 'connected' ? `✓ ${r.name} : ${sv2.toolCount} outil(s)` : `${r.name} : ${sv2 ? sv2.error || sv2.status : 'enregistré'}`, sv2 && sv2.status === 'error'); } catch (e) { G.toast(e.message, true); }
    renderMcp();
  }

  async function importJson() {
    const txt = await G.modal({
      title: 'Importer des serveurs MCP', wide: true,
      body: `<p class="muted small">Collez une configuration au format Claude Desktop / Cursor / VS Code :</p><textarea class="textarea mono" id="json" style="min-height:220px" placeholder='{ "mcpServers": { "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] } } }'></textarea>`,
      actions: [{ label: 'Annuler', value: null }, { label: 'Importer', primary: true, value: (m) => m.querySelector('#json').value }]
    });
    if (!txt) return;
    let obj;
    try { obj = JSON.parse(txt); } catch { return G.toast('JSON invalide', true); }
    const servers = obj.mcpServers || obj.servers || obj;
    let n = 0;
    for (const [name, c] of Object.entries(servers || {})) {
      if (!c || typeof c !== 'object') continue;
      const type = c.command ? 'stdio' : (c.type === 'sse' || c.transport === 'sse') ? 'sse' : 'http';
      try { cfg = await call('ai.saveServer', { name, type, command: c.command, args: c.args || [], env: c.env || {}, url: c.url || c.serverUrl || '', headers: c.headers || {}, enabled: true }); n++; } catch (e) { G.toast(name + ' : ' + e.message, true); }
    }
    G.toast(n + ' serveur(s) importé(s)');
    renderMcp();
  }

  /* =========================== Gip comme serveur MCP =========================== */
  function renderServer() {
    const sv = cfg.server;
    const url = `http://127.0.0.1:${sv.port}/mcp`;
    const desktop = JSON.stringify({ mcpServers: { gip: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization:Bearer ' + sv.token] } } }, null, 2);
    const code = `claude mcp add --transport http gip ${url} --header "Authorization: Bearer ${sv.token}"`;
    const generic = JSON.stringify({ mcpServers: { gip: { type: 'http', url, headers: { Authorization: 'Bearer ' + sv.token } } } }, null, 2);
    $('#view').innerHTML = `<div class="grid c2 stagger">
      <div class="card"><h2>${ico('bot', 18)} Laissez vos IA piloter Gip</h2>
        <p class="muted small">Gip devient un <b>serveur MCP</b> local : Claude Desktop, Claude Code, Cursor ou toute IA compatible MCP peut ouvrir des onglets, lire des pages, faire des captures, chercher sur le web et en images, gérer vos favoris et vos notes.</p>
        <div class="setting"><div class="txt"><b>Serveur MCP de Gip</b><span>${sv.running ? `${dot('connected')} Actif sur ${esc(sv.url)}` : sv.error ? `<span class="bad">${esc(sv.error)}</span>` : 'Arrêté'}</span></div><button class="switch ${sv.enabled ? 'on' : ''}" id="srvon"></button></div>
        <div class="setting"><div class="txt"><b>Autoriser les actions</b><span>Ouvrir/fermer des onglets, cliquer, saisir, créer des notes. Désactivé : lecture seule.</span></div><button class="switch ${sv.allowActions ? 'on' : ''}" id="srvact"></button></div>
        <div class="setting"><div class="txt"><b>Port</b><span>Écoute uniquement sur 127.0.0.1 (cet ordinateur)</span></div><input class="input" id="port" type="number" min="1024" max="65535" style="width:110px" value="${sv.port}"></div>
        <label class="lbl">Jeton d'accès (secret)</label>
        <div class="row"><input class="input mono" id="tok" type="password" readonly value="${esc(sv.token)}"><button class="icon-btn" id="tshow" title="Afficher">${ico('eye', 16)}</button><button class="icon-btn" id="tcopy" title="Copier">${ico('copy', 16)}</button><button class="btn sm" id="tnew">Régénérer</button></div>
        <p class="muted small">Les onglets des fenêtres privées ne sont jamais accessibles. Le serveur s'arrête quand Gip est verrouillé.</p>
      </div>
      <div class="card"><h2>${ico('code', 18)} Connecter une IA</h2>
        <label class="lbl">Claude Code (terminal)</label><pre class="snip"><button class="cp" data-snip="code">${ico('copy', 13)}</button><code>${esc(code)}</code></pre>
        <label class="lbl">Claude Desktop — claude_desktop_config.json</label><pre class="snip"><button class="cp" data-snip="desktop">${ico('copy', 13)}</button><code>${esc(desktop)}</code></pre>
        <label class="lbl">Cursor, VS Code et clients HTTP</label><pre class="snip"><button class="cp" data-snip="generic">${ico('copy', 13)}</button><code>${esc(generic)}</code></pre>
      </div></div>`;
    G.hydrate($('#view'));
    const snips = { code, desktop, generic };
    $$('[data-snip]').forEach((b) => b.onclick = () => { navigator.clipboard.writeText(snips[b.dataset.snip]); G.toast('Copié'); });
    const save = async (patch, msg) => { try { cfg = await call('ai.setConfig', { server: patch }); if (msg) G.toast(msg); } catch (e) { G.toast(e.message, true); cfg = await call('ai.config'); } renderServer(); };
    $('#srvon').onclick = () => save({ enabled: !sv.enabled }, !sv.enabled ? 'Serveur MCP démarré' : 'Serveur MCP arrêté');
    $('#srvact').onclick = () => save({ allowActions: !sv.allowActions });
    $('#port').onchange = (e) => save({ port: +e.target.value }, 'Port modifié');
    $('#tshow').onclick = () => { const t = $('#tok'); t.type = t.type === 'password' ? 'text' : 'password'; };
    $('#tcopy').onclick = () => { navigator.clipboard.writeText(sv.token); G.toast('Jeton copié'); };
    $('#tnew').onclick = async () => { if (await G.confirm('Régénérer le jeton', 'Les IA déjà connectées devront utiliser le nouveau jeton.', { ok: 'Régénérer' })) save({ regenerate: true }, 'Nouveau jeton créé'); };
  }

  // Rafraîchit l'état des serveurs MCP pendant les connexions
  setInterval(async () => {
    if (view !== 'mcp' || !cfg.mcpServers.some((x) => x.status === 'connecting')) return;
    cfg = await call('ai.config'); renderMcp();
  }, 1500);

  show(view);
})();
