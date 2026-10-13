'use strict';
/**
 * Preload de chaque onglet.
 * - Pages internes gip:// : expose l'API `window.gip` (services, comptes…).
 * - Sites web : protection contre l'empreinte numérique (fingerprinting).
 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const isInternal = location.protocol === 'gip:';

if (isInternal) {
  const listeners = new Map();
  ipcRenderer.on('gip:event', (e, { channel, payload }) => {
    for (const fn of listeners.get(channel) || []) { try { fn(payload); } catch (err) { console.error(err); } }
  });
  contextBridge.exposeInMainWorld('gip', {
    call: (method, arg) => ipcRenderer.invoke('gip:api', method, arg),
    on: (channel, fn) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(fn);
      return () => listeners.get(channel).delete(fn);
    }
  });
} else if (/^https?:$/.test(location.protocol)) {
  let cfg = { fingerprintProtection: true, seed: 1 };
  try { cfg = ipcRenderer.sendSync('gip:privacy-config'); } catch {}
  if (cfg.fingerprintProtection) {
    // Exécuté dans le monde de la page, avant ses scripts.
    webFrame.executeJavaScript(`(() => {
      const seed = ${Number(cfg.seed) | 0};
      let s = seed;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const def = (obj, prop, value) => { try { Object.defineProperty(obj, prop, { get: () => value, configurable: true }); } catch (e) {} };
      def(Navigator.prototype, 'hardwareConcurrency', 4);
      def(Navigator.prototype, 'deviceMemory', 8);
      def(Navigator.prototype, 'webdriver', false);
      try { delete Navigator.prototype.getBattery; } catch (e) {}
      // Bruit léger et stable par session sur la lecture des canvas
      const noisify = (canvas) => {
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) return;
          const w = Math.min(canvas.width, 16), h = Math.min(canvas.height, 16);
          const img = ctx.getImageData(0, 0, w, h);
          for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i] ^ (rnd() > 0.5 ? 1 : 0);
          ctx.putImageData(img, 0, 0);
        } catch (e) {}
      };
      const toDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...a) { noisify(this); return toDataURL.apply(this, a); };
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...a) { noisify(this); return toBlob.apply(this, a); };
      // Masque le fabricant de la carte graphique
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        const gp = C.prototype.getParameter;
        C.prototype.getParameter = function (p) {
          if (p === 37445) return 'Gip';
          if (p === 37446) return 'Gip Renderer';
          return gp.call(this, p);
        };
      }
      // Bruit sur l'empreinte audio
      if (window.AudioBuffer) {
        const gcd = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (...a) {
          const d = gcd.apply(this, a);
          if (!this.__gip) { this.__gip = 1; for (let i = 0; i < d.length; i += 100) d[i] += (rnd() - 0.5) * 1e-7; }
          return d;
        };
      }
    })();`).catch(() => {});
  }
}
