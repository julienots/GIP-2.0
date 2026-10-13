'use strict';
/**
 * Listes intégrées du Bouclier Gip. Correspondance par suffixe de domaine :
 * "doubleclick.net" bloque aussi "ad.doubleclick.net".
 */
const ADS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
  'adnxs.com', 'adsrvr.org', 'advertising.com', 'amazon-adsystem.com', 'criteo.com', 'criteo.net',
  'taboola.com', 'outbrain.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'casalemedia.com',
  'smartadserver.com', 'adform.net', 'yieldmo.com', 'sharethrough.com', 'teads.tv', 'media.net',
  'moatads.com', 'zedo.com', 'revcontent.com', 'mgid.com', 'popads.net', 'propellerads.com',
  'adcolony.com', 'applovin.com', 'unityads.unity3d.com', 'inmobi.com', 'bidswitch.net',
  'contextweb.com', 'indexww.com', 'lijit.com', 'sovrn.com', 'spotxchange.com', '33across.com',
  'gumgum.com', 'triplelift.com', 'adsafeprotected.com', 'serving-sys.com', 'adition.com',
  'ad.gt', 'adroll.com', 'quantserve.com', 'yandexadexchange.net', 'an.yandex.ru', 'ads.yahoo.com',
  'ads.twitter.com', 'ads-api.twitter.com', 'static.ads-twitter.com', 'ads.linkedin.com',
  'ads.pinterest.com', 'adsystem.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net',
  'pagead2.googlesyndication.com', 'tpc.googlesyndication.com', 'securepubads.g.doubleclick.net'
];

const TRACKERS = [
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com', 'analytics.google.com',
  'connect.facebook.net', 'pixel.facebook.com', 'graph.facebook.com/tr', 'facebook.com/tr',
  'scorecardresearch.com', 'hotjar.com', 'hotjar.io', 'mixpanel.com', 'segment.com', 'segment.io',
  'amplitude.com', 'fullstory.com', 'mouseflow.com', 'crazyegg.com', 'clarity.ms', 'newrelic.com',
  'nr-data.net', 'chartbeat.com', 'chartbeat.net', 'kissmetrics.com', 'heap.io', 'heapanalytics.com',
  'optimizely.com', 'bluekai.com', 'krxd.net', 'exelator.com', 'demdex.net', 'omtrdc.net',
  'everesttech.net', 'rlcdn.com', 'tapad.com', 'agkn.com', 'mathtag.com', 'adsymptotic.com',
  'bat.bing.com', 'clarity.microsoft.com', 'snap.licdn.com', 'px.ads.linkedin.com', 'analytics.tiktok.com',
  'analytics.twitter.com', 'ct.pinterest.com', 'sc-static.net', 'tr.snapchat.com', 'yandex.ru/metrika',
  'mc.yandex.ru', 'mc.yandex.com', 'branch.io', 'app-measurement.com', 'adjust.com', 'appsflyer.com',
  'kochava.com', 'onesignal.com', 'pushwoosh.com', 'braze.com', 'quantcount.com', 'xiti.com',
  'atinternet.com', 'smartlook.com', 'logrocket.com', 'logrocket.io', 'inspectlet.com', 'statcounter.com',
  'matomo.cloud', 'piwik.pro', 'histats.com', 'webtrends.com', 'eulerian.net', 'cxense.com',
  'permutive.com', 'permutive.app', 'liveramp.com', 'id5-sync.com', 'zeotap.com', 'lotame.com',
  'crwdcntrl.net', 'parsely.com', 'parse.ly', 'mediamath.com', 'dotomi.com', 'coremetrics.com'
];

/** Paramètres d'URL de pistage retirés automatiquement. */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid',
  'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi', 'mkt_tok', 'oly_anon_id', 'oly_enc_id',
  'vero_id', 'rb_clickid', 's_cid', 'ref_src', '__s', 'si', 'spm'
];

function buildSet(list) {
  const set = new Set();
  for (const d of list) set.add(d.split('/')[0]);
  return set;
}

const AD_SET = buildSet(ADS);
const TRACKER_SET = buildSet(TRACKERS);

function matchSuffix(set, hostname) {
  let h = hostname;
  while (h) {
    if (set.has(h)) return true;
    const i = h.indexOf('.');
    if (i < 0) break;
    h = h.slice(i + 1);
  }
  return false;
}

/** Retourne 'ad', 'tracker' ou null. */
function classify(hostname) {
  hostname = String(hostname || '').toLowerCase();
  if (matchSuffix(AD_SET, hostname)) return 'ad';
  if (matchSuffix(TRACKER_SET, hostname)) return 'tracker';
  return null;
}

/** Approximation de l'eTLD+1 (suffisante pour distinguer premier/tiers). */
const TWO_PART_TLDS = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.jp', 'co.nz', 'com.br', 'com.mx', 'co.in', 'com.tr', 'com.cn', 'gouv.fr', 'co.za', 'com.ar']);
function siteOf(hostname) {
  const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  if (TWO_PART_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

module.exports = { classify, siteOf, TRACKING_PARAMS, AD_COUNT: AD_SET.size, TRACKER_COUNT: TRACKER_SET.size };
