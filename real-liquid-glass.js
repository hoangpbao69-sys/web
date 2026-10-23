/*!
 * real-liquid-glass.js
 * ------------------------------------------------------------------
 * Hiệu ứng "Liquid Glass" ĐÚNG NGHĨA (có khúc xạ/bo cong ở viền), dùng
 * kỹ thuật SVG <feImage> + <feDisplacementMap> — cùng kỹ thuật mà các
 * bản recreate nổi tiếng của Liquid Glass (iOS 26) trên web đang dùng.
 *
 * Khác với "backdrop-filter: blur()" đơn thuần (chỉ làm mờ nền, KHÔNG
 * có độ cong/khúc xạ ánh sáng ở viền — đây là lý do bản cũ của bạn
 * "chưa thực sự giống"), engine này:
 *   1) Vẽ một bản đồ dịch chuyển (displacement map) cho từng phần tử,
 *      dựa trên khoảng cách có dấu tới viền bo góc (rounded-rect SDF).
 *   2) Dùng bản đồ đó làm feDisplacementMap để "bẻ cong" nội dung phía
 *      sau ngay tại viền kính (giống thấu kính lồi ở mép), phần giữa
 *      giữ nguyên (trong như kính thật).
 *   3) Gắn filter đó vào backdrop-filter của phần tử cùng với
 *      blur/saturate/brightness/contrast hiện có.
 *
 * Cách dùng: xem phần "// ==== TÍCH HỢP ====" ở cuối file, hoặc gọi:
 *
 *   RealLiquidGlass.enable([
 *     'nav', '.card', '.tool-panel', '.login-box', ...
 *   ]);
 *   RealLiquidGlass.disable();
 *
 * Engine tự cập nhật khi phần tử đổi kích thước (ResizeObserver) và tự
 * áp dụng cho phần tử mới sinh ra sau này (posts/cards render động).
 * ------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  // ---------- Toán học cho biên dạng viền bo góc (SDF) ----------
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function smoothStep(a, b, t) {
    if (a === b) return t < a ? 0 : 1;
    t = clamp01((t - a) / (b - a));
    return t * t * (3 - 2 * t);
  }
  // Khoảng cách có dấu từ điểm (x,y, gốc ở tâm) tới viền hình chữ nhật
  // bo góc bán kính r, nửa-rộng hw, nửa-cao hh. <0 = ở trong, 0 = trên viền.
  function roundedRectSDF(x, y, hw, hh, r) {
    r = Math.min(r, Math.min(hw, hh));
    const qx = Math.abs(x) - hw + r;
    const qy = Math.abs(y) - hh + r;
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
    return Math.min(Math.max(qx, qy), 0) + Math.sqrt(ax * ax + ay * ay) - r;
  }

  function readRadiusPx(el, w, h) {
    const cs = getComputedStyle(el);
    const raw = cs.borderTopLeftRadius || cs.borderRadius || '0px';
    let v = parseFloat(raw) || 0;
    if (raw.indexOf('%') !== -1) v = (v / 100) * Math.min(w, h);
    return Math.max(0, Math.min(v, Math.min(w, h) / 2));
  }

  // ---------- Quản lý phần tử SVG dùng chung ----------
  let svgHost = null, defsEl = null;
  function ensureHost() {
    if (svgHost) return;
    svgHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgHost.setAttribute('width', '0');
    svgHost.setAttribute('height', '0');
    svgHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svgHost.appendChild(defsEl);
    document.body.appendChild(svgHost);
  }

  let uidCounter = 0;
  const state = new WeakMap(); // element -> { id, filter, feImage, feDisp, canvas, ctx, ro, prevBackdrop }
  let activeSelectors = [];
  let activeOptions = {};
  let mutationObserver = null;
  let winResizeTimer = null;

  const DEFAULTS = {
    sampleRes: 46,        // độ phân giải lưới tính displacement map (thấp để nhẹ, SVG tự làm mượt khi phóng to)
    depthRatio: 0.22,     // bề dày vùng "bẻ cong" ở viền, tính theo % cạnh ngắn hơn
    depthMin: 7, depthMax: 30,
    lensRatio: 0.85,      // độ mạnh của độ lồi thấu kính (0..1.2)
    blur: 0.6,            // blur phụ rất nhẹ (độ nét chủ yếu tới từ chính displacement)
    saturate: 1.55,
    brightness: 1.06,
    contrast: 1.1,
  };

  function computeDisplacement(el, s, opts) {
    const w = Math.round(el.clientWidth);
    const h = Math.round(el.clientHeight);
    if (w < 4 || h < 4) return null;

    const radius = readRadiusPx(el, w, h);
    const minSide = Math.min(w, h);
    const depth = Math.max(opts.depthMin, Math.min(opts.depthMax, minSide * opts.depthRatio));

    const gw = Math.max(8, Math.min(opts.sampleRes, w));
    const gh = Math.max(8, Math.min(opts.sampleRes, h));
    s.canvas.width = gw;
    s.canvas.height = gh;

    const img = s.ctx.createImageData(gw, gh);
    const data = img.data;
    const hw = w / 2, hh = h / 2;
    let maxScale = 0;
    const raw = new Float32Array(gw * gh * 2);
    let k = 0;
    for (let j = 0; j < gh; j++) {
      const py = (j / (gh - 1)) * h;
      const iy = py - hh;
      for (let i = 0; i < gw; i++) {
        const px = (i / (gw - 1)) * w;
        const ix = px - hw;
        const dist = roundedRectSDF(ix, iy, hw, hh, radius);
        // 0 ở trong (không lệch), tiến dần về 1 khi ra ngoài viền -> tạo hiệu ứng "hút" vào tâm ở mép kính
        const edge = smoothStep(0, depth, dist);
        const bulge = smoothStep(0, 1, edge) * opts.lensRatio;
        const dx = -ix * bulge;
        const dy = -iy * bulge;
        raw[k] = dx; raw[k + 1] = dy;
        if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx);
        if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy);
        k += 2;
      }
    }
    maxScale = Math.max(maxScale, 1);

    let idx = 0, p = 0;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const dx = raw[p++], dy = raw[p++];
        data[idx] = ((dx / maxScale) * 0.5 + 0.5) * 255;
        data[idx + 1] = ((dy / maxScale) * 0.5 + 0.5) * 255;
        data[idx + 2] = 128;
        data[idx + 3] = 255;
        idx += 4;
      }
    }
    s.ctx.putImageData(img, 0, 0);

    return { w, h, scale: maxScale, dataURL: s.canvas.toDataURL() };
  }

  function ensureState(el) {
    let s = state.get(el);
    if (s) return s;
    ensureHost();
    const id = 'rlg' + (uidCounter++);
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
    feImage.setAttribute('result', 'rlgmap');
    feImage.setAttribute('preserveAspectRatio', 'none');

    const feDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDisp.setAttribute('in', 'SourceGraphic');
    feDisp.setAttribute('in2', 'rlgmap');
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');

    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    defsEl.appendChild(filter);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    s = { id, filter, feImage, feDisp, canvas, ctx, ro: null, prevBackdrop: null, prevWebkit: null };
    state.set(el, s);
    return s;
  }

  function renderOne(el, opts) {
    const s = ensureState(el);
    const d = computeDisplacement(el, s, opts);
    if (!d) return;

    s.filter.setAttribute('x', '0');
    s.filter.setAttribute('y', '0');
    s.filter.setAttribute('width', String(d.w));
    s.filter.setAttribute('height', String(d.h));

    s.feImage.setAttribute('x', '0');
    s.feImage.setAttribute('y', '0');
    s.feImage.setAttribute('width', String(d.w));
    s.feImage.setAttribute('height', String(d.h));
    s.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', d.dataURL);
    s.feImage.setAttribute('href', d.dataURL);

    s.feDisp.setAttribute('scale', String(d.scale));

    if (s.prevBackdrop === null) {
      s.prevBackdrop = el.style.backdropFilter || '';
      s.prevWebkit = el.style.webkitBackdropFilter || '';
    }
    const chain =
      'url(#' + s.id + ') ' +
      'blur(' + opts.blur + 'px) ' +
      'saturate(' + opts.saturate + ') ' +
      'brightness(' + opts.brightness + ') ' +
      'contrast(' + opts.contrast + ')';
    el.style.setProperty('backdrop-filter', chain);
    el.style.setProperty('-webkit-backdrop-filter', chain);
    el.setAttribute('data-real-liquid-glass', '1');

    if (!s.ro && 'ResizeObserver' in global) {
      s.ro = new ResizeObserver(() => scheduleRender(el, opts));
      s.ro.observe(el);
    }
  }

  const pending = new Map();
  function scheduleRender(el, opts) {
    if (pending.has(el)) return;
    pending.set(el, true);
    requestAnimationFrame(() => {
      pending.delete(el);
      if (document.body.classList.contains('liquid-glass') || document.body.getAttribute('data-rlg-force') === '1') {
        renderOne(el, opts);
      }
    });
  }

  function collect(selectors) {
    const set = new Set();
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) { set.add(el); });
    });
    return Array.from(set);
  }

  function enable(selectors, options) {
    activeSelectors = selectors || activeSelectors;
    activeOptions = Object.assign({}, DEFAULTS, options || {});
    const els = collect(activeSelectors);
    els.forEach(function (el) { renderOne(el, activeOptions); });

    if (!mutationObserver) {
      mutationObserver = new MutationObserver(function (mutList) {
        let found = false;
        mutList.forEach(function (m) {
          m.addedNodes && m.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            activeSelectors.forEach(function (sel) {
              if (node.matches && node.matches(sel)) { found = true; scheduleRender(node, activeOptions); }
              node.querySelectorAll && node.querySelectorAll(sel).forEach(function (child) {
                found = true; scheduleRender(child, activeOptions);
              });
            });
          });
        });
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (!global.__rlgResizeBound) {
      global.__rlgResizeBound = true;
      window.addEventListener('resize', function () {
        clearTimeout(winResizeTimer);
        winResizeTimer = setTimeout(function () {
          collect(activeSelectors).forEach(function (el) { scheduleRender(el, activeOptions); });
        }, 120);
      });
    }
  }

  function disable() {
    collect(activeSelectors).forEach(function (el) {
      const s = state.get(el);
      if (!s) return;
      if (s.prevBackdrop !== null) {
        if (s.prevBackdrop) el.style.setProperty('backdrop-filter', s.prevBackdrop);
        else el.style.removeProperty('backdrop-filter');
        if (s.prevWebkit) el.style.setProperty('-webkit-backdrop-filter', s.prevWebkit);
        else el.style.removeProperty('-webkit-backdrop-filter');
      }
      el.removeAttribute('data-real-liquid-glass');
    });
  }

  function refresh() {
    collect(activeSelectors).forEach(function (el) { scheduleRender(el, activeOptions); });
  }

  global.RealLiquidGlass = { enable: enable, disable: disable, refresh: refresh };
})(window);
