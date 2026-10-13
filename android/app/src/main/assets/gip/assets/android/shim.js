/* Gip 2.0 Android — pont entre les pages gip:// et le code natif (remplace le preload Electron). */
(function () {
  if (!window.GipNative) { window.__gipMissing = true; return; }
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  window.__gipResolve = (id, ok, value) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(value); else p.reject(new Error(value));
  };
  window.__gipEmit = (channel, payload) => {
    for (const fn of listeners.get(channel) || []) { try { fn(payload); } catch (e) { console.error(e); } }
  };
  function enc(v) {
    if (v instanceof ArrayBuffer) v = new Uint8Array(v);
    if (v instanceof Uint8Array) {
      let s = '';
      for (let i = 0; i < v.length; i += 0x8000) s += String.fromCharCode.apply(null, v.subarray(i, i + 0x8000));
      return { __b64: btoa(s) };
    }
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return o; }
    return v;
  }
  window.gip = {
    call(method, arg) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        // Jamais d'attente infinie : délai maximal (plus long pour le chiffrement des comptes)
        const ms = /^auth\.(login|create)|account\.(changePassword|delete)|drive\./.test(method) ? 120000 : 30000;
        const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Délai dépassé (' + method + ')')); } }, ms);
        pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        try { window.GipNative.call(method, JSON.stringify(arg === undefined ? null : enc(arg)), id); }
        catch (e) { pending.delete(id); reject(e); }
      });
    },
    on(channel, fn) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(fn);
      return () => listeners.get(channel).delete(fn);
    }
  };
  try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => window.gip.call('app.copy', String(t)) }, configurable: true }); } catch (e) {}
  document.documentElement.classList.add('android');
})();
