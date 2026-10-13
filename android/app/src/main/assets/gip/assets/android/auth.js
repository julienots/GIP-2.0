'use strict';
(async () => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#a259ff', '#4d7cff'];
  let picked = COLORS[0], current = null, state;
  const cleanErr = (e) => String(e && e.message || e);

  const quick = new URLSearchParams(location.search).get('quick') === '1';
  state = await gip.call('auth.state');
  await sleep(quick ? 300 : 2200);
  $('#splash').classList.add('out');
  setTimeout(() => $('#splash').remove(), 800);
  $('#auth').classList.remove('hidden');

  const avatar = (a, cls) => `<div class="avatar ${cls}" style="--c:${esc(a.color)}">${esc(a.name[0] || '?')}</div>`;
  function step(id) { $$('.auth-step').forEach((s) => s.classList.add('hidden')); const el = $('#' + id); el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  function err(where, msg) { $('#' + where + '-err').textContent = msg; const c = $('.auth-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }

  function home() {
    $('#create-colors').innerHTML = COLORS.map((c) => `<button type="button" style="background:${c};color:${c}" data-c="${c}" class="${c === picked ? 'on' : ''}"></button>`).join('');
    if (!state.accounts.length) { $('#auth-sub').textContent = 'Bienvenue ! Créez votre premier compte'; $('#create-back').classList.add('hidden'); step('auth-create'); return; }
    $('#create-back').classList.remove('hidden');
    $('#auth-sub').textContent = 'Choisissez votre compte';
    $('#auth-accounts').innerHTML = state.accounts.map((a, i) => `<button class="acc" data-id="${esc(a.id)}" style="animation-delay:${0.1 + i * 0.06}s">${avatar(a, 'lg')}<b>${esc(a.name)}</b><span class="muted small">${esc(a.handle)}@gip.local</span></button>`).join('');
    step('auth-pick');
    if (state.accounts.length === 1) login(state.accounts[0]);
  }
  function login(a) {
    current = a;
    $('#login-avatar').outerHTML = avatar(a, 'xl').replace('class="avatar xl"', 'class="avatar xl" id="login-avatar"');
    $('#login-name').textContent = a.name;
    $('#login-addr').textContent = a.handle + '@gip.local';
    $('#login-err').textContent = ''; $('#login-pass').value = '';
    $('#auth-sub').textContent = 'Déverrouillez votre espace';
    step('auth-login');
    setTimeout(() => $('#login-pass').focus(), 300);
  }
  async function done(p) { $('#auth').classList.add('out'); await sleep(350); return p; }

  $('#auth-accounts').addEventListener('click', (e) => { const b = e.target.closest('.acc'); if (b) login(state.accounts.find((a) => a.id === b.dataset.id)); });
  $('#auth-new').onclick = () => { $('#auth-sub').textContent = 'Nouveau compte Gip'; step('auth-create'); };
  $('#create-back').onclick = home;
  $('#login-back').onclick = () => { $('#auth-sub').textContent = 'Choisissez votre compte'; step('auth-pick'); };
  $('#auth-guest').onclick = async () => { await done(); gip.call('auth.guest'); };
  $('#create-colors').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; picked = b.dataset.c; $$('#create-colors button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#create-pass').addEventListener('input', (e) => {
    const v = e.target.value; let s = 0;
    if (v.length >= 6) s++; if (v.length >= 10) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^\w]/.test(v)) s++;
    $('#create-strength').style.width = (s / 5 * 100) + '%';
    $('#create-strength').style.background = ['#ff5c7a', '#ff5c7a', '#ffb547', '#ffd84d', '#2ee59d', '#2ee59d'][s];
  });
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('.btn'); btn.classList.add('loading');
    try { await gip.call('auth.login', { id: current.id, password: $('#login-pass').value }); $('#auth').classList.add('out'); }
    catch (x) { err('login', cleanErr(x)); } finally { btn.classList.remove('loading'); }
  });
  $('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#create-pass').value !== $('#create-pass2').value) return err('create', 'Les mots de passe ne correspondent pas');
    const btn = e.target.querySelector('.btn'); btn.classList.add('loading');
    try { await gip.call('auth.create', { name: $('#create-name').value, password: $('#create-pass').value, color: picked }); $('#auth').classList.add('out'); }
    catch (x) { err('create', cleanErr(x)); } finally { btn.classList.remove('loading'); }
  });
  home();
})();
