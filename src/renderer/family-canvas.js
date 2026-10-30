// Family trees, part 2 (part 7j): the canvas.
// Draws the selected family inside the host that part 7i left (emw.familyTree.canvas) with plain SVG.
// Nothing is stored here: members (x, gen) and links live in the store, every change is a commit,
// and this file only renders from them. View state (zoom, pan, legend filter, selection) is per
// session and is not data.
(() => {
  'use strict';
  const emw = window.emw;
  const S = emw.store;
  const ft = emw.familyTree;
  if (!ft || !ft.canvas) return;   // part 7i is not loaded, so there is nothing to draw on
  const NS = 'http://www.w3.org/2000/svg';

  // ---- geometry ------------------------------------------------------------------------------------
  const R = 28;                         // the picture circle, 56 px across
  const BAND_H = 190;                   // one generation
  const MIN_BANDS = 5;
  const SLOT = 136;                     // room one node takes in a row
  const GRID = 8;
  const PILL_Y = R + 6, PILL_H = 22;    // the name pill under the circle
  const BOTTOM = PILL_Y + PILL_H;       // lowest point of a node, from its centre
  const WORLD = 100000;                 // bands are drawn this wide each way so panning never reaches an edge
  const ZOOMS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
  const Z_MIN = 0.1, Z_MAX = 2;
  const cyOf = (gen) => gen * BAND_H + BAND_H / 2 - 12;
  const snap = (n) => Math.round(n / GRID) * GRID;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const clampGen = (g) => clamp(Math.round(Number.isFinite(g) ? g : 0), 0, S.GEN_MAX);

  // ---- small helpers -------------------------------------------------------------------------------
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const sv = (tag, attrs, cls) => {
    const n = document.createElementNS(NS, tag);
    if (cls) n.setAttribute('class', cls);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  };
  const btn = (cls, label, text) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) { b.setAttribute('aria-label', label); b.title = label; }
    return b;
  };
  const icon = (id) => {
    const s = sv('svg', { 'aria-hidden': 'true' }, 'ic');
    const u = sv('use', {});
    u.setAttribute('href', '#' + id);
    s.append(u);
    return s;
  };
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const legendKey = () => emw.book.key('familyLegend');
  const listOf = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
  const charOf = (id) => S.entity('characters', id);
  const nameOf = (id) => { const c = charOf(id); return (c && (c.name || '').trim()) || 'Unnamed character'; };
  const typeOf = (id) => S.relType(id) || S.relType(S.REL_NEUTRAL);
  const verb = (t) => (t.id === S.REL_NEUTRAL ? 'related to' : `${t.name} of`);   // "is sibling of", but "is related to"

  // ---- state (view state only) ---------------------------------------------------------------------
  let fid = '';                // the family on the canvas
  let selNode = '';
  let selLink = '';
  let focusType = '';          // legend filter: only this type is drawn at full strength
  let W = 0, H = 0;            // the canvas size
  let view = { z: 1, px: 0, py: 0 };
  let needFit = true;
  let dirty = true;
  let drag = null;             // a pointer gesture in progress: pan, node move or connect
  let tempPos = null;          // Map id -> { x, gen } while a node is being dragged
  let spaceDown = false;
  let legendOpen = true;
  let linkScope = '';          // node id whose links the arrow keys cycle through
  const views = new Map();     // family id -> { z, px, py }, for this session
  const thumbs = new Map();    // character id -> data URL ('' when none)
  const pillW = new Map();     // node id -> measured pill width

  // ---- skeleton --------------------------------------------------------------------------------------
  const live = el('div', 'ft-canvas-live');
  live.tabIndex = -1;   // so a click on the background puts the keyboard here
  const svg = sv('svg', { role: 'group', 'aria-label': 'Family tree canvas. Use Tab to move between characters.' }, 'ftc-svg');
  const world = sv('g', {}, 'ftc-world');
  const gBands = sv('g', {}, 'ftc-bands');
  const gLinks = sv('g', {}, 'ftc-links');
  const gNodes = sv('g', {}, 'ftc-nodes');
  const gTemp = sv('g', {}, 'ftc-temp');
  world.append(gBands, gLinks, gNodes, gTemp);
  svg.append(world);

  const gutter = el('div', 'ftc-gutter');
  gutter.setAttribute('aria-hidden', 'true');
  const tip = el('div', 'ftc-tip');
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;

  const addBtn = btn('ftc-add', 'Add character');
  addBtn.append(icon('i-plus'), el('span', '', 'Add character'));
  const empty = el('div', 'ftc-empty');
  const emptyMsg = el('p', 'ftc-empty-msg');
  emptyMsg.setAttribute('role', 'status');
  empty.append(emptyMsg);

  const legend = el('div', 'ftc-legend');
  const legendHead = btn('ftc-legend-head', '', '');
  legendHead.setAttribute('aria-controls', 'ftc-legend-body');
  const legendBody = el('div', 'ftc-legend-body');
  legendBody.id = 'ftc-legend-body';
  legendBody.setAttribute('role', 'group');
  legendBody.setAttribute('aria-label', 'Relationship legend');
  legend.append(legendHead, legendBody);

  const zoomBar = el('div', 'ftc-zoom');
  zoomBar.setAttribute('role', 'group');
  zoomBar.setAttribute('aria-label', 'Zoom');
  const zOut = btn('ftc-zbtn', 'Zoom out', '−');
  const zPct = btn('ftc-zpct', 'Reset zoom to 100 percent', '100%');
  const zIn = btn('ftc-zbtn', 'Zoom in', '+');
  const zFit = btn('ftc-zfit', 'Fit the whole family in view');
  zFit.append(icon('i-fit'), el('span', '', 'Fit'));
  zoomBar.append(zOut, zPct, zIn, zFit);

  const menuBtn = btn('ftc-menubtn', 'Family tree menu');
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.append(icon('i-menu'));

  live.append(svg, gutter, empty, addBtn, legend, zoomBar, menuBtn, tip);
  ft.canvas.replaceChildren(live);

  // ---- positions ---------------------------------------------------------------------------------------
  function positions(f) {
    const P = new Map();
    for (const m of f.members) {
      const t = tempPos && tempPos.get(m.id);
      const gen = clampGen(t ? t.gen : m.gen);
      P.set(m.id, { id: m.id, x: t ? t.x : m.x, gen, y: cyOf(gen) });
    }
    return P;
  }
  const halfW = (id) => Math.max(R + 6, (pillW.get(id) || 110) / 2 + 4);

  // ---- reading a link ------------------------------------------------------------------------------------
  const readLink = (l) => `${nameOf(l.from)} is ${verb(typeOf(l.type))} ${nameOf(l.to)}`;
  // How one character stands to the others, for the node's accessible name.
  function describe(f, id) {
    const phrases = new Map();
    const add = (phrase, who) => { if (!phrases.has(phrase)) phrases.set(phrase, []); phrases.get(phrase).push(nameOf(who)); };
    for (const l of f.links) {
      const t = typeOf(l.type);
      if (l.from === id) add(verb(t), l.to);
      else if (l.to === id) add(t.directed ? (t.inverse ? `${t.inverse} of` : `has ${t.name}`) : verb(t), l.from);
    }
    if (!phrases.size) return 'no relationships yet';
    return [...phrases].map(([p, who]) => `${p} ${listOf(who)}`).join('; ');
  }

  // ---- thumbnails --------------------------------------------------------------------------------------
  function loadThumb(id) {
    if (thumbs.has(id)) return Promise.resolve(thumbs.get(id));
    return Promise.resolve(emw.files.read('thumb-' + id)).then((u) => {
      const url = typeof u === 'string' && u.startsWith('data:image/') ? u : '';   // only an image data URL is ever used as one
      thumbs.set(id, url);
      return url;
    }, () => '');
  }
  function silhouette(size) {
    const s = sv('svg', { viewBox: '0 0 16 16', x: -size / 2, y: -size / 2, width: size, height: size }, 'ftc-sil');
    const sym = document.getElementById('i-person-silhouette');
    if (sym) for (const c of sym.children) s.append(c.cloneNode(true));
    return s;
  }

  // ---- line routing -----------------------------------------------------------------------------------------
  // Corners are rounded so a bus reads as one stroke. Points that repeat are dropped first.
  function roundPath(points, r = 8) {
    const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const l1 = Math.hypot(x1 - x0, y1 - y0), l2 = Math.hypot(x2 - x1, y2 - y1);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      if (rr < 0.5) { d += ` L${x1} ${y1}`; continue; }
      d += ` L${x1 + (x0 - x1) / l1 * rr} ${y1 + (y0 - y1) / l1 * rr} Q${x1} ${y1} ${x1 + (x2 - x1) / l2 * rr} ${y1 + (y2 - y1) / l2 * rr}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L${last[0]} ${last[1]}`;
  }

  // Is a vertical run at x, between two y values, clear of every node in a row strictly between two bands?
  function laneFree(P, x, genFrom, genTo, skip) {
    for (const p of P.values()) {
      if (skip.has(p.id) || p.gen <= genFrom || p.gen >= genTo) continue;
      if (Math.abs(p.x - x) < halfW(p.id) + 6) return false;
    }
    return true;
  }

  // From the lower node's top to the upper node's bottom: down, across a bus between the rows, down again.
  // When a generation is skipped the run drops through the rows in between, so it looks for a clear lane.
  function elbow(u, d, shift) {
    const sy = u.y + BOTTOM + 4, ty = d.y - R - 4;
    if (d.gen === u.gen + 1) {
      const bus = sy + (ty - sy) / 2 + shift;
      return [[u.x, sy], [u.x, bus], [d.x, bus], [d.x, ty]];
    }
    const bus = ty - 22 + shift, out = sy + 18 + shift;
    return { lane: true, bus, out, sy, ty, u, d };
  }
  function resolveElbow(P, e, skip) {
    if (Array.isArray(e)) return e;
    const { bus, out, sy, ty, u, d } = e;
    let lane = u.x;
    if (!laneFree(P, lane, u.gen, d.gen, skip)) {
      for (let k = 1; k <= 30; k++) {
        const a = u.x + k * 20, b = u.x - k * 20;
        if (laneFree(P, a, u.gen, d.gen, skip)) { lane = a; break; }
        if (laneFree(P, b, u.gen, d.gen, skip)) { lane = b; break; }
      }
    }
    return lane === u.x
      ? [[u.x, sy], [u.x, bus], [d.x, bus], [d.x, ty]]
      : [[u.x, sy], [u.x, out], [lane, out], [lane, bus], [d.x, bus], [d.x, ty]];
  }

  // Spouse, sibling and custom links run side by side between the circles. A node in the way means an arc over the row.
  function sidePoints(P, a, b, k, arc) {
    if (a.gen === b.gen) {
      const [l, r] = a.x <= b.x ? [a, b] : [b, a];
      const blocked = [...P.values()].some((p) => p.id !== a.id && p.id !== b.id && p.gen === a.gen && p.x > l.x && p.x < r.x);
      if (!blocked) {
        const dx = Math.sqrt(Math.max(1, R * R - k * k));
        return { pts: [[l.x + dx, l.y + k], [r.x - dx, r.y + k]], dir: l === a ? 1 : -1 };
      }
      const top = l.y - R - 16 - arc * 8;
      return { pts: [[l.x, l.y - R - 3], [l.x, top], [r.x, top], [r.x, r.y - R - 3]], dir: l === a ? 1 : -1 };
    }
    return null;
  }

  // Everything that has to be drawn for the links of one family.
  function linkGeometry(f, P) {
    const out = [];
    const pairs = new Map();
    for (const l of f.links) {
      if (l.type === 'parent') continue;
      const key = [l.from, l.to].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(l.id);
    }
    const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
    for (const l of f.links) {
      const a = P.get(l.from), b = P.get(l.to);
      if (!a || !b) continue;
      const t = typeOf(l.type);
      let pts = null, arrow = null;
      if (l.type === 'parent' && a.gen < b.gen) {
        const shift = ((hash(a.id) % 3) - 1) * 6;
        pts = resolveElbow(P, elbow(a, b, shift), new Set([a.id, b.id]));
      } else {
        const group = pairs.get([l.from, l.to].sort().join('|')) || [l.id];
        const i = group.indexOf(l.id);
        const k = (i - (group.length - 1) / 2) * 7;
        if (a.gen === b.gen) {
          const s = sidePoints(P, a, b, k, i);
          if (s) {
            pts = s.pts;
            // The points run left to right, so the arrow sits at the end that belongs to `to`.
            if (t.directed && l.type !== 'parent') arrow = s.dir === 1 ? { at: s.pts[s.pts.length - 1], from: s.pts[s.pts.length - 2] } : { at: s.pts[0], from: s.pts[1] };
          }
        } else {
          const [u, d] = a.y <= b.y ? [a, b] : [b, a];
          pts = resolveElbow(P, elbow(u, d, k), new Set([a.id, b.id]));
          if (t.directed) arrow = a === u ? { at: pts[pts.length - 1], from: pts[pts.length - 2] } : { at: pts[0], from: pts[1] };
        }
      }
      if (!pts) continue;
      out.push({ link: l, d: roundPath(pts), arrow, type: t });
    }
    return out;
  }
  const arrowPath = (at, from) => {
    const ang = Math.atan2(at[1] - from[1], at[0] - from[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    const p = (dx, dy) => `${at[0] + dx * c - dy * s} ${at[1] + dx * s + dy * c}`;
    return `M${p(0, 0)} L${p(-9, -4.5)} L${p(-9, 4.5)} Z`;
  };

  // ---- drawing ------------------------------------------------------------------------------------------------
  const estimate = (name) => Math.min(name.length, 18) * 7.2 + 20;

  function makeNode(m, P, f) {
    const p = P.get(m.id);
    const name = nameOf(m.id);
    const shown = name.length > 18 ? name.slice(0, 17) + '…' : name;
    const g = sv('g', { transform: `translate(${p.x} ${p.y})`, tabindex: '0', role: 'button' }, 'ftc-node');
    g.dataset.nid = m.id;
    g.setAttribute('aria-label', `${name}, ${describe(f, m.id)}`);
    g.setAttribute('aria-pressed', String(m.id === selNode));
    if (m.id === selNode) g.classList.add('sel');
    const clipId = 'ftc-clip-' + m.id.replace(/[^\w-]/g, '');
    const clip = sv('clipPath', { id: clipId });
    clip.append(sv('circle', { r: R - 1.5 }));
    g.append(
      sv('circle', { r: R + 12 }, 'ftc-hit'),
      sv('circle', { r: R + 7 }, 'ftc-drop'),
      sv('circle', { r: R + 6 }, 'ftc-sel'),
      sv('circle', { r: R }, 'ftc-face'),
      clip
    );
    const pic = sv('g', {}, 'ftc-pic');
    pic.append(silhouette(34));
    g.append(pic);
    const c = charOf(m.id);
    const useImage = (url, sync) => {
      if (!url || (!sync && !pic.isConnected)) return;   // later arrivals only matter if this node is still on screen
      const img = sv('image', { x: -R, y: -R, width: R * 2, height: R * 2, 'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice' });
      img.setAttribute('href', url);
      pic.replaceChildren(img);
    };
    if (c && c.hasThumb) {
      if (thumbs.has(m.id)) useImage(thumbs.get(m.id), true);
      else loadThumb(m.id).then((u) => useImage(u));
    }
    g.append(sv('circle', { r: R }, 'ftc-ring'));
    const w = pillW.get(m.id) || estimate(shown);
    const pill = sv('g', {}, 'ftc-pill');
    pill.append(sv('rect', { x: -w / 2, y: PILL_Y, width: w, height: PILL_H, rx: 11 }, 'ftc-pill-bg'));
    const text = sv('text', { x: 0, y: PILL_Y + PILL_H / 2 + 4.5, 'text-anchor': 'middle' }, 'ftc-name');
    text.textContent = shown;
    pill.append(text);
    const title = sv('title');
    title.textContent = name;
    g.append(pill, title);
    const handle = sv('g', { transform: `translate(${R + 4} 0)` }, 'ftc-handle');
    handle.append(sv('circle', { r: 8 }), sv('path', { d: 'M0 -3.5V3.5M-3.5 0H3.5' }));
    handle.dataset.handle = m.id;
    g.append(handle);
    return g;
  }

  function measurePills() {
    if (!W) return;
    let changed = false;
    for (const g of gNodes.children) {
      const text = g.querySelector('.ftc-name'), bg = g.querySelector('.ftc-pill-bg');
      if (!text || !bg) continue;
      let w = 0;
      try { w = text.getComputedTextLength() + 22; } catch { /* not laid out yet */ }
      if (!(w > 20)) continue;
      w = Math.ceil(w);
      if (pillW.get(g.dataset.nid) !== w) { pillW.set(g.dataset.nid, w); changed = true; }
      bg.setAttribute('x', -w / 2);
      bg.setAttribute('width', w);
    }
    return changed;
  }

  function drawLinks(f, P) {
    const nodes = [];
    for (const geo of linkGeometry(f, P)) {
      const l = geo.link;
      const g = sv('g', { tabindex: '-1', role: 'button' }, 'ftc-link');
      g.dataset.lid = l.id;
      g.style.setProperty('--lc', ft.relColor(geo.type));
      g.setAttribute('aria-label', readLink(l));
      g.setAttribute('aria-pressed', String(l.id === selLink));
      if (l.id === selLink) g.classList.add('sel');
      if (focusType && l.type !== focusType) g.classList.add('dim');
      g.append(sv('path', { d: geo.d }, 'ftc-halo'), sv('path', { d: geo.d }, 'ftc-line'));
      if (geo.arrow) g.append(sv('path', { d: arrowPath(geo.arrow.at, geo.arrow.from) }, 'ftc-arrow'));
      g.append(sv('path', { d: geo.d }, 'ftc-hitpath'));
      nodes.push(g);
    }
    gLinks.replaceChildren(...nodes);
  }

  function drawBands(count) {
    const rects = [];
    for (let i = 0; i < count; i++) rects.push(sv('rect', { x: -WORLD, y: i * BAND_H, width: WORLD * 2, height: BAND_H }, 'ftc-band ' + (i % 2 ? 'odd' : 'even')));
    gBands.replaceChildren(...rects);
    const labels = [];
    for (let i = 0; i < count; i++) { const n = el('span', 'ftc-gl', `Gen ${i + 1}`); n.dataset.band = String(i); labels.push(n); }
    gutter.replaceChildren(...labels);
  }

  function drawLegend(f) {
    legend.hidden = !f;
    if (!f) return;
    legendHead.replaceChildren(icon('i-chev'), el('span', '', 'Legend'));
    legendHead.setAttribute('aria-expanded', String(legendOpen));
    legend.classList.toggle('open', legendOpen);
    legendBody.hidden = !legendOpen;
    const rows = S.data.relationTypes.map((t) => {
      const n = f.links.filter((l) => l.type === t.id).length;
      const b = btn('ftc-leg-row', '');
      b.dataset.tid = t.id;
      b.setAttribute('aria-pressed', String(focusType === t.id));
      b.title = focusType === t.id ? 'Show every relationship again' : `Follow ${t.name} relationships only`;
      b.style.setProperty('--lc', ft.relColor(t));
      b.classList.toggle('unused', !n);
      const line = el('i', 'ftc-leg-line');
      line.setAttribute('aria-hidden', 'true');
      b.append(line, el('span', 'ftc-leg-name', cap(t.name)), el('span', 'ftc-leg-n', String(n)));
      return b;
    });
    legendBody.replaceChildren(...rows);
  }

  // The one place the canvas is rebuilt from the store.
  function render() {
    if (!ft.active() || !S.data) { dirty = true; return; }
    dirty = false;
    const f = S.family(fid);
    const had = document.activeElement && live.contains(document.activeElement) ? document.activeElement.closest('[data-nid],[data-lid],[data-tid]') : null;
    const key = had ? { n: had.dataset.nid, l: had.dataset.lid, t: had.dataset.tid } : null;
    live.classList.toggle('no-family', !f);
    addBtn.hidden = zoomBar.hidden = menuBtn.hidden = !f;
    if (!f) {
      gBands.replaceChildren(); gLinks.replaceChildren(); gNodes.replaceChildren(); gutter.replaceChildren();
      drawLegend(null);
      empty.hidden = false;
      emptyMsg.textContent = 'Add a family on the left to start a tree.';
      return;
    }
    if (selNode && !f.members.some((m) => m.id === selNode)) selNode = '';
    if (selLink && !f.links.some((l) => l.id === selLink)) selLink = '';
    const P = positions(f);
    const maxGen = f.members.reduce((n, m) => Math.max(n, P.get(m.id).gen), 0);
    drawBands(Math.min(S.GEN_MAX + 1, Math.max(MIN_BANDS, maxGen + 2)));
    drawLinks(f, P);
    gNodes.replaceChildren(...f.members.map((m) => makeNode(m, P, f)));
    if (measurePills()) { drawLinks(f, P); }
    drawLegend(f);
    live.style.setProperty('--fc', f.color);
    empty.hidden = f.members.length > 0;
    emptyMsg.textContent = 'No one is in this family yet. Add characters to start the tree.';
    if (needFit && W) { needFit = false; fitView(); } else applyView();
    if (key) {
      const target = key.n ? gNodes.querySelector(`[data-nid="${CSS.escape(key.n)}"]`)
        : key.l ? gLinks.querySelector(`[data-lid="${CSS.escape(key.l)}"]`)
          : legendBody.querySelector(`[data-tid="${CSS.escape(key.t)}"]`);
      if (target) target.focus({ preventScroll: true });
    }
  }
  const schedule = (() => { let raf = 0; return () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }; })();

  // Selection changes repaint the classes in place so a click never rebuilds the node under the pointer.
  function paintSelection() {
    for (const g of gNodes.children) { const on = g.dataset.nid === selNode; g.classList.toggle('sel', on); g.setAttribute('aria-pressed', String(on)); }
    for (const g of gLinks.children) { const on = g.dataset.lid === selLink; g.classList.toggle('sel', on); g.setAttribute('aria-pressed', String(on)); }
  }
  function select(nodeId, linkId = '') { selNode = nodeId; selLink = linkId; paintSelection(); }

  // ---- pan and zoom ----------------------------------------------------------------------------------------------------
  function applyView() {
    world.setAttribute('transform', `translate(${view.px} ${view.py}) scale(${view.z})`);
    zPct.textContent = Math.round(view.z * 100) + '%';
    zPct.setAttribute('aria-label', `Zoom ${Math.round(view.z * 100)} percent. Activate to reset to 100 percent`);
    for (const l of gutter.children) {
      const i = Number(l.dataset.band);
      const top = view.py + i * BAND_H * view.z;
      const hide = top > H || top + BAND_H * view.z < 0;
      l.hidden = hide;
      if (!hide) l.style.transform = `translateY(${Math.round(top + 8)}px)`;
    }
    if (fid) views.set(fid, { ...view });
  }
  function fitView() {
    const f = S.family(fid);
    if (!f || !W || !H) return;
    if (!f.members.length) { view = { z: 1, px: W / 2, py: H / 3 - cyOf(0) }; applyView(); return; }
    const P = positions(f);
    let x0 = Infinity, x1 = -Infinity, g0 = Infinity, g1 = -Infinity;
    for (const p of P.values()) {
      x0 = Math.min(x0, p.x - halfW(p.id)); x1 = Math.max(x1, p.x + halfW(p.id));
      g0 = Math.min(g0, p.gen); g1 = Math.max(g1, p.gen);
    }
    const LEFT = 92, TOP = 54, BOTTOM_BAR = 64;   // the generation labels, the Add button, the zoom bar
    const w = x1 - x0 + 112, h = (g1 - g0 + 1) * BAND_H;
    const z = clamp(Math.min((W - LEFT) / w, (H - TOP - BOTTOM_BAR) / h, 1), Z_MIN, 1);
    const cx = (x0 + x1) / 2;
    // The first used band starts at the top; a family that is shorter than the view leaves the space below it.
    view = { z, px: LEFT + (W - LEFT) / 2 - cx * z, py: TOP - g0 * BAND_H * z };
    applyView();
  }
  function zoomAt(nz, cx, cy) {
    nz = clamp(nz, Z_MIN, Z_MAX);
    const k = nz / view.z;
    view.px = cx - (cx - view.px) * k;
    view.py = cy - (cy - view.py) * k;
    view.z = nz;
    applyView();
  }
  function stepZoom(dir) {
    const pct = view.z * 100;
    const next = dir > 0 ? ZOOMS.find((s) => s > pct + 0.5) : [...ZOOMS].reverse().find((s) => s < pct - 0.5);
    if (next) zoomAt(next / 100, W / 2, H / 2);
  }
  const worldPoint = (clientX, clientY) => {
    const r = live.getBoundingClientRect();
    return { x: (clientX - r.left - view.px) / view.z, y: (clientY - r.top - view.py) / view.z };
  };
  // Pans just enough that a node is inside the view.
  function reveal(id) {
    const f = S.family(fid);
    const m = f && f.members.find((x) => x.id === id);
    if (!m || !W) return;
    const p = positions(f).get(id);
    const sx = view.px + p.x * view.z, sy = view.py + p.y * view.z;
    const mx = 90, my = 80;
    if (sx < mx) view.px += mx - sx; else if (sx > W - mx) view.px -= sx - (W - mx);
    if (sy < my) view.py += my - sy; else if (sy > H - 120) view.py -= sy - (H - 120);
    applyView();
  }

  live.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = live.getBoundingClientRect();
    if (e.ctrlKey) zoomAt(view.z * Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
    else { view.px -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; view.py -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; applyView(); }
  }, { passive: false });

  zIn.addEventListener('click', () => stepZoom(1));
  zOut.addEventListener('click', () => stepZoom(-1));
  zPct.addEventListener('click', () => zoomAt(1, W / 2, H / 2));
  zFit.addEventListener('click', fitView);

  // ---- adding and removing characters ----------------------------------------------------------------------------------
  async function addCharacters() {
    const f = S.family(fid);
    if (!f) return;
    const inFam = new Set(f.members.map((m) => m.id));
    const items = S.data.characters.filter((c) => !inFam.has(c.id)).map((c) => ({ id: c.id, name: (c.name || '').trim() || 'Unnamed character', short: c.short || '', hasThumb: !!c.hasThumb, aliases: c.aliases || [] }));
    if (!items.length) {
      emw.toast(S.data.characters.length ? 'Every character is already in this family.' : 'There are no characters yet. Add one on the Characters tab first.', { ms: 3500 });
      return;
    }
    const ids = await pickCharacters({ title: 'Add characters to the family', items, multi: true, okLabel: 'Add', opener: addBtn });
    if (ids && ids.length) placeNew(ids);
  }

  // The centre of the view in the first band, or one band below the selected character.
  function placeNew(ids) {
    const f = S.family(fid);
    if (!f) return;
    const P = positions(f);
    const anchor = selNode && P.get(selNode);
    const gen = anchor ? Math.min(S.GEN_MAX, anchor.gen + 1) : 0;
    const base = anchor ? anchor.x : worldPoint(live.getBoundingClientRect().left + W / 2, 0).x;
    const taken = [...P.values()].filter((p) => p.gen === gen).map((p) => p.x);
    const placed = [];
    ids.forEach((id, i) => {
      let x = snap(base + (i - (ids.length - 1) / 2) * SLOT);
      while (taken.some((t) => Math.abs(t - x) < SLOT * 0.9)) x += SLOT;
      taken.push(x);
      placed.push({ id, x, gen });
    });
    const added = S.addFamilyMembers(fid, placed) || [];
    if (!added.length) return;
    selNode = added[0];
    selLink = '';
    render();
    reveal(selNode);
    gNodes.querySelector(`[data-nid="${CSS.escape(selNode)}"]`)?.focus({ preventScroll: true });
    emw.toast(`Added ${added.length === 1 ? nameOf(added[0]) : plural(added.length, 'character')} to the family`, { action: { label: 'Undo', run: () => S.undo() } });
  }

  function removeNode(id) {
    const f = S.family(fid);
    if (!f || !f.members.some((m) => m.id === id)) return;
    const name = nameOf(id);
    S.removeFamilyMembers(fid, [id]);   // the family only; the character is never deleted from here
    if (selNode === id) selNode = '';
    emw.toast(`Removed ${name} from the family`, { action: { label: 'Undo', run: () => S.undo() } });
    live.focus({ preventScroll: true });
  }

  // ---- links -------------------------------------------------------------------------------------------------------------
  const hasLink = (f, from, to, type) => f.links.some((l) => l.type === type && ((l.from === from && l.to === to) || (!typeOf(type).directed && l.from === to && l.to === from)));

  function makeLink(from, to, type) {
    const id = S.addFamilyLink(fid, from, to, type);
    if (!id) { emw.toast('Those two already have that relationship.', { ms: 3000 }); return; }
    select('', id);
  }

  // The relationship choices for a pair, read in direction: "Corvin is parent of Vanya".
  function typeItems(a, b, x, y) {
    const f = S.family(fid);
    const items = [];
    for (const t of S.data.relationTypes) {
      items.push({ label: `${nameOf(a)} is ${verb(t)} ${nameOf(b)}`, dot: ft.relColor(t), disabled: !f || hasLink(f, a, b, t.id), run: () => makeLink(a, b, t.id) });
      if (t.directed && t.inverse && t.inverse !== t.name) {
        items.push({ label: `${nameOf(a)} is ${t.inverse} of ${nameOf(b)}`, dot: ft.relColor(t), disabled: !f || hasLink(f, b, a, t.id), run: () => makeLink(b, a, t.id) });
      }
    }
    items.push(null, {
      label: 'New relationship…',
      run: () => {
        ft.openRelationships();
        const d = document.querySelector('dialog.rel-dialog');
        // When the manager closes, offer the same pair again so the new type can be used at once.
        if (d) d.addEventListener('close', () => { if (S.family(fid) && S.family(fid).members.some((m) => m.id === a) && S.family(fid).members.some((m) => m.id === b)) typeMenu(a, b, x, y); }, { once: true });
      }
    });
    return items;
  }
  const typeMenu = (a, b, x, y) => emw.menu(x, y, typeItems(a, b, x, y));

  function linkMenu(id, x, y) {
    const f = S.family(fid);
    const l = f && f.links.find((k) => k.id === id);
    if (!l) return;
    const cur = typeOf(l.type);
    const items = S.data.relationTypes.map((t) => ({
      label: `${nameOf(l.from)} is ${verb(t)} ${nameOf(l.to)}`, dot: ft.relColor(t), checked: t.id === l.type,
      disabled: t.id !== l.type && hasLinkExcept(f, l, t.id),
      run: () => { if (t.id !== l.type && S.updateFamilyLink(fid, id, { type: t.id }) === false) emw.toast('Those two already have that relationship.', { ms: 3000 }); }
    }));
    if (cur.directed) {
      items.push(null, { label: `Swap: ${nameOf(l.to)} is ${verb(cur)} ${nameOf(l.from)}`, run: () => { if (S.updateFamilyLink(fid, id, { swap: true }) === false) emw.toast('Those two already have that relationship.', { ms: 3000 }); } });
    }
    items.push(null, { label: 'Remove relationship', danger: true, run: () => removeLink(id) });
    emw.menu(x, y, items);
  }
  const hasLinkExcept = (f, l, type) => f.links.some((k) => k.id !== l.id && k.type === type && ((k.from === l.from && k.to === l.to) || (!typeOf(type).directed && k.from === l.to && k.to === l.from)));

  function removeLink(id) {
    const f = S.family(fid);
    const l = f && f.links.find((k) => k.id === id);
    if (!l) return;
    const text = readLink(l);
    S.removeFamilyLinks(fid, [id]);
    if (selLink === id) selLink = '';
    emw.toast(`Removed “${text}”`, { action: { label: 'Undo', run: () => S.undo() } });
    live.focus({ preventScroll: true });
  }

  async function connectFrom(id, x, y) {
    const f = S.family(fid);
    if (!f) return;
    const items = f.members.filter((m) => m.id !== id).map((m) => { const c = charOf(m.id); return { id: m.id, name: nameOf(m.id), short: (c && c.short) || '', hasThumb: !!(c && c.hasThumb), aliases: (c && c.aliases) || [] }; });
    if (!items.length) { emw.toast('Add another character to the family first.', { ms: 3000 }); return; }
    const ids = await pickCharacters({ title: `Connect ${nameOf(id)} to…`, items, multi: false, opener: gNodes.querySelector(`[data-nid="${CSS.escape(id)}"]`) });
    if (ids && ids[0]) typeMenu(id, ids[0], x, y);
  }

  function nodeMenu(id, x, y) {
    const f = S.family(fid);
    if (!f) return;
    const mine = f.links.filter((l) => l.from === id || l.to === id);
    const items = [
      { label: 'Open character', run: () => emw.openEntity('characters', id) },
      { label: 'Connect to…', run: () => connectFrom(id, x, y) },
      { label: 'Relationships…', disabled: !mine.length, run: () => emw.menu(x, y, mine.slice(0, 14).map((l) => ({ label: readLink(l), dot: ft.relColor(typeOf(l.type)), run: () => { select('', l.id); linkMenu(l.id, x, y); } }))) },
      null,
      { label: 'Remove from family', danger: true, run: () => removeNode(id) }
    ];
    emw.menu(x, y, items);
  }

  // ---- the picker (add a character, or choose the other end of a connection) --------------------------------------
  function pickCharacters({ title, items, multi, okLabel = 'Add', opener }) {
    return new Promise((resolve) => {
      const dlg = el('dialog', 'ftc-picker');
      dlg.setAttribute('aria-label', title);
      const chosen = new Set();
      let result = null;
      const search = el('input');
      search.type = 'search';
      search.placeholder = 'Search characters…';
      search.spellcheck = false;
      search.setAttribute('aria-label', 'Search characters');
      const list = el('ul', 'ftc-pick-list');
      const none = el('p', 'ftc-pick-none');
      none.setAttribute('role', 'status');
      const ok = btn('primary', '', okLabel);
      const cancel = btn('quiet-btn', '', 'Cancel');
      const finish = (ids) => { result = ids; dlg.close(); };

      const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          io.unobserve(en.target);
          const id = en.target.dataset.tid;
          loadThumb(id).then((url) => {
            if (!url || !en.target.isConnected) return;
            const img = el('img');
            img.alt = '';
            img.src = url;
            en.target.replaceChildren(img);
          });
        }
      }, { root: list }) : null;

      const row = (it) => {
        const li = el('li');
        const thumb = el('span', 'ftc-pthumb');
        thumb.setAttribute('aria-hidden', 'true');
        thumb.append(icon('i-person-silhouette'));
        if (it.hasThumb) {
          thumb.dataset.tid = it.id;
          if (thumbs.get(it.id)) { const img = el('img'); img.alt = ''; img.src = thumbs.get(it.id); thumb.replaceChildren(img); } else if (io) io.observe(thumb); else loadThumb(it.id);
        }
        const text = el('span', 'ftc-ptext');
        text.append(el('span', 'ftc-pname', it.name));
        if (it.short) text.append(el('span', 'ftc-pshort', it.short));
        if (multi) {
          const lab = el('label', 'ftc-row');
          const cb = el('input');
          cb.type = 'checkbox';
          cb.checked = chosen.has(it.id);
          cb.addEventListener('change', () => { if (cb.checked) chosen.add(it.id); else chosen.delete(it.id); syncOk(); });
          lab.append(cb, thumb, text);
          li.append(lab);
        } else {
          const b = btn('ftc-row');
          b.append(thumb, text);
          b.addEventListener('click', () => finish([it.id]));
          li.append(b);
        }
        return li;
      };
      const visible = () => {
        const q = search.value.trim().toLowerCase();
        return q ? items.filter((it) => it.name.toLowerCase().includes(q) || it.short.toLowerCase().includes(q) || it.aliases.some((a) => String(a).toLowerCase().includes(q))) : items;
      };
      const syncOk = () => { ok.disabled = !chosen.size; ok.textContent = chosen.size ? `${okLabel} ${chosen.size}` : okLabel; };
      const renderList = () => {
        const shown = visible();
        list.replaceChildren(...shown.map(row));
        none.textContent = shown.length ? '' : 'No character matches that search.';
      };
      search.addEventListener('input', renderList);
      search.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('input, button')?.focus(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const first = visible()[0];
          if (multi && chosen.size) finish([...chosen]);
          else if (first) { if (multi) { chosen.add(first.id); renderList(); syncOk(); } else finish([first.id]); }
        }
      });
      list.addEventListener('keydown', (e) => {
        const rows = [...list.querySelectorAll('input, button')];
        const at = rows.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' && at >= 0) { e.preventDefault(); rows[Math.min(rows.length - 1, at + 1)].focus(); }
        else if (e.key === 'ArrowUp' && at >= 0) { e.preventDefault(); if (at === 0) search.focus(); else rows[at - 1].focus(); }
      });
      ok.addEventListener('click', () => finish([...chosen]));
      cancel.addEventListener('click', () => finish(null));
      dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
      dlg.addEventListener('close', () => {
        if (io) io.disconnect();
        dlg.remove();
        resolve(result);
        if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      });
      const foot = el('div', 'ftc-pick-foot');
      foot.append(cancel);
      if (multi) foot.append(ok);
      dlg.append(el('h2', 'ftc-pick-title', title), search, list, none, foot);
      if (multi) syncOk();
      renderList();
      document.body.append(dlg);
      dlg.showModal();
      search.focus();
    });
  }

  // ---- auto-arrange --------------------------------------------------------------------------------------------------------
  // Generations come from parent links (spouses and siblings share a band), each row is ordered by where its
  // parents are, then rows are spaced so nothing overlaps while parents sit over their children.
  function computeLayout(f) {
    const ids = f.members.map((m) => m.id);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const curX = ids.map((id) => f.members[idx.get(id)].x);
    const uf = ids.map((_, i) => i);
    const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
    const adjSp = ids.map(() => []);   // spouses, to stand next to their partner
    const adjSb = ids.map(() => []);   // siblings, in a row
    const parents = [];   // [parentIndex, childIndex]
    for (const l of f.links) {
      const a = idx.get(l.from), b = idx.get(l.to);
      if (a == null || b == null) continue;
      if (l.type === 'parent') parents.push([a, b]);
      else if (l.type === 'spouse' || l.type === 'sibling') {
        uf[find(b)] = find(a);
        const to = l.type === 'spouse' ? adjSp : adjSb;
        to[a].push(b); to[b].push(a);
      }
    }
    const classes = new Map();
    ids.forEach((_, i) => { const r = find(i); if (!classes.has(r)) classes.set(r, []); classes.get(r).push(i); });
    // Longest path from the roots, with a pass limit so a loop in the data cannot hang.
    const gen = new Map([...classes.keys()].map((r) => [r, 0]));
    const edges = parents.map(([p, c]) => [find(p), find(c)]).filter(([p, c]) => p !== c);
    for (let pass = 0; pass <= classes.size; pass++) {
      let moved = false;
      for (const [p, c] of edges) if (gen.get(c) < gen.get(p) + 1 && gen.get(p) < S.GEN_MAX) { gen.set(c, gen.get(p) + 1); moved = true; }
      if (!moved) break;
    }
    // Members of a class stay together: a partner right next to them, then the siblings in a row.
    const byX = (a, b) => curX[a] - curX[b];
    const orderIn = (members) => {
      const left = new Set(members), out = [];
      const visit = (n) => {
        if (!left.has(n)) return;
        left.delete(n);
        out.push(n);
        for (const m of adjSp[n].sort(byX)) visit(m);
        for (const m of adjSb[n].sort(byX)) visit(m);
      };
      for (const start of [...members].sort(byX)) visit(start);
      return out;
    };
    const rows = [];
    for (const [r, members] of classes) {
      const g = gen.get(r);
      (rows[g] = rows[g] || []).push({ members: orderIn(members), w: members.length * SLOT, cur: members.reduce((s, m) => s + curX[m], 0) / members.length, x: 0 });
    }
    const gap = 24;
    const pack = (units) => {   // closest positions to the wanted ones with no overlap (pool adjacent violators)
      let off = 0;
      const o = units.map((u, i) => { if (i) off += units[i - 1].w / 2 + u.w / 2 + gap; return off; });
      units.forEach((u, i) => { if (u.want == null) u.want = i ? units[i - 1].want + units[i - 1].w / 2 + u.w / 2 + gap : 0; });
      const blocks = [];
      units.forEach((u, i) => {
        blocks.push({ sum: u.want - o[i], n: 1 });
        while (blocks.length > 1) {
          const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
          if (a.sum / a.n <= b.sum / b.n) break;
          a.sum += b.sum; a.n += b.n; blocks.pop();
        }
      });
      let i = 0;
      for (const b of blocks) for (let k = 0; k < b.n; k++, i++) units[i].x = b.sum / b.n + o[i];
    };
    const xOf = new Map();
    const setX = (u) => u.members.forEach((m, k) => xOf.set(m, u.x - u.w / 2 + SLOT / 2 + k * SLOT));
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    // Top down: a row follows its parents.
    for (const units of rows) {
      if (!units) continue;
      for (const u of units) {
        const px = [];
        for (const [p, c] of parents) if (u.members.includes(c) && xOf.has(p)) px.push(xOf.get(p));
        u.key = px.length ? mean(px) : u.cur;
        u.want = px.length ? u.key : null;
      }
      units.sort((a, b) => a.key - b.key);
      pack(units);
      units.forEach(setX);
    }
    // Bottom up: parents move over their children.
    for (let g = rows.length - 2; g >= 0; g--) {
      const units = rows[g];
      if (!units) continue;
      for (const u of units) {
        const cx = [];
        for (const [p, c] of parents) if (u.members.includes(p) && xOf.has(c)) cx.push(xOf.get(c));
        u.want = cx.length ? mean(cx) : u.x;
      }
      pack(units);
      units.forEach(setX);
    }
    const all = [...xOf.values()];
    const mid = all.length ? (Math.min(...all) + Math.max(...all)) / 2 : 0;
    const out = [];
    rows.forEach((units, g) => { for (const u of units || []) for (const m of u.members) out.push({ id: ids[m], x: snap(xOf.get(m) - mid), gen: g }); });
    return out;
  }

  function autoArrange() {
    const f = S.family(fid);
    if (!f || !f.members.length) { emw.toast('Add characters to the family first.', { ms: 3000 }); return; }
    S.moveFamilyMembers(fid, computeLayout(f), undefined, 'arrange family');
    needFit = true;
    render();
    emw.toast(`Arranged ${plural(f.members.length, 'character')}`, { action: { label: 'Undo', run: () => { S.undo(); needFit = true; } } });
  }

  // ---- export as an image ----------------------------------------------------------------------------------------------------
  const COPY = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor'];
  async function exportImage() {
    const f = S.family(fid);
    if (!f) return;
    if (!f.members.length) { emw.toast('Add characters to the family first.', { ms: 3000 }); return; }
    try {
      const P = positions(f);
      let x0 = Infinity, x1 = -Infinity, g0 = Infinity, g1 = -Infinity;
      for (const p of P.values()) { x0 = Math.min(x0, p.x - halfW(p.id)); x1 = Math.max(x1, p.x + halfW(p.id)); g0 = Math.min(g0, p.gen); g1 = Math.max(g1, p.gen); }
      const pad = 48;
      const bx = x0 - pad, bw = x1 - x0 + pad * 2, by = g0 * BAND_H, bh = (g1 - g0 + 1) * BAND_H;
      // Resolve every colour on screen into the copy, so the picture reads the same wherever it is opened.
      const clone = world.cloneNode(true);
      const from = [world, ...world.querySelectorAll('*')], to = [clone, ...clone.querySelectorAll('*')];
      from.forEach((n, i) => {
        const cs = getComputedStyle(n);
        for (const prop of COPY) to[i].style.setProperty(prop, cs.getPropertyValue(prop));
      });
      clone.removeAttribute('transform');
      clone.querySelectorAll('.ftc-handle, .ftc-sel, .ftc-drop, .ftc-halo, .ftc-hit, .ftc-hitpath, .ftc-temp').forEach((n) => n.remove());
      const out = sv('svg', { width: bw, height: bh, viewBox: `${bx} ${by} ${bw} ${bh}` });
      out.append(clone);
      const xml = new XMLSerializer().serializeToString(out);
      const scale = Math.min(2, 8000 / Math.max(bw, bh), Math.sqrt(40e6 / (bw * bh)));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The picture could not be drawn')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml); });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bw * scale));
      canvas.height = Math.max(1, Math.round(bh * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(live.querySelector('.ftc-band') || live).fill || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/png');
      const res = await window.api.familyExportPng(url, `${f.name || 'Family'} family tree`);
      if (res && res.ok) emw.toast('Family tree exported', { ms: 3000 });
      else if (res && !res.canceled) emw.toast((res && res.error) || 'The family tree could not be exported.');
    } catch (err) { emw.toast((err && err.message) || 'The family tree could not be exported.'); }
  }

  // ---- pointer gestures ------------------------------------------------------------------------------------------------------------
  const rectPoint = (e) => { const r = live.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  svg.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;   // the context menu has its own handler
    hideTip();
    const target = e.target;
    const handle = target.closest && target.closest('.ftc-handle');
    const nodeEl = target.closest && target.closest('.ftc-node');
    const linkEl = target.closest && target.closest('.ftc-link');
    if (e.button === 1 || spaceDown || (!nodeEl && !linkEl)) {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: view.px, py: view.py, moved: false, bg: !nodeEl && !linkEl && e.button === 0 && !spaceDown };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('panning');
      if (e.button === 1) e.preventDefault();   // no autoscroll cursor
      return;
    }
    if (handle) {
      const id = nodeEl.dataset.nid;
      const f = S.family(fid);
      const p = f && positions(f).get(id);
      if (!p) return;
      select(id);
      drag = { kind: 'connect', id, from: p };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.nid;
      const f = S.family(fid);
      const m = f && f.members.find((x) => x.id === id);
      if (!m) return;
      select(id);
      drag = { kind: 'node', id, sx: e.clientX, sy: e.clientY, ox: m.x, ogen: m.gen, pid: e.pointerId, moved: false };
      return;
    }
    if (linkEl) select('', linkEl.dataset.lid);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      view.px = drag.px + dx; view.py = drag.py + dy;
      applyView();
    } else if (drag.kind === 'node') {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; try { svg.setPointerCapture(drag.pid); } catch { /* the pointer may be gone */ } svg.classList.add('moving'); }
      const gen = clampGen((drag.ogen * BAND_H + BAND_H / 2 + dy / view.z - BAND_H / 2) / BAND_H);
      const x = snap(drag.ox + dx / view.z);
      tempPos = new Map([[drag.id, { x, gen }]]);
      const f = S.family(fid);
      if (!f) return;
      const P = positions(f);
      const g = gNodes.querySelector(`[data-nid="${CSS.escape(drag.id)}"]`);
      if (g) g.setAttribute('transform', `translate(${P.get(drag.id).x} ${P.get(drag.id).y})`);
      drawLinks(f, P);
    } else if (drag.kind === 'connect') {
      const w = worldPoint(e.clientX, e.clientY);
      gTemp.replaceChildren(sv('path', { d: `M${drag.from.x} ${drag.from.y} L${w.x} ${w.y}` }, 'ftc-rubber'));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ftc-node');
      for (const g of gNodes.children) g.classList.toggle('drop-over', g === over && g.dataset.nid !== drag.id);
    }
  });

  function endDrag(e, cancelled) {
    const d = drag;
    drag = null;
    svg.classList.remove('panning', 'moving');
    try { svg.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!d) return;
    if (d.kind === 'pan') { if (d.bg && !d.moved && !cancelled) { select('', ''); } return; }
    if (d.kind === 'node') {
      const t = tempPos && tempPos.get(d.id);
      tempPos = null;
      if (d.moved && t && !cancelled) S.moveFamilyMembers(fid, [{ id: d.id, x: t.x, gen: t.gen }], { coalesce: `fam-move:${d.id}` });
      else if (d.moved) render();   // cancelled: put the node back
      return;   // a plain click changes nothing, so the node stays (a double-click needs the same element twice)
    }
    if (d.kind === 'connect') {
      gTemp.replaceChildren();
      for (const g of gNodes.children) g.classList.remove('drop-over');
      if (cancelled) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ftc-node');
      if (over && over.dataset.nid !== d.id) typeMenu(d.id, over.dataset.nid, e.clientX, e.clientY);
    }
  }
  svg.addEventListener('pointerup', (e) => endDrag(e, false));
  svg.addEventListener('pointercancel', (e) => endDrag(e, true));

  svg.addEventListener('dblclick', (e) => {
    const n = e.target.closest && e.target.closest('.ftc-node');
    if (n && !e.target.closest('.ftc-handle')) emw.openEntity('characters', n.dataset.nid);
  });

  svg.addEventListener('contextmenu', (e) => {
    const n = e.target.closest && e.target.closest('.ftc-node');
    const l = e.target.closest && e.target.closest('.ftc-link');
    e.preventDefault();
    if (n) { select(n.dataset.nid); nodeMenu(n.dataset.nid, e.clientX, e.clientY); }
    else if (l) { select('', l.dataset.lid); linkMenu(l.dataset.lid, e.clientX, e.clientY); }
    else emw.menu(e.clientX, e.clientY, backgroundItems());
  });

  // Hovering a line names the relationship in a pill next to the pointer.
  function hideTip() { tip.hidden = true; }
  svg.addEventListener('pointermove', (e) => {
    if (drag) return;
    const g = e.target.closest && e.target.closest('.ftc-link');
    if (!g) { hideTip(); return; }
    const f = S.family(fid);
    const l = f && f.links.find((k) => k.id === g.dataset.lid);
    if (!l) { hideTip(); return; }
    const t = typeOf(l.type);
    tip.textContent = t.directed ? `${cap(t.name)} of` : (t.id === S.REL_NEUTRAL ? 'Related' : cap(t.name));
    const p = rectPoint(e);
    tip.style.left = Math.min(W - 120, p.x + 14) + 'px';
    tip.style.top = Math.max(4, p.y - 34) + 'px';
    tip.hidden = false;
  });
  svg.addEventListener('pointerleave', hideTip);

  // ---- keyboard ----------------------------------------------------------------------------------------------------------------------------
  const menuAt = (node) => { const r = node.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom]; };
  const linksOf = (id) => [...gLinks.children].filter((g) => { const l = S.family(fid)?.links.find((k) => k.id === g.dataset.lid); return l && (l.from === id || l.to === id); });

  live.addEventListener('keydown', (e) => {
    if (emw.isTextField(e.target)) return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const inSvg = svg.contains(e.target) || e.target === live;
    if (e.code === 'Space' && plain && inSvg) { spaceDown = true; svg.classList.add('pan-ready'); }
    if (plain && (e.key === '+' || e.key === '=')) { e.preventDefault(); stepZoom(1); return; }
    if (plain && (e.key === '-' || e.key === '_')) { e.preventDefault(); stepZoom(-1); return; }
    if (plain && e.key === '0' && inSvg) { e.preventDefault(); fitView(); return; }
    if (!inSvg) return;
    const nodeEl = e.target.closest && e.target.closest('.ftc-node');
    const linkEl = e.target.closest && e.target.closest('.ftc-link');
    const menuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
    if (nodeEl) {
      const id = nodeEl.dataset.nid;
      if (e.key === 'Enter') { e.preventDefault(); emw.openEntity('characters', id); }
      else if (e.key === ' ') { e.preventDefault(); select(id); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeNode(id); }
      else if (menuKey) { e.preventDefault(); select(id); const [x, y] = menuAt(nodeEl); nodeMenu(id, x, y); }
      else if (e.key === 'Escape') { select('', ''); }
      else if ((e.key === 'l' || e.key === 'L') && plain) { const first = linksOf(id)[0]; if (first) { e.preventDefault(); linkScope = id; first.focus(); select('', first.dataset.lid); reveal(id); } }
      else if (e.key.startsWith('Arrow') && plain) {
        e.preventDefault();
        const f = S.family(fid);
        const m = f && f.members.find((x) => x.id === id);
        if (!m) return;
        const step = e.shiftKey ? GRID * 6 : GRID;
        let x = m.x, gen = m.gen;
        if (e.key === 'ArrowLeft') x -= step; else if (e.key === 'ArrowRight') x += step;
        else if (e.key === 'ArrowUp') gen -= 1; else gen += 1;
        S.moveFamilyMembers(fid, [{ id, x: snap(x), gen: clampGen(gen) }], { coalesce: `fam-move:${id}` });
        reveal(id);
      }
    } else if (linkEl) {
      const id = linkEl.dataset.lid;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLink(id); }
      else if (e.key === 'Enter' || menuKey) { e.preventDefault(); const r = linkEl.getBoundingClientRect(); linkMenu(id, r.left + r.width / 2, r.top + r.height / 2); }
      else if (e.key === 'Escape') {
        const l = S.family(fid)?.links.find((k) => k.id === id);
        const back = gNodes.querySelector(`[data-nid="${CSS.escape(linkScope || (l && l.from) || '')}"]`);
        if (back) { e.preventDefault(); back.focus(); select(back.dataset.nid, ''); }
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const set = linkScope ? linksOf(linkScope) : [...gLinks.children];
        const at = set.indexOf(linkEl);
        const next = set[(at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + set.length) % set.length];
        if (next) { next.focus(); select('', next.dataset.lid); }
      }
    } else if (e.key === 'Delete' && selNode) { e.preventDefault(); removeNode(selNode); }
    else if (e.key === 'Delete' && selLink) { e.preventDefault(); removeLink(selLink); }
  });
  live.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; svg.classList.remove('pan-ready'); } });
  window.addEventListener('blur', () => { spaceDown = false; svg.classList.remove('pan-ready'); });
  svg.addEventListener('focusin', (e) => {
    const n = e.target.closest && e.target.closest('.ftc-node');
    if (n) { linkScope = ''; if (n.matches(':focus-visible')) reveal(n.dataset.nid); }   // a click must not make the view jump
  });

  // ---- buttons and the menu ---------------------------------------------------------------------------------------------------------------
  function backgroundItems() {
    return [
      { label: 'Add character…', run: addCharacters },
      { label: 'Relationships…', run: () => ft.openRelationships() },
      { label: 'Auto-arrange', run: autoArrange },
      { label: 'Fit to view', run: fitView }
    ];
  }
  addBtn.addEventListener('click', addCharacters);
  menuBtn.addEventListener('click', () => {
    const r = menuBtn.getBoundingClientRect();
    emw.menu(r.right - 190, r.top - 140, [
      { label: 'Add character…', run: addCharacters },
      { label: 'Relationships…', run: () => ft.openRelationships() },
      { label: 'Auto-arrange', run: autoArrange },
      { label: 'Export as image…', run: exportImage }
    ]);
  });
  legendHead.addEventListener('click', () => {
    legendOpen = !legendOpen;
    lsSet(legendKey(), legendOpen ? '1' : '0');
    drawLegend(S.family(fid));
  });
  legendBody.addEventListener('click', (e) => {
    const b = e.target.closest('.ftc-leg-row');
    if (!b) return;
    focusType = focusType === b.dataset.tid ? '' : b.dataset.tid;
    drawLegend(S.family(fid));
    for (const g of gLinks.children) {
      const l = S.family(fid)?.links.find((k) => k.id === g.dataset.lid);
      g.classList.toggle('dim', !!(focusType && l && l.type !== focusType));
    }
    legendBody.querySelector(`[data-tid="${CSS.escape(b.dataset.tid)}"]`)?.focus();
  });

  // ---- following the store, the size and the family ------------------------------------------------------------------------------------------
  S.on(() => {
    if (ft.selected() !== fid) switchTo(ft.selected());
    else schedule();
  });
  function switchTo(id) {
    fid = id || '';
    selNode = ''; selLink = ''; focusType = ''; linkScope = '';
    thumbs.clear();   // a character's picture may have changed since the tree was last shown
    const saved = views.get(fid);
    if (saved) { view = { ...saved }; needFit = false; } else needFit = true;
    schedule();
  }
  ft.onSelect(switchTo);
  new ResizeObserver(() => {
    const nw = live.clientWidth, nh = live.clientHeight;
    if (nw === W && nh === H) return;
    const first = !W;
    W = nw; H = nh;
    if (first && W) { thumbs.clear(); schedule(); }
    if (dirty || needFit) schedule(); else applyView();
  }).observe(live);
  emw.onView((name) => { if (name === 'characters') { if (ft.active()) { if (ft.selected() !== fid) switchTo(ft.selected()); else schedule(); } } });
  emw.book.onSwitch(() => {
    views.clear(); thumbs.clear(); pillW.clear();
    fid = ''; selNode = ''; selLink = ''; focusType = '';
    legendOpen = lsGet(legendKey()) !== '0';
    needFit = true;
  });
  legendOpen = lsGet(legendKey()) !== '0';

  // ---- actions (menu bar and the shortcut registry) ----------------------------------------------------------------------------------------
  // Each makes sure the family tree mode is showing a family first, so the menu bar works from anywhere.
  function ensure() {
    if (!(emw.book && emw.book.id) || !S.data) return false;
    if (!ft.active()) ft.open();
    if (ft.selected() !== fid) switchTo(ft.selected());
    if (!S.family(fid)) { emw.toast('Add a family on the left first.', { ms: 3000 }); return false; }
    return true;
  }
  const act = (fn) => () => { if (ensure()) { render(); fn(); } };
  Object.assign(emw.actions, {
    familyAddCharacter: act(addCharacters),
    familyAutoArrange: act(autoArrange),
    familyExport: act(exportImage),
    familyFit: act(fitView)
  });
  const reg = (id, label) => emw.keys.register({ id, label, group: 'View', when: () => !document.querySelector('dialog[open]') });
  reg('familyAddCharacter', 'Add character to family tree');
  reg('familyAutoArrange', 'Auto-arrange family tree');
  reg('familyExport', 'Export family tree as image');
  reg('familyFit', 'Fit family tree in view');

  Object.assign(ft, { fit: fitView, arrange: autoArrange, exportImage, addCharacters });
})();
