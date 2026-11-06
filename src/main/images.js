'use strict';
/**
 * Gip Images — recherche d'images, de vidéos et d'actualités multi-sources.
 *
 * Toutes les requêtes passent par la session proxy de Gip Search (sans
 * cookies ni Referer). Plusieurs sources sont interrogées en parallèle puis
 * fusionnées et dédoublonnées :
 *   - DuckDuckGo Images (index Bing)          — web entier
 *   - Bing Images                             — web entier, filtres avancés
 *   - Openverse                               — images libres de droits
 *   - Wikimedia Commons                       — photothèque libre
 *
 * Le filtre de contenu (SafeSearch) est réglable : « strict », « moderate »
 * ou « off » (aucun filtre, tous les résultats sont accessibles).
 */

const SAFE = new Set(['strict', 'moderate', 'off']);
const PER_SOURCE = 50;

function normSafe(s) { return SAFE.has(s) ? s : 'moderate'; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }
function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

async function getText(ses, url, headers = {}) {
  const res = await ses.fetch(url, { headers: { accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...headers } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}
async function getJSON(ses, url, headers = {}) {
  const t = await getText(ses, url, { accept: 'application/json', ...headers });
  return JSON.parse(t);
}

/* ------------------------------------------------------------------ */
/* DuckDuckGo (jeton vqd + endpoints i.js / v.js / news.js)            */
/* ------------------------------------------------------------------ */

const vqdCache = new Map(); // q -> { vqd, t }
async function ddgVqd(ses, q, safe) {
  const key = safe + '|' + q;
  const c = vqdCache.get(key);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.vqd;
  const kp = safe === 'strict' ? '1' : safe === 'off' ? '-2' : '-1';
  const html = await getText(ses, 'https://duckduckgo.com/?' + new URLSearchParams({ q, iax: 'images', ia: 'images', kp }).toString());
  const m = html.match(/vqd=["']([\d-]+)["']/) || html.match(/vqd=([\d-]+)&/) || html.match(/"vqd":"([\d-]+)"/);
  if (!m) throw new Error('Jeton DuckDuckGo introuvable');
  vqdCache.set(key, { vqd: m[1], t: Date.now() });
  if (vqdCache.size > 200) vqdCache.delete(vqdCache.keys().next().value);
  return m[1];
}

function ddgFilters(f = {}) {
  const parts = [
    'size:' + ({ small: 'Small', medium: 'Medium', large: 'Large', wallpaper: 'Wallpaper' }[f.size] || ''),
    'color:' + ({ color: 'color', mono: 'Monochrome', red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', brown: 'Brown', black: 'Black', gray: 'Gray', teal: 'Teal', white: 'White' }[f.color] || ''),
    'type:' + ({ photo: 'photo', clipart: 'clipart', gif: 'gif', transparent: 'transparent', line: 'line' }[f.type] || ''),
    'layout:' + ({ square: 'Square', wide: 'Wide', tall: 'Tall' }[f.layout] || ''),
    'license:' + ({ any: 'Any', public: 'Public', share: 'Share', modify: 'Modify', commercial: 'ModifyCommercially' }[f.license] || '')
  ];
  return parts.join(',');
}

async function ddgImages(ses, q, page, safe, filters) {
  const vqd = await ddgVqd(ses, q, safe);
  const p = safe === 'strict' ? '1' : '-1';
  const params = new URLSearchParams({ l: 'fr-fr', o: 'json', q, vqd, f: ddgFilters(filters), p, s: String(page * 100) });
  const j = await getJSON(ses, 'https://duckduckgo.com/i.js?' + params.toString(), { 'x-gip-referer': 'https://duckduckgo.com/' });
  return (j.results || []).slice(0, 100).map((r) => ({
    title: decode(r.title), image: r.image, thumb: r.thumbnail || r.image, page: r.url,
    width: r.width || 0, height: r.height || 0, source: hostOf(r.url), provider: 'DuckDuckGo'
  }));
}

async function ddgVideos(ses, q, page, safe) {
  const vqd = await ddgVqd(ses, q, safe);
  const p = safe === 'strict' ? '1' : '-1';
  const params = new URLSearchParams({ l: 'fr-fr', o: 'json', q, vqd, f: ',,,', p, s: String(page * 60) });
  const j = await getJSON(ses, 'https://duckduckgo.com/v.js?' + params.toString(), { 'x-gip-referer': 'https://duckduckgo.com/' });
  return (j.results || []).map((r) => ({
    title: decode(r.title), url: r.content, description: decode(r.description),
    thumb: (r.images && (r.images.large || r.images.medium || r.images.small)) || '',
    duration: r.duration || '', publisher: r.publisher || hostOf(r.content), uploader: r.uploader || '',
    published: r.published || '', views: (r.statistics && r.statistics.viewCount) || null
  }));
}

async function ddgNews(ses, q, page, safe) {
  const vqd = await ddgVqd(ses, q, safe);
  const p = safe === 'strict' ? '1' : '-1';
  const params = new URLSearchParams({ l: 'fr-fr', o: 'json', noamp: '1', q, vqd, p, s: String(page * 30) });
  const j = await getJSON(ses, 'https://duckduckgo.com/news.js?' + params.toString(), { 'x-gip-referer': 'https://duckduckgo.com/' });
  return (j.results || []).map((r) => ({
    title: decode(r.title), url: r.url, excerpt: decode(r.excerpt), source: r.source || hostOf(r.url),
    date: r.date ? r.date * 1000 : null, image: r.image || ''
  }));
}

/* ------------------------------------------------------------------ */
/* Bing Images (HTML asynchrone, métadonnées JSON dans l'attribut m)   */
/* ------------------------------------------------------------------ */

function bingQualifiers(f = {}) {
  const q = [];
  const size = { small: 'filterui:imagesize-small', medium: 'filterui:imagesize-medium', large: 'filterui:imagesize-large', wallpaper: 'filterui:imagesize-wallpaper' }[f.size];
  const type = { photo: 'filterui:photo-photo', clipart: 'filterui:photo-clipart', gif: 'filterui:photo-animatedgif', transparent: 'filterui:photo-transparent', line: 'filterui:photo-linedrawing' }[f.type];
  const layout = { square: 'filterui:aspect-square', wide: 'filterui:aspect-wide', tall: 'filterui:aspect-tall' }[f.layout];
  const color = f.color === 'mono' ? 'filterui:color2-bw' : f.color === 'color' ? 'filterui:color2-color' : f.color ? 'filterui:color2-FGcls_' + f.color.toUpperCase() : null;
  const license = { any: 'filterui:licenseType-Any', public: 'filterui:license-L1', share: 'filterui:license-L2_L3_L4_L5_L6_L7', modify: 'filterui:license-L2_L3_L4', commercial: 'filterui:license-L2_L3' }[f.license];
  for (const x of [size, type, layout, color, license]) if (x) q.push(x);
  return q.join('+');
}

async function bingImages(ses, q, page, safe, filters) {
  const adlt = safe === 'strict' ? 'strict' : safe === 'off' ? 'off' : 'moderate';
  const params = new URLSearchParams({ q, first: String(page * PER_SOURCE + 1), count: String(PER_SOURCE), adlt, mmasync: '1' });
  const qft = bingQualifiers(filters);
  let url = 'https://www.bing.com/images/async?' + params.toString();
  if (qft) url += '&qft=' + qft.split('+').map((x) => '+' + encodeURIComponent(x)).join('');
  // Le cookie SRCHHPGUSR porte la préférence SafeSearch ; aucun autre cookie n'est envoyé.
  const html = await getText(ses, url, { 'x-gip-cookie': 'SRCHHPGUSR=ADLT=' + adlt.toUpperCase() });
  const out = [];
  const re = /class="iusc"[^>]*\sm="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) && out.length < PER_SOURCE) {
    try {
      const meta = JSON.parse(decode(m[1]).replace(/\\\//g, '/'));
      if (!meta.murl) continue;
      const dims = html.slice(m.index, m.index + 4000).match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/);
      out.push({
        title: decode(meta.t || meta.desc || ''), image: meta.murl, thumb: meta.turl || meta.murl, page: meta.purl || meta.murl,
        width: dims ? +dims[1] : 0, height: dims ? +dims[2] : 0, source: hostOf(meta.purl || meta.murl), provider: 'Bing'
      });
    } catch {}
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Openverse & Wikimedia Commons (images libres)                       */
/* ------------------------------------------------------------------ */

async function openverse(ses, q, page, safe, filters) {
  const params = new URLSearchParams({ q, page: String(page + 1), page_size: String(PER_SOURCE), mature: safe === 'off' ? 'true' : 'false' });
  if (filters && filters.license === 'commercial') params.set('license_type', 'commercial');
  if (filters && filters.license === 'modify') params.set('license_type', 'modification');
  if (filters && filters.layout) params.set('aspect_ratio', filters.layout);
  if (filters && filters.size && filters.size !== 'wallpaper') params.set('size', filters.size);
  const j = await getJSON(ses, 'https://api.openverse.org/v1/images/?' + params.toString());
  return (j.results || []).map((r) => ({
    title: decode(r.title), image: r.url, thumb: r.thumbnail || r.url, page: r.foreign_landing_url || r.url,
    width: r.width || 0, height: r.height || 0, source: r.source || hostOf(r.foreign_landing_url), provider: 'Openverse',
    license: r.license ? ('CC ' + String(r.license).toUpperCase() + (r.license_version ? ' ' + r.license_version : '')) : '', creator: r.creator || ''
  }));
}

async function commons(ses, q, page) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrsearch: 'filetype:bitmap|drawing ' + q, gsrnamespace: '6',
    gsrlimit: String(PER_SOURCE), gsroffset: String(page * PER_SOURCE), prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '480', iiextmetadatafilter: 'LicenseShortName|Artist', origin: '*'
  });
  const j = await getJSON(ses, 'https://commons.wikimedia.org/w/api.php?' + params.toString());
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.filter((p) => p.imageinfo && p.imageinfo[0] && /^image\//.test(p.imageinfo[0].mime)).map((p) => {
    const ii = p.imageinfo[0];
    const md = ii.extmetadata || {};
    return {
      title: decode(String(p.title || '').replace(/^File:|^Fichier:/, '').replace(/\.[a-z0-9]+$/i, '')), image: ii.url, thumb: ii.thumburl || ii.url,
      page: ii.descriptionurl, width: ii.width || 0, height: ii.height || 0, source: 'commons.wikimedia.org', provider: 'Wikimedia',
      license: md.LicenseShortName ? decode(md.LicenseShortName.value) : '', creator: md.Artist ? decode(md.Artist.value) : ''
    };
  });
}

const IMAGE_SOURCES = { ddg: ddgImages, bing: bingImages, openverse, commons };
const SOURCE_NAMES = { ddg: 'DuckDuckGo', bing: 'Bing', openverse: 'Openverse', commons: 'Wikimedia Commons' };

/** Recherche d'images agrégée. sources : liste de clés de IMAGE_SOURCES ('all' = toutes). */
async function searchImages(ses, { q, page = 0, safe = 'moderate', filters = {}, sources = ['all'] } = {}) {
  q = String(q || '').trim();
  if (!q) return { query: q, results: [], sources: {} };
  safe = normSafe(safe);
  let keys = Array.isArray(sources) && !sources.includes('all') ? sources.filter((k) => IMAGE_SOURCES[k]) : Object.keys(IMAGE_SOURCES);
  // Les sources libres n'ont pas de filtre de couleur/type : on les ignore si ces filtres sont actifs.
  if (filters.color || filters.type === 'gif' || filters.type === 'transparent' || filters.type === 'clipart' || filters.type === 'line') keys = keys.filter((k) => k === 'ddg' || k === 'bing');
  if (!keys.length) keys = ['ddg', 'bing'];
  const settled = await Promise.allSettled(keys.map((k) => IMAGE_SOURCES[k](ses, q, page, safe, filters)));
  const status = {};
  const lists = [];
  settled.forEach((r, i) => {
    const k = keys[i];
    if (r.status === 'fulfilled') { status[k] = { ok: true, count: r.value.length, name: SOURCE_NAMES[k] }; lists.push(r.value); }
    else status[k] = { ok: false, error: String(r.reason && r.reason.message || r.reason), name: SOURCE_NAMES[k] };
  });
  // Fusion entrelacée + dédoublonnage par URL d'image
  const seen = new Set();
  const results = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const it = l[i];
      if (!it || !it.image || !/^https?:/i.test(it.image)) continue;
      const key = it.image.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(it);
    }
  }
  if (!results.length && Object.values(status).every((s) => !s.ok)) throw new Error('Toutes les sources d\'images sont injoignables');
  return { query: q, page, safe, results, sources: status };
}

async function searchVideos(ses, { q, page = 0, safe = 'moderate' } = {}) {
  q = String(q || '').trim();
  if (!q) return { query: q, results: [] };
  return { query: q, page, results: await ddgVideos(ses, q, page, normSafe(safe)) };
}

async function searchNews(ses, { q, page = 0, safe = 'moderate' } = {}) {
  q = String(q || '').trim();
  if (!q) return { query: q, results: [] };
  return { query: q, page, results: await ddgNews(ses, q, page, normSafe(safe)) };
}

module.exports = { searchImages, searchVideos, searchNews, SOURCE_NAMES, normSafe };
