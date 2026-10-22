// Injected into each page by scripts/visual-qa/run.mjs (Runtime.evaluate).
// Evaluates to an array of layout issues. Must be self-contained (no imports).
(() => {
  const issues = [];
  const vw = window.innerWidth;
  const MAX_PER_KIND = 25;
  const counts = {};
  const push = (issue) => {
    counts[issue.kind] = (counts[issue.kind] || 0) + 1;
    if (counts[issue.kind] <= MAX_PER_KIND) issues.push(issue);
  };

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth += 1) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`${part}#${CSS.escape(node.id)}`); break; }
      const classes = Array.from(node.classList).filter(c => !/[:[\]/]/.test(c)).slice(0, 2);
      if (classes.length) part += `.${classes.map(c => CSS.escape(c)).join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const snippet = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
  const rectOf = (r) => ({ x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) });

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // Excludes closed <details> content, content-visibility:hidden, visibility and opacity 0.
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
      if (node.getAttribute('aria-hidden') === 'true' && node !== el && node.classList.contains('sr-only')) return false;
    }
    // sr-only / visually hidden
    const s = getComputedStyle(el);
    if (s.position === 'absolute' && r.width <= 1 && r.height <= 1) return false;
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return false;
    return true;
  };
  const scrollsX = (el) => {
    const v = getComputedStyle(el).overflowX;
    return v === 'auto' || v === 'scroll';
  };
  const clipsX = (el) => {
    const v = getComputedStyle(el).overflowX;
    return v === 'auto' || v === 'scroll' || v === 'hidden' || v === 'clip';
  };
  const insideXContainer = (el, test) => {
    for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (test(node)) return true;
    }
    return false;
  };
  const isOffscreenUi = (el) => {
    // Drawers/toasts parked off-canvas via fixed positioning + transform are intentional.
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.position === 'fixed' && s.transform && s.transform !== 'none') return true;
    }
    return false;
  };

  // (a) page-level horizontal overflow
  const scroller = document.scrollingElement || document.documentElement;
  if (scroller.scrollWidth > vw + 1) {
    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 || r.width < 1 || r.height < 1) continue;
      if (insideXContainer(el, scrollsX) || isOffscreenUi(el)) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && parent.getBoundingClientRect().right > vw + 1) continue;
      if (!isVisible(el)) continue;
      offenders.push(el);
      if (offenders.length >= 5) break;
    }
    push({
      kind: 'horizontal-overflow', severity: 'error',
      message: `Page scrolls horizontally: scrollWidth ${scroller.scrollWidth}px > viewport ${vw}px`,
      selector: offenders.map(cssPath).join(' | ') || 'html',
      text: offenders.map(o => `${snippet(o).slice(0, 30)} (right=${Math.round(o.getBoundingClientRect().right)})`).join(' | '),
      rect: offenders[0] ? rectOf(offenders[0].getBoundingClientRect()) : null,
    });
  }

  // (b) crushed text: one or two characters per line in a narrow box
  const textElements = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.nodeValue && node.nodeValue.trim().length >= 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION'].includes(parent.tagName)) textElements.add(parent);
  }
  const range = document.createRange();
  for (const el of textElements) {
    if (!isVisible(el)) continue;
    const s = getComputedStyle(el);
    if (s.writingMode && s.writingMode.startsWith('vertical')) continue;
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none') continue;
    const fontSize = parseFloat(s.fontSize) || 16;
    const lineHeight = s.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(s.lineHeight) || fontSize * 1.2;
    const text = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    range.selectNodeContents(el);
    const tops = new Set();
    let width = 0;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 1) continue;
        tops.add(Math.round(r.top));
        width = Math.max(width, r.width);
      }
    }
    const lines = tops.size;
    if (lines < 2) continue;
    const box = el.getBoundingClientRect();
    const textHeight = lines * lineHeight;
    const charsPerLine = text.replace(/\s/g, '').length / lines;
    const narrow = width < 2.5 * fontSize;
    const tallNarrow = textHeight > 2.2 * lineHeight && box.width < 2.5 * fontSize;
    if ((narrow && charsPerLine <= 2.2) || tallNarrow) {
      push({
        kind: 'crushed-text', severity: 'error',
        message: `Text wraps ~${charsPerLine.toFixed(1)} chars/line over ${lines} lines in a ${Math.round(box.width)}px-wide box (font ${fontSize}px)`,
        selector: cssPath(el), text: text.slice(0, 40), rect: rectOf(box),
      });
    }
  }

  // (c) overlapping interactive elements, and (c2) text/badges overlapping controls
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [role="menuitem"], summary';
  const hitTestable = (el, r) => {
    const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 2, r.top + 2], [r.right - 2, r.bottom - 2]];
    return points.some(([x, y]) => {
      if (x < 0 || y < 0 || x > vw || y > window.innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return hit && (hit === el || el.contains(hit) || hit.contains(el));
    });
  };
  const controls = Array.from(document.querySelectorAll(INTERACTIVE)).filter(el => {
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    // Native inputs visually replaced by a styled label (peer/sr-only checkboxes) are skipped.
    if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type) && (Number(getComputedStyle(el).opacity) < 0.1)) return false;
    return true;
  });
  // Rect clipped by every ancestor that clips its overflow (scroll containers, overflow hidden),
  // so items scrolled out of a sidebar are not reported as overlapping what sits below it.
  const clippedRect = (el) => {
    const r = el.getBoundingClientRect();
    let left = r.left; let top = r.top; let right = r.right; let bottom = r.bottom;
    for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      const clipX = s.overflowX !== 'visible';
      const clipY = s.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const p = node.getBoundingClientRect();
      if (clipX) { left = Math.max(left, p.left); right = Math.min(right, p.right); }
      if (clipY) { top = Math.max(top, p.top); bottom = Math.min(bottom, p.bottom); }
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const controlRects = controls.map(clippedRect);
  const inFixedLayer = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const p = getComputedStyle(node).position;
      if (p === 'fixed' || p === 'sticky') return true;
    }
    return false;
  };
  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
  const intersect = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const sameControl = (a, b) => a.contains(b) || b.contains(a) || (a.closest('label') && a.closest('label') === b.closest('label'))
    || (a.id && b.tagName === 'LABEL' && b.htmlFor === a.id) || (b.id && a.tagName === 'LABEL' && a.htmlFor === b.id);
  const hitCache = new Map();
  const isHit = (i) => {
    if (!hitCache.has(i)) hitCache.set(i, hitTestable(controls[i], controlRects[i]));
    return hitCache.get(i);
  };
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const overlap = intersect(controlRects[i], controlRects[j]);
      if (!overlap) continue;
      const ratio = overlap / Math.min(area(controlRects[i]), area(controlRects[j]));
      if (ratio <= 0.2) continue;
      if (sameControl(controls[i], controls[j])) continue;
      // Inline links wrapping across lines in the same paragraph have overlapping bounding boxes
      // but disjoint line boxes; compare the actual line fragments instead.
      if (getComputedStyle(controls[i]).display === 'inline' && getComputedStyle(controls[j]).display === 'inline') {
        const fa = Array.from(controls[i].getClientRects());
        const fb = Array.from(controls[j].getClientRects());
        if (!fa.some(a => fb.some(b => intersect(a, b) > 0.2 * Math.min(area(a), area(b))))) continue;
      }
      if (!isHit(i) || !isHit(j)) continue;
      // A fixed/sticky control (floating help button, bottom nav) covering page content. The
      // screenshot is taken with the viewport grown to the full page, so this is where the
      // overlay ends up when the user scrolls to the bottom: worth a look, but not a hard error.
      const floating = inFixedLayer(controls[i]) !== inFixedLayer(controls[j]);
      push({
        kind: floating ? 'fixed-overlay-covers-control' : 'overlapping-controls', severity: floating ? 'warn' : 'error',
        message: `Interactive elements overlap by ${Math.round(ratio * 100)}% of the smaller one`,
        selector: `${cssPath(controls[i])}  ×  ${cssPath(controls[j])}`,
        text: `"${snippet(controls[i]).slice(0, 25)}" × "${snippet(controls[j]).slice(0, 25)}"`,
        rect: rectOf(controlRects[i]),
      });
    }
  }
  // (c2) leaf text boxes (status pills, labels) that intrude into a control they are not part of
  for (const el of textElements) {
    if (el.closest(INTERACTIVE) || el.closest('label') || !isVisible(el) || inFixedLayer(el)) continue;
    if (!String(el.innerText || '').trim()) continue;
    const r = clippedRect(el);
    if (area(r) < 16) continue;
    for (let i = 0; i < controls.length; i += 1) {
      const c = controls[i];
      if (c.contains(el) || el.contains(c) || inFixedLayer(c)) continue;
      // Only real buttons/inputs; big clickable cards with decorative overlays are by design.
      if (controlRects[i].height > 64 || controlRects[i].width > 360) continue;
      const overlap = intersect(r, controlRects[i]);
      if (!overlap) continue;
      const ratio = overlap / Math.min(area(r), area(controlRects[i]));
      if (ratio <= 0.2) continue;
      if (!isHit(i)) continue;
      // Ignore floating labels / placeholders positioned over their own input.
      if (c.tagName === 'INPUT' || c.tagName === 'SELECT' || c.tagName === 'TEXTAREA') {
        if (el.parentElement && el.parentElement.contains(c)) continue;
      }
      push({
        kind: 'text-overlaps-control', severity: 'warn',
        message: `Text box overlaps a control by ${Math.round(ratio * 100)}%`,
        selector: `${cssPath(el)}  ×  ${cssPath(c)}`,
        text: `"${snippet(el).slice(0, 25)}" × "${snippet(c).slice(0, 25)}"`,
        rect: rectOf(r),
      });
      break;
    }
  }

  // (d) text clipped by overflow hidden without ellipsis (warn only)
  for (const el of textElements) {
    if (!isVisible(el)) continue;
    const s = getComputedStyle(el);
    if (!(s.overflowX === 'hidden' || s.overflowX === 'clip')) continue;
    if (s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none')) continue;
    if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth < 4) continue;
    if (el.classList.contains('sr-only')) continue;
    push({
      kind: 'clipped-text', severity: 'warn',
      message: `Text clipped without ellipsis (scrollWidth ${el.scrollWidth}px > clientWidth ${el.clientWidth}px)`,
      selector: cssPath(el), text: snippet(el).slice(0, 40), rect: rectOf(el.getBoundingClientRect()),
    });
  }

  // Page state signals (helpful context in the report)
  const errorStates = Array.from(document.querySelectorAll('[role="alert"]')).filter(isVisible).map(el => snippet(el)).filter(Boolean);
  for (const text of errorStates.slice(0, 3)) {
    push({ kind: 'error-state', severity: 'warn', message: 'Visible role="alert" element', selector: '[role="alert"]', text, rect: null });
  }

  return { issues, counts, scrollWidth: scroller.scrollWidth, viewport: vw, title: document.title, url: location.href };
})()
