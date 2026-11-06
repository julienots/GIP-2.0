/* Gip — visionneuse d'images partagée (Gip Images, galerie de page) */
'use strict';
(function () {
  const { call, esc, ico } = G;
  function lightbox(list, idx, { px = (u) => u } = {}) {
    const back = document.createElement('div');
    back.className = 'lb';
    document.body.appendChild(back);
    document.body.style.overflow = 'hidden';
    const close = () => { back.classList.add('out'); document.body.style.overflow = ''; document.removeEventListener('keydown', key); setTimeout(() => back.remove(), 220); };
    const key = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') show(idx + 1); else if (e.key === 'ArrowLeft') show(idx - 1); };
    document.addEventListener('keydown', key);
    function show(i) {
      if (i < 0 || i >= list.length) return;
      idx = i;
      const x = list[i];
      const e = encodeURIComponent(x.image);
      back.innerHTML = `<button class="lb-x icon-btn" data-a="close" title="Fermer (Échap)">${ico('x', 20)}</button>
        <button class="lb-nav prev icon-btn" data-a="prev" ${i === 0 ? 'disabled' : ''}>${ico('back', 26)}</button>
        <div class="lb-stage"><img class="lb-thumb" src="${esc(px(x.thumb))}" alt=""><img class="lb-img" src="${esc(px(x.image))}" data-raw="${esc(x.image)}" alt="${esc(x.title)}"></div>
        <button class="lb-nav next icon-btn" data-a="next" ${i === list.length - 1 ? 'disabled' : ''}>${ico('forward', 26)}</button>
        <aside class="lb-info">
          <div class="muted small">${esc(x.provider)} · ${i + 1} / ${list.length}</div>
          <h3>${esc(x.title || 'Sans titre')}</h3>
          <div class="lb-meta">${ico('globe', 14)} <a href="${esc(x.page)}">${esc(x.source)}</a></div>
          ${x.width ? `<div class="lb-meta">${ico('image', 14)} ${x.width} × ${x.height} px</div>` : ''}
          ${x.license ? `<div class="lb-meta">${ico('info', 14)} ${esc(x.license)}${x.creator ? ' — ' + esc(x.creator) : ''}</div>` : ''}
          <div class="lb-acts">
            <a class="btn primary sm" href="${esc(x.page)}">${ico('globe', 15)} Ouvrir la page</a>
            <a class="btn sm" href="${esc(x.image)}">${ico('image', 15)} Image en taille réelle</a>
            <button class="btn sm" data-a="dl">${ico('download', 15)} Télécharger</button>
            <button class="btn sm" data-a="copy">${ico('copy', 15)} Copier l'adresse</button>
          </div>
          <div class="muted small" style="margin-top:14px">Images similaires</div>
          <div class="lb-acts">
            <a class="btn sm" href="https://lens.google.com/uploadbyurl?url=${e}">Google Lens</a>
            <a class="btn sm" href="https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${e}">Bing</a>
            <a class="btn sm" href="https://yandex.com/images/search?rpt=imageview&url=${e}">Yandex</a>
            <a class="btn sm" href="https://tineye.com/search?url=${e}">TinEye</a>
          </div>
          <div class="muted small lb-keys">← → pour naviguer · Échap pour fermer</div>
        </aside>`;
      G.hydrate(back);
      const big = back.querySelector('.lb-img');
      big.onload = () => back.querySelector('.lb-stage').classList.add('ready');
      big.onerror = () => { if (big.src !== big.dataset.raw) big.src = big.dataset.raw; else back.querySelector('.lb-stage').classList.add('ready', 'fail'); };
      // Préchargement des voisines
      for (const j of [i + 1, i - 1]) if (list[j]) { const p = new Image(); p.src = px(list[j].thumb); }
    }
    back.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-a]');
      if (!b) { if (ev.target === back || ev.target.classList.contains('lb-stage')) close(); return; }
      const a = b.dataset.a;
      if (a === 'close') close();
      else if (a === 'prev') show(idx - 1);
      else if (a === 'next') show(idx + 1);
      else if (a === 'dl') { await call('download.url', list[idx].image).catch((e) => G.toast(e.message, true)); }
      else if (a === 'copy') { await call('clipboard.write', list[idx].image); G.toast('Adresse copiée'); }
    });
    show(idx);
  }

  G.lightbox = lightbox;
})();
