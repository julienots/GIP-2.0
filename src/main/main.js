'use strict';
const {
  app, BrowserWindow, ipcMain, protocol, session, net, Menu, clipboard, shell,
  dialog, webContents, nativeTheme, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { Store, uid } = require('./store');
const privacy = require('./privacy');
const { AD_COUNT, TRACKER_COUNT } = require('./blocklist');

app.setName('Gip 2.0');
if (process.env.GIP_USER_DATA) app.setPath('userData', process.env.GIP_USER_DATA);

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'renderer', 'pages');
const BROWSER_UI = path.join(ROOT, 'renderer', 'browser', 'index.html');
const BROWSER_PRELOAD = path.join(ROOT, 'preload', 'browser-preload.js');
const WEBVIEW_PRELOAD = path.join(ROOT, 'preload', 'webview-preload.js');
const ICON = path.join(ROOT, 'renderer', 'pages', 'assets', 'logo.png');

const CHROME_VERSION = process.versions.chrome;
const USER_AGENT = (() => {
  const plat = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION.split('.')[0]}.0.0.0 Safari/537.36`;
})();

const SEARCH_ENGINES = {
  gip: { name: 'Gip Search', url: 'gip://search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  qwant: { name: 'Qwant', url: 'https://www.qwant.com/?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' }
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'gip', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let store;
const windows = new Map(); // webContentsId -> { win, private, partition }
const preparedSessions = new Set();
const shieldCounts = new Map(); // webview wcId -> { ads, trackers, upgrades, params, hosts:Set }
const pendingPermissions = new Map();
const downloads = new Map();

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function bumpStat(key) {
  if (!store.session) return;
  const st = store.session.data.stats;
  st[key] = (st[key] || 0) + 1;
  store.scheduleSave();
}

function hostWindowOf(wc) {
  const host = wc && wc.hostWebContents;
  return host && !host.isDestroyed() ? host : null;
}

function prepareSession(partition, { isPrivate = false } = {}) {
  const ses = session.fromPartition(partition);
  if (preparedSessions.has(partition)) return ses;
  preparedSessions.add(partition);

  ses.setUserAgent(USER_AGENT, 'fr-FR,fr,en-US,en');
  ses.protocol.handle('gip', serveInternal);
  ses.setSpellCheckerLanguages && ses.setSpellCheckerLanguages(['fr', 'en-US']);

  privacy.attach(ses, {
    settings: () => store.settings,
    stat: bumpStat,
    onBlocked(wcId, info) {
      if (!wcId) return;
      let c = shieldCounts.get(wcId);
      if (!c) { c = { ads: 0, trackers: 0, upgrades: 0, params: 0, hosts: new Set() }; shieldCounts.set(wcId, c); }
      if (info.kind === 'ad') c.ads++;
      else if (info.kind === 'tracker') c.trackers++;
      else if (info.kind === 'upgrade') c.upgrades++;
      else if (info.kind === 'param') c.params++;
      if (info.host) c.hosts.add(info.host);
      const wc = webContents.fromId(wcId);
      const host = hostWindowOf(wc);
      if (host) host.send('shield:update', { wcId, ...serializeShield(c) });
    }
  });

  const ASK = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'display-capture', 'hid', 'serial', 'usb', 'idle-detection', 'window-management']);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    if (origin.startsWith('gip:')) return callback(true);
    if (!ASK.has(permission)) return callback(permission === 'fullscreen' || permission === 'clipboard-sanitized-write' || permission === 'pointerLock');
    const saved = store.loggedIn && store.settings.sitePermissions[origin] && store.settings.sitePermissions[origin][permission];
    if (saved) return callback(saved === 'allow');
    const host = hostWindowOf(wc);
    if (!host) return callback(false);
    const reqId = uid(6);
    pendingPermissions.set(reqId, { callback, origin, permission, isPrivate });
    host.send('permission:request', { reqId, origin, permission, wcId: wc.id, mediaTypes: details.mediaTypes || [] });
    setTimeout(() => { if (pendingPermissions.has(reqId)) { pendingPermissions.get(reqId).callback(false); pendingPermissions.delete(reqId); } }, 60000);
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (String(origin).startsWith('gip:')) return true;
    if (permission === 'fullscreen' || permission === 'clipboard-sanitized-write') return true;
    const saved = store.loggedIn && store.settings.sitePermissions[origin] && store.settings.sitePermissions[origin][permission];
    return saved === 'allow';
  });

  ses.on('will-download', (e, item, wc) => handleDownload(item, wc, isPrivate));
  return ses;
}

function serializeShield(c) {
  return { ads: c.ads, trackers: c.trackers, upgrades: c.upgrades, params: c.params, hosts: [...c.hosts].slice(0, 50) };
}

/* ------------------------------------------------------------------ */
/* gip:// pages internes                                               */
/* ------------------------------------------------------------------ */

const INTERNAL_PAGES = new Set(['home', 'newtab', 'search', 'settings', 'history', 'bookmarks', 'downloads', 'privacy', 'mail', 'notes', 'vault', 'drive', 'agenda', 'account', 'about', 'error']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };

async function serveInternal(request) {
  const u = new URL(request.url);
  let host = u.hostname || 'home';
  if (host === 'newtab') host = 'home';
  let file;
  if (host === 'assets') file = path.join(PAGES, 'assets', path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, ''));
  else if (INTERNAL_PAGES.has(host)) file = path.join(PAGES, host + '.html');
  else file = path.join(PAGES, 'error.html');
  if (!file.startsWith(PAGES)) return new Response('Interdit', { status: 403 });
  try {
    const body = await fs.promises.readFile(file);
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' };
    if (file.endsWith('.html')) {
      headers['content-security-policy'] = "default-src 'self' gip:; img-src gip: data: blob: https: http:; style-src 'self' gip: 'unsafe-inline'; script-src 'self' gip:; connect-src gip:; font-src gip: data:; media-src gip: data: blob:; frame-src 'none'; object-src 'none'";
    }
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response('Introuvable', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}

/* ------------------------------------------------------------------ */
/* Fenêtres                                                            */
/* ------------------------------------------------------------------ */

function createWindow({ isPrivate = false, url = null } = {}) {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 560,
    minHeight: 420,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    backgroundColor: isPrivate ? '#0d0718' : '#0b0d17',
    show: false,
    title: isPrivate ? 'Gip 2.0 — Navigation privée' : 'Gip 2.0',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: BROWSER_PRELOAD,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  const partition = isPrivate ? 'gip-private-' + uid(6) : null;
  const entry = { win, isPrivate, partition, initialUrl: url };
  windows.set(win.webContents.id, entry);
  const wcId = win.webContents.id;
  win.on('closed', () => {
    windows.delete(wcId);
    if (isPrivate && partition) {
      session.fromPartition(partition).clearStorageData().catch(() => {});
    }
  });
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('window:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('window:state', { maximized: false }));
  win.on('enter-full-screen', () => win.webContents.send('window:state', { fullscreen: true }));
  win.on('leave-full-screen', () => win.webContents.send('window:state', { fullscreen: false }));
  win.loadFile(BROWSER_UI, { query: { private: isPrivate ? '1' : '0', platform: process.platform } });

  // Sécurité : contrôle des <webview> attachés
  win.webContents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preloadURL;
    prefs.preload = WEBVIEW_PRELOAD;
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.allowRunningInsecureContent = false;
    const expected = entry.isPrivate ? entry.partition : store.partition();
    if (params.partition !== expected) params.partition = expected;
    prepareSession(params.partition, { isPrivate: entry.isPrivate || store.isGuest() });
  });
  return win;
}

function browserEntryFor(sender) { return windows.get(sender.id); }

function broadcast(channel, payload) {
  for (const { win } of windows.values()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
  for (const wc of webContents.getAllWebContents()) {
    try { if (!wc.isDestroyed() && wc.getURL().startsWith('gip:')) wc.send('gip:event', { channel, payload }); } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Webviews : nouveaux onglets, menu contextuel, compteurs             */
/* ------------------------------------------------------------------ */

app.on('web-contents-created', (e, contents) => {
  if (contents.getType() !== 'webview') {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return;
  }
  contents.setWindowOpenHandler(({ url, disposition }) => {
    const host = hostWindowOf(contents);
    if (host) host.send('tab:open', { url, background: disposition === 'background-tab', opener: contents.id });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (ev, url) => {
    // Une page web ne peut pas naviguer vers une page interne gip://
    try {
      const from = contents.getURL();
      if (url.startsWith('gip:') && from && !from.startsWith('gip:') && !from.startsWith('about:')) ev.preventDefault();
    } catch {}
  });
  contents.on('did-start-navigation', (ev, url, isInPlace, isMainFrame) => {
    const main = ev && typeof ev.isMainFrame === 'boolean' ? ev.isMainFrame : isMainFrame;
    const inPlace = ev && typeof ev.isSameDocument === 'boolean' ? ev.isSameDocument : isInPlace;
    if (main && !inPlace) {
      shieldCounts.set(contents.id, { ads: 0, trackers: 0, upgrades: 0, params: 0, hosts: new Set() });
      const host = hostWindowOf(contents);
      if (host) host.send('shield:update', { wcId: contents.id, ads: 0, trackers: 0, upgrades: 0, params: 0, hosts: [] });
    }
  });
  contents.on('destroyed', () => shieldCounts.delete(contents.id));
  contents.on('context-menu', (ev, p) => buildContextMenu(contents, p));
  contents.on('before-input-event', (ev, input) => {
    // Relaye les raccourcis vers l'interface du navigateur quand la page a le focus
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const relay = (mod && /^[tnwlrfdhjpqk0-9=+\-]$/i.test(input.key)) || (mod && input.key === 'Tab')
      || ['F5', 'F11', 'F12', 'F6'].includes(input.key) || (input.alt && ['ArrowLeft', 'ArrowRight', 'Home'].includes(input.key))
      || (input.key === 'Escape');
    if (!relay) return;
    if (input.key === 'Escape') { const h = hostWindowOf(contents); if (h) h.send('shortcut', { key: 'Escape', control: false, meta: false, shift: false, alt: false }); return; }
    ev.preventDefault();
    const host = hostWindowOf(contents);
    if (host) host.send('shortcut', { key: input.key, code: input.code, control: input.control, meta: input.meta, shift: input.shift, alt: input.alt });
  });
});

function buildContextMenu(contents, p) {
  const host = hostWindowOf(contents);
  const send = (ch, data) => host && host.send(ch, data);
  const t = [];
  if (p.linkURL) {
    t.push(
      { label: 'Ouvrir le lien dans un nouvel onglet', click: () => send('tab:open', { url: p.linkURL, background: true }) },
      { label: 'Ouvrir le lien dans une fenêtre privée', click: () => createWindow({ isPrivate: true, url: p.linkURL }) },
      { label: 'Copier l\'adresse du lien', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' }
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push(
      { label: 'Ouvrir l\'image dans un nouvel onglet', click: () => send('tab:open', { url: p.srcURL, background: true }) },
      { label: 'Enregistrer l\'image sous…', click: () => contents.downloadURL(p.srcURL) },
      { label: 'Copier l\'image', click: () => contents.copyImageAt(p.x, p.y) },
      { label: 'Copier l\'adresse de l\'image', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' }
    );
  }
  if (p.isEditable) {
    t.push(
      { label: 'Annuler', role: 'undo', enabled: p.editFlags.canUndo },
      { label: 'Rétablir', role: 'redo', enabled: p.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Couper', role: 'cut', enabled: p.editFlags.canCut },
      { label: 'Copier', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Coller', role: 'paste', enabled: p.editFlags.canPaste },
      { label: 'Tout sélectionner', role: 'selectAll' },
      { type: 'separator' }
    );
    if (p.misspelledWord && p.dictionarySuggestions.length) {
      t.unshift(...p.dictionarySuggestions.slice(0, 4).map((s) => ({ label: s, click: () => contents.replaceMisspelling(s) })), { type: 'separator' });
    }
  } else if (p.selectionText) {
    const sel = p.selectionText.trim().slice(0, 60);
    t.push(
      { label: 'Copier', role: 'copy' },
      { label: `Rechercher « ${sel}${p.selectionText.length > 60 ? '…' : ''} » avec Gip`, click: () => send('tab:open', { url: searchUrl(p.selectionText.trim()) }) },
      { type: 'separator' }
    );
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText && p.mediaType === 'none') {
    t.push(
      { label: 'Précédent', enabled: contents.navigationHistory ? contents.navigationHistory.canGoBack() : contents.canGoBack(), click: () => contents.goBack() },
      { label: 'Suivant', enabled: contents.navigationHistory ? contents.navigationHistory.canGoForward() : contents.canGoForward(), click: () => contents.goForward() },
      { label: 'Actualiser', click: () => contents.reload() },
      { type: 'separator' },
      { label: 'Enregistrer la page sous…', click: () => savePage(contents) },
      { label: 'Imprimer…', click: () => contents.print() },
      { label: 'Ajouter aux favoris', click: () => send('shortcut', { key: 'd', control: true }) },
      { type: 'separator' }
    );
  }
  t.push({ label: 'Inspecter', click: () => contents.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(t).popup();
}

async function savePage(contents) {
  const win = BrowserWindow.fromWebContents(hostWindowOf(contents));
  const r = await dialog.showSaveDialog(win, { defaultPath: (contents.getTitle() || 'page').replace(/[\\/:*?"<>|]/g, '_') + '.html', filters: [{ name: 'Page web complète', extensions: ['html'] }] });
  if (!r.canceled && r.filePath) contents.savePage(r.filePath, 'HTMLComplete').catch(() => {});
}

function searchUrl(q) {
  const eng = SEARCH_ENGINES[store.settings.searchEngine] || SEARCH_ENGINES.gip;
  return eng.url.replace('%s', encodeURIComponent(q));
}

/* ------------------------------------------------------------------ */
/* Téléchargements                                                     */
/* ------------------------------------------------------------------ */

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let p = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

function handleDownload(item, wc, isPrivate) {
  const id = uid(6);
  const savePath = uniquePath(app.getPath('downloads'), item.getFilename().replace(/[\\/:*?"<>|]/g, '_') || 'telechargement');
  item.setSavePath(savePath);
  const info = () => ({
    id, name: path.basename(item.getSavePath() || savePath), url: item.getURL(), path: item.getSavePath() || savePath,
    total: item.getTotalBytes(), received: item.getReceivedBytes(), state: item.getState(), paused: item.isPaused(),
    date: item.getStartTime() * 1000 || Date.now(), private: isPrivate
  });
  downloads.set(id, item);
  broadcast('download:update', info());
  let last = 0;
  item.on('updated', () => {
    const t = Date.now();
    if (t - last > 200) { last = t; broadcast('download:update', info()); }
  });
  item.once('done', (e, state) => {
    const i = info();
    i.state = state;
    downloads.delete(id);
    broadcast('download:update', i);
    if (!isPrivate && store.loggedIn && !store.isGuest()) {
      store.update((d) => { d.downloads.unshift(i); d.downloads = d.downloads.slice(0, 500); }, 'downloads');
    }
  });
}

/* ------------------------------------------------------------------ */
/* Gip Search (proxy privé : aucune donnée personnelle transmise)      */
/* ------------------------------------------------------------------ */

let searchSession;
function proxySession() {
  if (!searchSession) {
    searchSession = session.fromPartition('gip-search-proxy');
    searchSession.setUserAgent(USER_AGENT);
    searchSession.webRequest.onBeforeSendHeaders((d, cb) => {
      const h = d.requestHeaders;
      for (const k of Object.keys(h)) if (/^(cookie|referer)$/i.test(k)) delete h[k];
      h['Sec-GPC'] = '1';
      cb({ requestHeaders: h });
    });
  }
  return searchSession;
}

function decodeEntities(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

async function gipSearch(q, page = 0) {
  q = String(q || '').trim();
  if (!q) return { query: q, results: [] };
  const ses = proxySession();
  const body = new URLSearchParams({ q, kl: 'fr-fr', s: String(page * 25), dc: String(page * 25 + 1) }).toString();
  const res = await ses.fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const html = await res.text();
  const results = [];
  const chunks = html.split(/<div class="result results_links/).slice(1);
  for (const chunk of chunks) {
    if (results.length >= 30) break;
    if (/result--ad/.test(chunk.slice(0, 200))) continue;
    const a = chunk.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const sn = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/);
    let href = a[1].replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href);
      if (u.hostname.endsWith('duckduckgo.com') && u.pathname.startsWith('/y.js')) continue; // annonces
      if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch { continue; }
    let host = '';
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch {}
    results.push({ url: href, title: decodeEntities(a[2]), snippet: decodeEntities(sn ? sn[1] : ''), host });
  }
  return { query: q, results, page };
}

async function suggest(q) {
  q = String(q || '').trim();
  if (!q || q.length > 200) return [];
  try {
    const res = await proxySession().fetch('https://duckduckgo.com/ac/?type=list&kl=fr-fr&q=' + encodeURIComponent(q));
    const j = await res.json();
    return Array.isArray(j) && Array.isArray(j[1]) ? j[1].slice(0, 6) : [];
  } catch { return []; }
}

/* ------------------------------------------------------------------ */
/* IPC : interface du navigateur                                       */
/* ------------------------------------------------------------------ */

function uiOnly(handler) {
  return async (e, ...args) => {
    if (!windows.has(e.sender.id)) throw new Error('Non autorisé');
    return handler(e, ...args);
  };
}

function uiState(e) {
  const entry = browserEntryFor(e.sender);
  return {
    accounts: store.listAccounts(),
    loggedIn: store.loggedIn,
    account: store.loggedIn ? store.publicAccount(store.account) : null,
    guest: store.isGuest(),
    settings: store.loggedIn ? store.settings : null,
    partition: entry.isPrivate ? entry.partition : store.partition(),
    isPrivate: entry.isPrivate,
    initialUrl: entry.initialUrl,
    engines: Object.fromEntries(Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name])),
    bookmarks: store.loggedIn ? store.data.bookmarks : [],
    unread: store.loggedIn && !store.isGuest() ? store.unreadCount() : 0,
    lastSession: store.loggedIn && !entry.isPrivate ? (store.data.lastSession || []) : [],
    platform: process.platform,
    version: app.getVersion()
  };
}

function registerUiIpc() {
  ipcMain.handle('ui:state', uiOnly((e) => uiState(e)));
  ipcMain.handle('ui:create-account', uiOnly((e, d) => { store.createAccount(d); afterAuth(e); return uiState(e); }));
  ipcMain.handle('ui:login', uiOnly((e, d) => { store.login(d.id, d.password); afterAuth(e); return uiState(e); }));
  ipcMain.handle('ui:guest', uiOnly((e) => { store.loginGuest(); afterAuth(e); return uiState(e); }));
  ipcMain.handle('ui:lock', uiOnly(() => { lockAll(); return true; }));

  ipcMain.handle('ui:window', uiOnly((e, action) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    else if (action === 'new') createWindow();
    else if (action === 'private') createWindow({ isPrivate: true });
    else if (action === 'quit') app.quit();
    return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
  }));

  ipcMain.handle('ui:resolve', uiOnly((e, input) => resolveInput(input)));
  ipcMain.handle('ui:suggest', uiOnly(async (e, q) => {
    const entry = browserEntryFor(e.sender);
    const ql = String(q).toLowerCase();
    const local = [];
    if (store.loggedIn) {
      for (const b of store.data.bookmarks) if ((b.title + ' ' + b.url).toLowerCase().includes(ql)) local.push({ type: 'bookmark', title: b.title, url: b.url });
      const seen = new Set(local.map((x) => x.url));
      for (const h of store.data.history) {
        if (local.length >= 6) break;
        if (seen.has(h.url)) continue;
        if ((h.title + ' ' + h.url).toLowerCase().includes(ql)) { local.push({ type: 'history', title: h.title, url: h.url }); seen.add(h.url); }
      }
    }
    const remote = entry.isPrivate ? [] : await suggest(q);
    return { local: local.slice(0, 6), remote: remote.map((s) => ({ type: 'search', title: s, url: searchUrl(s) })) };
  }));

  ipcMain.handle('ui:history-add', uiOnly((e, { url, title, favicon }) => {
    const entry = browserEntryFor(e.sender);
    if (entry.isPrivate || !store.loggedIn || !store.settings.saveHistory) return;
    if (!url || url.startsWith('gip://error') || url.startsWith('about:')) return;
    store.update((d) => {
      const last = d.history[0];
      if (last && last.url === url) { last.title = title || last.title; last.favicon = favicon || last.favicon; last.date = Date.now(); return; }
      d.history.unshift({ id: uid(6), url, title: title || url, favicon: favicon || null, date: Date.now() });
      if (d.history.length > 20000) d.history.length = 20000;
    }, 'history');
  }));
  ipcMain.handle('ui:history-title', uiOnly((e, { url, title, favicon }) => {
    if (!store.loggedIn || browserEntryFor(e.sender).isPrivate) return;
    const h = store.data.history.find((x) => x.url === url);
    if (h) { if (title) h.title = title; if (favicon) h.favicon = favicon; store.scheduleSave(); }
  }));

  ipcMain.handle('ui:bookmark-toggle', uiOnly((e, { url, title, favicon }) => {
    if (!store.loggedIn) return false;
    let added = false;
    store.update((d) => {
      const i = d.bookmarks.findIndex((b) => b.url === url);
      if (i >= 0) d.bookmarks.splice(i, 1);
      else { d.bookmarks.push({ id: uid(6), url, title: title || url, favicon: favicon || null, date: Date.now() }); added = true; }
    }, 'bookmarks');
    broadcast('bookmarks:changed', store.data.bookmarks);
    return added;
  }));

  ipcMain.handle('ui:closed-tab', uiOnly((e, action, tab) => {
    if (!store.loggedIn || browserEntryFor(e.sender).isPrivate) return null;
    if (action === 'push') { store.data.closedTabs.unshift(tab); store.data.closedTabs.length = Math.min(store.data.closedTabs.length, 25); store.scheduleSave(); return null; }
    const t = store.data.closedTabs.shift(); store.scheduleSave(); return t || null;
  }));

  ipcMain.handle('ui:session-save', uiOnly((e, tabs) => {
    if (!store.loggedIn || store.isGuest() || browserEntryFor(e.sender).isPrivate) return;
    store.data.lastSession = tabs.slice(0, 60);
    store.scheduleSave();
  }));

  ipcMain.handle('ui:permission-response', uiOnly((e, { reqId, allow, remember }) => {
    const p = pendingPermissions.get(reqId);
    if (!p) return;
    pendingPermissions.delete(reqId);
    p.callback(!!allow);
    if (remember && !p.isPrivate && store.loggedIn) {
      store.update((d) => {
        d.settings.sitePermissions[p.origin] = d.settings.sitePermissions[p.origin] || {};
        d.settings.sitePermissions[p.origin][p.permission] = allow ? 'allow' : 'deny';
      }, 'settings');
    }
  }));

  ipcMain.handle('ui:allow-http', uiOnly((e, host) => { privacy.allowHttp(host); return true; }));
  ipcMain.handle('ui:shield', uiOnly((e, wcId) => { const c = shieldCounts.get(wcId); return c ? serializeShield(c) : { ads: 0, trackers: 0, upgrades: 0, params: 0, hosts: [] }; }));
  ipcMain.handle('ui:settings-set', uiOnly((e, patch) => setSettings(patch)));
  ipcMain.handle('ui:downloads', uiOnly(() => [
    ...[...downloads.entries()].map(([id, it]) => ({ id, name: path.basename(it.getSavePath()), path: it.getSavePath(), total: it.getTotalBytes(), received: it.getReceivedBytes(), state: it.getState(), paused: it.isPaused(), url: it.getURL() })),
    ...(store.loggedIn ? store.data.downloads.slice(0, 20) : [])
  ]));
  ipcMain.handle('ui:download-action', uiOnly((e, { id, action, file }) => downloadAction(id, action, file)));
  ipcMain.handle('ui:zoom', uiOnly((e, { wcId, factor }) => { const wc = webContents.fromId(wcId); if (wc) wc.setZoomFactor(factor); }));
  ipcMain.handle('ui:clear-site-data', uiOnly(async (e, origin) => {
    const entry = browserEntryFor(e.sender);
    const ses = session.fromPartition(entry.isPrivate ? entry.partition : store.partition());
    await ses.clearStorageData({ origin });
    return true;
  }));
  ipcMain.handle('ui:open-external', uiOnly((e, url) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); }));
}

function afterAuth(e) {
  const entry = browserEntryFor(e.sender);
  prepareSession(store.partition(), { isPrivate: store.isGuest() });
  for (const [id, w] of windows) {
    if (id !== e.sender.id && !w.isPrivate && !w.win.isDestroyed()) w.win.webContents.reload();
  }
  applyTheme();
}

function lockAll() {
  store.logout();
  for (const w of windows.values()) if (!w.win.isDestroyed()) w.win.webContents.reload();
}

function applyTheme() {
  const t = store.loggedIn ? store.settings.theme : 'dark';
  nativeTheme.themeSource = t === 'light' ? 'light' : t === 'dark' ? 'dark' : 'system';
}

function setSettings(patch) {
  if (!store.loggedIn) throw new Error('Verrouillé');
  const allowed = Object.keys(store.settings);
  store.update((d) => {
    for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k) && k !== 'sitePermissions') d.settings[k] = v;
    if (patch && patch.sitePermissions && typeof patch.sitePermissions === 'object') d.settings.sitePermissions = patch.sitePermissions;
  }, 'settings');
  applyTheme();
  broadcast('settings:changed', store.settings);
  return store.settings;
}

function resolveInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^(gip|https?|file|about|data|view-source):/i.test(s)) return s;
  if (/^[a-z]+:\/\//i.test(s)) return s;
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return searchUrl(s);
}

async function downloadAction(id, action, file) {
  const it = downloads.get(id);
  if (it) {
    if (action === 'pause') it.pause();
    else if (action === 'resume') it.resume();
    else if (action === 'cancel') it.cancel();
    return true;
  }
  const rec = store.loggedIn && store.data.downloads.find((d) => d.id === id);
  const p = (rec && rec.path) || file;
  if (!p) return false;
  if (action === 'open') { const err = await shell.openPath(p); return !err; }
  if (action === 'show') { shell.showItemInFolder(p); return true; }
  if (action === 'remove' && rec) { store.update((d) => { d.downloads = d.downloads.filter((x) => x.id !== id); }, 'downloads'); return true; }
  return false;
}

/* ------------------------------------------------------------------ */
/* IPC : API des pages internes gip://                                 */
/* ------------------------------------------------------------------ */

function need() { if (!store.loggedIn) throw new Error('Gip est verrouillé'); return store.data; }
function needAccount() { need(); if (store.isGuest()) throw new Error('Cette fonction nécessite un compte Gip (mode invité)'); return store.data; }

function genPassword({ length = 20, upper = true, lower = true, digits = true, symbols = true } = {}) {
  let chars = '';
  if (lower) chars += 'abcdefghijkmnopqrstuvwxyz';
  if (upper) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  if (digits) chars += '23456789';
  if (symbols) chars += '!@#$%^&*()-_=+[]{};:,.?/';
  if (!chars) chars = 'abcdefghijkmnopqrstuvwxyz';
  length = Math.max(6, Math.min(128, length | 0));
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

const API = {
  'app.info': () => ({
    version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    v8: process.versions.v8, platform: process.platform, arch: process.arch, adRules: AD_COUNT, trackerRules: TRACKER_COUNT,
    engines: Object.fromEntries(Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name]))
  }),
  'account.get': () => ({ account: store.loggedIn ? store.publicAccount(store.account) : null, guest: store.isGuest(), address: store.loggedIn ? store.account.handle + '@gip.local' : null, accounts: store.listAccounts() }),
  'account.update': (p) => { const a = store.updateAccount(p); broadcast('account:changed', a); return a; },
  'account.changePassword': ({ oldPassword, newPassword }) => { store.changePassword(oldPassword, newPassword); return true; },
  'account.delete': async ({ password }) => {
    const id = store.deleteAccount(password);
    await session.fromPartition('persist:gip-' + id).clearStorageData().catch(() => {});
    setTimeout(() => lockAll(), 50);
    return true;
  },
  'account.lock': () => { setTimeout(lockAll, 50); return true; },
  'account.export': async () => {
    const d = needAccount();
    const r = await dialog.showSaveDialog({ defaultPath: 'gip-export-' + store.account.handle + '.json' });
    if (r.canceled) return false;
    const { keys, ...rest } = d;
    fs.writeFileSync(r.filePath, JSON.stringify(rest, null, 2));
    return true;
  },

  'settings.get': () => store.settings,
  'settings.set': (patch) => setSettings(patch),

  'history.list': ({ q = '', limit = 300, offset = 0 } = {}) => {
    const d = need();
    const ql = q.toLowerCase();
    const list = ql ? d.history.filter((h) => (h.title + ' ' + h.url).toLowerCase().includes(ql)) : d.history;
    return { total: list.length, items: list.slice(offset, offset + limit) };
  },
  'history.delete': (ids) => { store.update((d) => { const s = new Set([].concat(ids)); d.history = d.history.filter((h) => !s.has(h.id)); }, 'history'); return true; },
  'history.clear': ({ since = 0 } = {}) => { store.update((d) => { d.history = since ? d.history.filter((h) => h.date < since) : []; }, 'history'); return true; },

  'bookmarks.list': () => need().bookmarks,
  'bookmarks.add': ({ url, title }) => { store.update((d) => { if (!d.bookmarks.some((b) => b.url === url)) d.bookmarks.push({ id: uid(6), url, title: title || url, date: Date.now() }); }, 'bookmarks'); broadcast('bookmarks:changed', store.data.bookmarks); return store.data.bookmarks; },
  'bookmarks.update': ({ id, url, title }) => { store.update((d) => { const b = d.bookmarks.find((x) => x.id === id); if (b) { if (url) b.url = url; if (title) b.title = title; } }, 'bookmarks'); broadcast('bookmarks:changed', store.data.bookmarks); return store.data.bookmarks; },
  'bookmarks.remove': (id) => { store.update((d) => { d.bookmarks = d.bookmarks.filter((b) => b.id !== id); }, 'bookmarks'); broadcast('bookmarks:changed', store.data.bookmarks); return store.data.bookmarks; },
  'bookmarks.move': ({ id, to }) => { store.update((d) => { const i = d.bookmarks.findIndex((b) => b.id === id); if (i < 0) return; const [b] = d.bookmarks.splice(i, 1); d.bookmarks.splice(Math.max(0, Math.min(to, d.bookmarks.length)), 0, b); }, 'bookmarks'); broadcast('bookmarks:changed', store.data.bookmarks); return store.data.bookmarks; },

  'speedDial.get': () => need().speedDial,
  'speedDial.set': (list) => { store.update((d) => { d.speedDial = (list || []).slice(0, 24).map((x) => ({ title: String(x.title || '').slice(0, 60), url: String(x.url || '') })); }, 'speedDial'); return store.data.speedDial; },

  'downloads.list': () => need().downloads,
  'downloads.action': ({ id, action }) => downloadAction(id, action),
  'downloads.clear': () => { store.update((d) => { d.downloads = []; }, 'downloads'); return true; },

  'notes.list': () => need().notes,
  'notes.save': (note) => {
    let saved;
    store.update((d) => {
      const n = d.notes.find((x) => x.id === note.id);
      const clean = { title: String(note.title || '').slice(0, 300), body: String(note.body || '').slice(0, 500000), color: note.color || '#7c5cff', pinned: !!note.pinned, tags: Array.isArray(note.tags) ? note.tags.slice(0, 20) : [] };
      if (n) { Object.assign(n, clean, { date: Date.now() }); saved = n; } else { saved = { id: uid(6), ...clean, date: Date.now() }; d.notes.unshift(saved); }
    }, 'notes');
    return saved;
  },
  'notes.delete': (id) => { store.update((d) => { d.notes = d.notes.filter((n) => n.id !== id); }, 'notes'); return true; },

  'vault.list': () => needAccount().vault,
  'vault.save': (item) => {
    needAccount();
    let saved;
    store.update((d) => {
      const clean = { site: String(item.site || '').slice(0, 300), username: String(item.username || '').slice(0, 300), password: String(item.password || '').slice(0, 1000), notes: String(item.notes || '').slice(0, 5000), totp: String(item.totp || '').slice(0, 200) };
      const v = d.vault.find((x) => x.id === item.id);
      if (v) { Object.assign(v, clean, { updated: Date.now() }); saved = v; } else { saved = { id: uid(6), ...clean, created: Date.now(), updated: Date.now() }; d.vault.unshift(saved); }
    }, 'vault');
    return saved;
  },
  'vault.delete': (id) => { store.update((d) => { d.vault = d.vault.filter((v) => v.id !== id); }, 'vault'); return true; },
  'vault.generate': (opts) => genPassword(opts),
  'vault.copy': (text) => { clipboard.writeText(String(text)); setTimeout(() => { if (clipboard.readText() === String(text)) clipboard.clear(); }, 30000); return true; },
  'vault.breachCheck': async (password) => {
    // k-anonymat : seuls les 5 premiers caractères du SHA-1 quittent l'appareil
    const h = crypto.createHash('sha1').update(String(password)).digest('hex').toUpperCase();
    try {
      const res = await proxySession().fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { headers: { 'Add-Padding': 'true' } });
      const txt = await res.text();
      const line = txt.split('\n').find((l) => l.startsWith(h.slice(5)));
      return { checked: true, count: line ? parseInt(line.split(':')[1], 10) || 0 : 0 };
    } catch { return { checked: false, count: 0 }; }
  },

  'mail.inbox': () => { needAccount(); return store.inbox(); },
  'mail.sent': () => needAccount().mail.sent,
  'mail.send': (m) => { const id = store.sendMail(m); broadcast('mail:new', {}); return id; },
  'mail.read': (id) => { store.markRead(id); broadcast('mail:new', {}); return true; },
  'mail.delete': (id) => { store.deleteMail(id); broadcast('mail:new', {}); return true; },
  'mail.directory': () => store.directory(),
  'mail.unread': () => (store.loggedIn ? store.unreadCount() : 0),

  'drive.list': () => ({ files: needAccount().drive, usage: store.driveUsage() }),
  'drive.upload': (f) => store.driveUpload(f),
  'drive.delete': (id) => { store.driveDelete(id); return true; },
  'drive.rename': ({ id, name }) => { store.driveRename(id, name); return true; },
  'drive.preview': (id) => {
    const { meta, bytes } = store.driveRead(id);
    if (bytes.length > 25 * 1024 * 1024) return null;
    return { type: meta.type, name: meta.name, dataUrl: 'data:' + meta.type + ';base64,' + bytes.toString('base64') };
  },
  'drive.save': async (id) => {
    const { meta, bytes } = store.driveRead(id);
    const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('downloads'), meta.name) });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, bytes);
    return true;
  },

  'agenda.list': () => need().events,
  'agenda.save': (ev) => {
    let saved;
    store.update((d) => {
      const clean = { title: String(ev.title || 'Événement').slice(0, 200), date: String(ev.date || ''), time: String(ev.time || ''), notes: String(ev.notes || '').slice(0, 5000), color: ev.color || '#7c5cff' };
      const x = d.events.find((e) => e.id === ev.id);
      if (x) { Object.assign(x, clean); saved = x; } else { saved = { id: uid(6), ...clean }; d.events.push(saved); }
    }, 'events');
    return saved;
  },
  'agenda.delete': (id) => { store.update((d) => { d.events = d.events.filter((e) => e.id !== id); }, 'events'); return true; },

  'privacy.stats': () => ({ stats: need().stats, settings: store.settings, sitePermissions: store.settings.sitePermissions }),
  'privacy.clear': async ({ types = [] } = {}) => {
    need();
    const ses = session.fromPartition(store.partition());
    const storages = [];
    if (types.includes('cookies')) storages.push('cookies');
    if (types.includes('storage')) storages.push('localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem');
    if (storages.length) await ses.clearStorageData({ storages });
    if (types.includes('cache')) await ses.clearCache();
    if (types.includes('history')) store.update((d) => { d.history = []; d.closedTabs = []; }, 'history');
    if (types.includes('downloads')) store.update((d) => { d.downloads = []; }, 'downloads');
    if (types.includes('permissions')) store.update((d) => { d.settings.sitePermissions = {}; }, 'settings');
    return true;
  },
  'privacy.allowHttp': (host) => { privacy.allowHttp(String(host)); return true; },
  'privacy.resetStats': () => { store.update((d) => { d.stats = { blockedTotal: 0, upgradedTotal: 0, cookiesBlockedTotal: 0, paramsStripped: 0 }; }, 'stats'); return true; },

  'search.query': ({ q, page }) => gipSearch(q, page),
  'search.suggest': (q) => suggest(q),
  'search.engines': () => Object.fromEntries(Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name])),
  'search.external': ({ engine, q }) => (SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo).url.replace('%s', encodeURIComponent(q)),

  'home.summary': () => {
    const d = need();
    const today = new Date().toISOString().slice(0, 10);
    return {
      account: store.publicAccount(store.account),
      guest: store.isGuest(),
      speedDial: d.speedDial,
      stats: d.stats,
      settings: d.settings,
      unread: store.isGuest() ? 0 : store.unreadCount(),
      notes: d.notes.filter((n) => n.pinned).slice(0, 3),
      events: d.events.filter((e) => e.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 4),
      recent: d.history.slice(0, 6)
    };
  }
};

function registerInternalIpc() {
  ipcMain.handle('gip:api', async (e, method, arg) => {
    let url = '';
    try { url = e.senderFrame ? e.senderFrame.url : e.sender.getURL(); } catch {}
    if (!url.startsWith('gip:')) throw new Error('Accès refusé');
    const fn = API[method];
    if (!fn) throw new Error('Méthode inconnue : ' + method);
    return fn(arg);
  });
  ipcMain.on('gip:privacy-config', (e) => {
    const s = store && store.loggedIn ? store.settings : { fingerprintProtection: true };
    e.returnValue = { fingerprintProtection: !!s.fingerprintProtection, seed: crypto.randomInt(1, 2 ** 31) };
  });
}

/* ------------------------------------------------------------------ */
/* Cycle de vie                                                        */
/* ------------------------------------------------------------------ */

app.on('second-instance', () => {
  const w = [...windows.values()].find((x) => !x.isPrivate);
  if (w) { if (w.win.isMinimized()) w.win.restore(); w.win.focus(); } else createWindow();
});

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
  ]) : null);
  registerUiIpc();
  registerInternalIpc();
  session.defaultSession.setPermissionRequestHandler((wc, p, cb) => cb(false));
  if (fs.existsSync(ICON) && process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(ICON));
  store.onChange((what) => {
    if (what === 'mail' || what === 'login') broadcast('mail:unread', store.loggedIn && !store.isGuest() ? store.unreadCount() : 0);
  });
  createWindow();
  app.on('activate', () => { if (!windows.size) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting || !store || !store.loggedIn) return;
  if (store.settings.clearOnExit) {
    e.preventDefault();
    quitting = true;
    try {
      await session.fromPartition(store.partition()).clearStorageData();
      store.update((d) => { d.history = []; d.closedTabs = []; d.lastSession = []; });
    } catch {}
    store.flush();
    app.quit();
    return;
  }
  store.flush();
});
