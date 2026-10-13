'use strict';
/**
 * Bouclier Gip : bloque pubs & traqueurs, force HTTPS, retire les paramètres
 * de pistage, bloque les cookies tiers, envoie Global Privacy Control.
 */
const { webContents } = require('electron');
const { classify, siteOf, TRACKING_PARAMS } = require('./blocklist');

const SKIP_PROTOCOLS = new Set(['gip:', 'devtools:', 'chrome-extension:', 'file:', 'data:', 'blob:', 'about:', 'chrome:']);
const httpExceptions = new Set();

function isLocalHost(h) {
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[');
}

function topSiteFor(details) {
  try {
    if (details.resourceType === 'mainFrame') return null;
    const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : null;
    const top = wc && !wc.isDestroyed() ? wc.getURL() : details.referrer;
    if (!top) return null;
    const u = new URL(top);
    if (u.protocol === 'gip:') return 'gip';
    return siteOf(u.hostname);
  } catch { return null; }
}

function isThirdParty(details) {
  const top = topSiteFor(details);
  if (!top) return false;
  try { return siteOf(new URL(details.url).hostname) !== top; } catch { return false; }
}

/**
 * @param {Electron.Session} ses
 * @param {{ settings: () => object, onBlocked: (wcId:number, info:object) => void, stat: (key:string) => void }} ctx
 */
function attach(ses, ctx) {
  ses.webRequest.onBeforeRequest((details, cb) => {
    let url;
    try { url = new URL(details.url); } catch { return cb({}); }
    if (SKIP_PROTOCOLS.has(url.protocol)) return cb({});
    const s = ctx.settings();
    const isFrame = details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';

    // 1. HTTPS partout
    if (s.httpsOnly && url.protocol === 'http:' && details.resourceType === 'mainFrame'
        && !isLocalHost(url.hostname) && !httpExceptions.has(url.hostname)) {
      url.protocol = 'https:';
      ctx.stat('upgradedTotal');
      ctx.onBlocked(details.webContentsId, { kind: 'upgrade', url: details.url });
      return cb({ redirectURL: url.toString() });
    }

    // 2. Paramètres de pistage
    if (s.stripTrackingParams && isFrame && url.search) {
      let changed = false;
      for (const p of TRACKING_PARAMS) {
        if (url.searchParams.has(p)) { url.searchParams.delete(p); changed = true; }
      }
      if (changed) {
        ctx.stat('paramsStripped');
        ctx.onBlocked(details.webContentsId, { kind: 'param', url: details.url });
        return cb({ redirectURL: url.toString() });
      }
    }

    // 3. Pubs & traqueurs (uniquement tiers)
    if (details.resourceType !== 'mainFrame') {
      const kind = classify(url.hostname);
      if (kind && ((kind === 'ad' && s.blockAds) || (kind === 'tracker' && s.blockTrackers))) {
        const top = topSiteFor(details);
        if (top !== siteOf(url.hostname)) {
          ctx.stat('blockedTotal');
          ctx.onBlocked(details.webContentsId, { kind, url: details.url, host: url.hostname });
          return cb({ cancel: true });
        }
      }
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const s = ctx.settings();
    const h = details.requestHeaders;
    if (s.sendGPC) { h['Sec-GPC'] = '1'; h.DNT = '1'; }
    if (details.url.startsWith('http')) {
      const third = isThirdParty(details);
      if (third && s.blockThirdPartyCookies) {
        for (const k of Object.keys(h)) if (k.toLowerCase() === 'cookie') { delete h[k]; }
      }
      // Referer réduit à l'origine pour les requêtes inter-sites
      if (third) {
        for (const k of Object.keys(h)) {
          if (k.toLowerCase() === 'referer') {
            try { h[k] = new URL(h[k]).origin + '/'; } catch { delete h[k]; }
          }
        }
      }
    }
    cb({ requestHeaders: h });
  });

  ses.webRequest.onHeadersReceived((details, cb) => {
    const s = ctx.settings();
    const h = details.responseHeaders || {};
    if (s.blockThirdPartyCookies && details.url.startsWith('http') && isThirdParty(details)) {
      let removed = false;
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'set-cookie') { delete h[k]; removed = true; }
      if (removed) ctx.stat('cookiesBlockedTotal');
    }
    cb({ responseHeaders: h });
  });
}

module.exports = {
  attach,
  allowHttp(host) { httpExceptions.add(String(host)); },
  isLocalHost
};
