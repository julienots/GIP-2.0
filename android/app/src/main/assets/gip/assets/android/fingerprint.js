(() => {
  if (location.hostname === 'gip.internal' || !/^https?:$/.test(location.protocol)) return;
  let s = __SEED__;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const def = (o, p, v) => { try { Object.defineProperty(o, p, { get: () => v, configurable: true }); } catch (e) {} };
  def(Navigator.prototype, 'hardwareConcurrency', 4);
  def(Navigator.prototype, 'deviceMemory', 4);
  def(Navigator.prototype, 'globalPrivacyControl', true);
  try { delete Navigator.prototype.getBattery; } catch (e) {}
  const noisify = (c) => { try { const x = c.getContext('2d'); if (!x || !c.width || !c.height) return; const w = Math.min(c.width, 16), h = Math.min(c.height, 16); const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) d.data[i] ^= rnd() > 0.5 ? 1 : 0; x.putImageData(d, 0, 0); } catch (e) {} };
  const tdu = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { noisify(this); return tdu.apply(this, a); };
  const tb = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (...a) { noisify(this); return tb.apply(this, a); };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const gp = C.prototype.getParameter;
    C.prototype.getParameter = function (p) { if (p === 37445) return 'Gip'; if (p === 37446) return 'Gip Renderer'; return gp.call(this, p); };
  }
})();
