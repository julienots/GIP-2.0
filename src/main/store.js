'use strict';
/**
 * Gip Store — comptes locaux et stockage chiffré.
 *
 * - Chaque compte possède un profil chiffré en AES-256-GCM avec une clé
 *   dérivée du mot de passe (scrypt). Sans le mot de passe, rien n'est lisible.
 * - Chaque compte possède une paire de clés X25519 : la clé publique est
 *   dans l'index des comptes, la clé privée dans le profil chiffré. Gip Mail
 *   l'utilise pour chiffrer les messages de bout en bout entre comptes.
 * - Gip Drive stocke les fichiers chiffrés avec la clé du compte.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const COLORS = ['#7c5cff', '#00c2ff', '#ff5c8a', '#ffb547', '#2ee59d', '#ff7a45', '#a259ff', '#4d7cff'];

const DEFAULT_SETTINGS = {
  searchEngine: 'gip',
  homepage: 'gip://home',
  theme: 'dark',
  accent: '#7c5cff',
  blockAds: true,
  blockTrackers: true,
  httpsOnly: true,
  sendGPC: true,
  blockThirdPartyCookies: true,
  fingerprintProtection: true,
  stripTrackingParams: true,
  clearOnExit: false,
  saveHistory: true,
  showBookmarksBar: true,
  animations: true,
  wallpaper: 'aurora',
  zoom: 1,
  sitePermissions: {}
};

function now() { return Date.now(); }
function uid(n = 12) { return crypto.randomBytes(n).toString('hex'); }

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), 32, SCRYPT);
}

function encrypt(key, buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from('GIP2'), iv, c.getAuthTag(), ct]);
}

function decrypt(key, blob) {
  if (blob.subarray(0, 4).toString() !== 'GIP2') throw new Error('Format inconnu');
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}

function writeAtomic(file, data) {
  const tmp = file + '.' + uid(4) + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function emptyProfile(account) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  return {
    version: 2,
    keys: {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
    },
    settings: { ...DEFAULT_SETTINGS, accent: account.color },
    bookmarks: [
      { id: uid(6), title: 'Gip Search', url: 'gip://search', date: now() },
      { id: uid(6), title: 'Gip Mail', url: 'gip://mail', date: now() },
      { id: uid(6), title: 'Gip Notes', url: 'gip://notes', date: now() },
      { id: uid(6), title: 'Wikipédia', url: 'https://fr.wikipedia.org', date: now() }
    ],
    speedDial: [
      { title: 'Wikipédia', url: 'https://fr.wikipedia.org' },
      { title: 'YouTube', url: 'https://www.youtube.com' },
      { title: 'GitHub', url: 'https://github.com' },
      { title: 'OpenStreetMap', url: 'https://www.openstreetmap.org' },
      { title: 'Le Monde', url: 'https://www.lemonde.fr' },
      { title: 'Météo', url: 'https://meteofrance.com' }
    ],
    history: [],
    downloads: [],
    notes: [
      {
        id: uid(6),
        title: 'Bienvenue dans Gip Notes',
        body: 'Vos notes sont chiffrées avec votre mot de passe.\nPersonne d\'autre — pas même Gip — ne peut les lire.',
        color: '#7c5cff',
        pinned: true,
        date: now()
      }
    ],
    vault: [],
    drive: [],
    mail: { sent: [], read: [], trash: [] },
    events: [],
    stats: { blockedTotal: 0, upgradedTotal: 0, cookiesBlockedTotal: 0, paramsStripped: 0 },
    closedTabs: []
  };
}

class Store {
  constructor(baseDir) {
    this.dir = path.join(baseDir, 'gip');
    this.profilesDir = path.join(this.dir, 'profiles');
    this.mailDir = path.join(this.dir, 'mail');
    this.driveDir = path.join(this.dir, 'drive');
    for (const d of [this.dir, this.profilesDir, this.mailDir, this.driveDir]) fs.mkdirSync(d, { recursive: true });
    this.indexFile = path.join(this.dir, 'accounts.json');
    this.accounts = readJSON(this.indexFile, []);
    this.session = null; // { account, key, data, guest }
    this._saveTimer = null;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(what) { for (const fn of this.listeners) { try { fn(what); } catch (e) { console.error(e); } } }

  _saveIndex() { writeAtomic(this.indexFile, JSON.stringify(this.accounts, null, 2)); }
  _profileFile(id) { return path.join(this.profilesDir, id + '.gip'); }

  publicAccount(a) {
    return { id: a.id, name: a.name, color: a.color, avatar: a.avatar || null, createdAt: a.createdAt, handle: a.handle };
  }

  listAccounts() { return this.accounts.map((a) => this.publicAccount(a)); }

  get loggedIn() { return !!this.session; }
  get data() { return this.session && this.session.data; }
  get account() { return this.session && this.session.account; }
  get settings() { return this.session ? this.session.data.settings : { ...DEFAULT_SETTINGS }; }

  partition() {
    if (!this.session) return 'gip-locked';
    if (this.session.guest) return 'gip-guest-' + this.session.guestId;
    return 'persist:gip-' + this.session.account.id;
  }

  createAccount({ name, password, color }) {
    name = String(name || '').trim().slice(0, 40);
    if (!name) throw new Error('Choisissez un nom');
    if (!password || String(password).length < 6) throw new Error('Mot de passe : 6 caractères minimum');
    const handle = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'user';
    let finalHandle = handle;
    let i = 1;
    while (this.accounts.some((a) => a.handle === finalHandle)) finalHandle = handle + (++i);
    const account = {
      id: uid(8),
      name,
      handle: finalHandle,
      color: color || COLORS[this.accounts.length % COLORS.length],
      salt: crypto.randomBytes(16).toString('base64'),
      createdAt: now()
    };
    const key = deriveKey(password, account.salt);
    const data = emptyProfile(account);
    account.publicKey = data.keys.publicKey;
    writeAtomic(this._profileFile(account.id), encrypt(key, Buffer.from(JSON.stringify(data))));
    this.accounts.push(account);
    this._saveIndex();
    this.session = { account, key, data, guest: false };
    this._emit('login');
    return this.publicAccount(account);
  }

  login(id, password) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new Error('Compte introuvable');
    const key = deriveKey(password, account.salt);
    let data;
    try {
      data = JSON.parse(decrypt(key, fs.readFileSync(this._profileFile(id))).toString('utf8'));
    } catch {
      throw new Error('Mot de passe incorrect');
    }
    data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    for (const k of Object.keys(emptyProfileShape)) if (data[k] === undefined) data[k] = structuredClone(emptyProfileShape[k]);
    this.session = { account, key, data, guest: false };
    this._emit('login');
    return this.publicAccount(account);
  }

  loginGuest() {
    const account = { id: 'guest', name: 'Invité', handle: 'invite', color: '#8a8fa3', createdAt: now() };
    const data = emptyProfile(account);
    data.settings.saveHistory = false;
    this.session = { account, key: null, data, guest: true, guestId: uid(4) };
    this._emit('login');
    return this.publicAccount(account);
  }

  logout() {
    if (!this.session) return;
    this.flush();
    this.session = null;
    this._emit('logout');
  }

  isGuest() { return !!(this.session && this.session.guest); }

  /** Modifie le profil courant puis planifie une sauvegarde chiffrée. */
  update(fn, what = 'data') {
    if (!this.session) throw new Error('Verrouillé');
    const r = fn(this.session.data);
    this.scheduleSave();
    this._emit(what);
    return r;
  }

  scheduleSave() {
    if (!this.session || this.session.guest) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this._saveTimer);
    if (!this.session || this.session.guest) return;
    const { account, key, data } = this.session;
    writeAtomic(this._profileFile(account.id), encrypt(key, Buffer.from(JSON.stringify(data))));
  }

  changePassword(oldPassword, newPassword) {
    if (!this.session || this.session.guest) throw new Error('Impossible en mode invité');
    if (!newPassword || newPassword.length < 6) throw new Error('Nouveau mot de passe trop court');
    const { account } = this.session;
    const oldKey = deriveKey(oldPassword, account.salt);
    if (!crypto.timingSafeEqual(oldKey, this.session.key)) throw new Error('Ancien mot de passe incorrect');
    const salt = crypto.randomBytes(16).toString('base64');
    const newKey = deriveKey(newPassword, salt);
    // Re-chiffre les fichiers du Drive
    const dDir = path.join(this.driveDir, account.id);
    if (fs.existsSync(dDir)) {
      for (const f of fs.readdirSync(dDir)) {
        const p = path.join(dDir, f);
        writeAtomic(p, encrypt(newKey, decrypt(oldKey, fs.readFileSync(p))));
      }
    }
    account.salt = salt;
    this.session.key = newKey;
    this._saveIndex();
    this.flush();
  }

  updateAccount({ name, color, avatar }) {
    if (!this.session || this.session.guest) throw new Error('Impossible en mode invité');
    const a = this.session.account;
    if (name) a.name = String(name).trim().slice(0, 40);
    if (color) { a.color = color; }
    if (avatar !== undefined) a.avatar = avatar;
    this._saveIndex();
    this._emit('account');
    return this.publicAccount(a);
  }

  deleteAccount(password) {
    if (!this.session || this.session.guest) throw new Error('Impossible en mode invité');
    const { account } = this.session;
    const key = deriveKey(password, account.salt);
    if (!crypto.timingSafeEqual(key, this.session.key)) throw new Error('Mot de passe incorrect');
    fs.rmSync(this._profileFile(account.id), { force: true });
    fs.rmSync(path.join(this.driveDir, account.id), { recursive: true, force: true });
    fs.rmSync(path.join(this.mailDir, account.id + '.json'), { force: true });
    this.accounts = this.accounts.filter((a) => a.id !== account.id);
    this._saveIndex();
    this.session = null;
    this._emit('logout');
    return account.id;
  }

  /* ---------------------------- Gip Mail (E2E) ---------------------------- */

  _mailbox(id) { return path.join(this.mailDir, id + '.json'); }

  directory() {
    return this.accounts.map((a) => ({ id: a.id, name: a.name, handle: a.handle, color: a.color, address: a.handle + '@gip.local' }));
  }

  sendMail({ to, subject, body }) {
    if (!this.session || this.session.guest) throw new Error('Gip Mail nécessite un compte');
    const recipients = (Array.isArray(to) ? to : String(to).split(/[,;\s]+/))
      .map((s) => s.trim().toLowerCase().replace(/@gip\.local$/, ''))
      .filter(Boolean);
    if (!recipients.length) throw new Error('Destinataire manquant');
    const targets = recipients.map((h) => {
      const acc = this.accounts.find((a) => a.handle === h || a.id === h);
      if (!acc) throw new Error('Adresse inconnue : ' + h + '@gip.local');
      return acc;
    });
    const me = this.session.account;
    const date = now();
    const payload = Buffer.from(JSON.stringify({ subject: String(subject || '(sans objet)').slice(0, 300), body: String(body || '').slice(0, 200000) }));
    const msgId = uid(10);
    for (const acc of targets) {
      const pub = crypto.createPublicKey({ key: Buffer.from(acc.publicKey, 'base64'), type: 'spki', format: 'der' });
      const eph = crypto.generateKeyPairSync('x25519');
      const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pub });
      const k = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('gip-mail-v1'), shared])).digest();
      const blob = encrypt(k, payload).toString('base64');
      const env = {
        id: msgId,
        from: me.id,
        fromName: me.name,
        fromAddress: me.handle + '@gip.local',
        to: acc.id,
        date,
        eph: eph.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        blob
      };
      const file = this._mailbox(acc.id);
      const box = readJSON(file, []);
      box.push(env);
      writeAtomic(file, JSON.stringify(box));
    }
    this.update((d) => {
      d.mail.sent.unshift({ id: msgId, to: targets.map((a) => a.handle + '@gip.local'), subject: JSON.parse(payload).subject, body: JSON.parse(payload).body, date });
    }, 'mail');
    return msgId;
  }

  inbox() {
    if (!this.session || this.session.guest) return [];
    const me = this.session.account;
    const priv = crypto.createPrivateKey({ key: Buffer.from(this.session.data.keys.privateKey, 'base64'), type: 'pkcs8', format: 'der' });
    const box = readJSON(this._mailbox(me.id), []);
    const readSet = new Set(this.session.data.mail.read);
    const out = [];
    for (const env of box) {
      try {
        const eph = crypto.createPublicKey({ key: Buffer.from(env.eph, 'base64'), type: 'spki', format: 'der' });
        const shared = crypto.diffieHellman({ privateKey: priv, publicKey: eph });
        const k = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('gip-mail-v1'), shared])).digest();
        const msg = JSON.parse(decrypt(k, Buffer.from(env.blob, 'base64')).toString('utf8'));
        out.push({ id: env.id, from: env.fromName, fromAddress: env.fromAddress, date: env.date, subject: msg.subject, body: msg.body, read: readSet.has(env.id), encrypted: true });
      } catch {
        out.push({ id: env.id, from: env.fromName, fromAddress: env.fromAddress, date: env.date, subject: '⚠ Message illisible', body: 'Impossible de déchiffrer ce message.', read: true, encrypted: false });
      }
    }
    return out.sort((a, b) => b.date - a.date);
  }

  deleteMail(id) {
    if (!this.session || this.session.guest) return;
    const file = this._mailbox(this.session.account.id);
    writeAtomic(file, JSON.stringify(readJSON(file, []).filter((m) => m.id !== id)));
    this.update((d) => { d.mail.sent = d.mail.sent.filter((m) => m.id !== id); d.mail.read = d.mail.read.filter((r) => r !== id); }, 'mail');
  }

  markRead(id) {
    this.update((d) => { if (!d.mail.read.includes(id)) d.mail.read.push(id); }, 'mail');
  }

  unreadCount() {
    try { return this.inbox().filter((m) => !m.read).length; } catch { return 0; }
  }

  /* ------------------------------ Gip Drive ------------------------------ */

  _driveDirFor() {
    const d = path.join(this.driveDir, this.session.account.id);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  driveList() { return this.session ? this.session.data.drive : []; }

  driveUpload({ name, type, bytes }) {
    if (!this.session) throw new Error('Verrouillé');
    if (this.session.guest) throw new Error('Gip Drive nécessite un compte');
    const buf = Buffer.from(bytes);
    if (buf.length > 200 * 1024 * 1024) throw new Error('Fichier trop volumineux (200 Mo max)');
    const id = uid(10);
    writeAtomic(path.join(this._driveDirFor(), id + '.bin'), encrypt(this.session.key, buf));
    const meta = { id, name: String(name).slice(0, 200), type: type || 'application/octet-stream', size: buf.length, date: now() };
    this.update((d) => d.drive.unshift(meta), 'drive');
    return meta;
  }

  driveRead(id) {
    if (!this.session || this.session.guest) throw new Error('Verrouillé');
    const meta = this.session.data.drive.find((f) => f.id === id);
    if (!meta) throw new Error('Fichier introuvable');
    return { meta, bytes: decrypt(this.session.key, fs.readFileSync(path.join(this._driveDirFor(), id + '.bin'))) };
  }

  driveDelete(id) {
    if (!this.session || this.session.guest) return;
    fs.rmSync(path.join(this._driveDirFor(), id + '.bin'), { force: true });
    this.update((d) => { d.drive = d.drive.filter((f) => f.id !== id); }, 'drive');
  }

  driveRename(id, name) {
    this.update((d) => { const f = d.drive.find((x) => x.id === id); if (f) f.name = String(name).slice(0, 200); }, 'drive');
  }

  driveUsage() {
    return (this.session ? this.session.data.drive : []).reduce((s, f) => s + f.size, 0);
  }
}

const emptyProfileShape = (() => {
  const p = emptyProfile({ color: '#7c5cff' });
  delete p.keys;
  return p;
})();

module.exports = { Store, DEFAULT_SETTINGS, COLORS, uid };
