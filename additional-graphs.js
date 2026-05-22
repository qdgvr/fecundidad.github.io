(function () {
  const DATA_URL = 'additional-graphs-data.json';
  const NS = 'http://www.w3.org/2000/svg';
  const cyan = '#35c9ce';
  const blueC = '#79a8d9';
  const grid = 'rgba(255,255,255,.12)';
  const axis = 'rgba(255,255,255,.28)';

  function $(id) { return document.getElementById(id); }
  function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : '-'; }
  function esc(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }
  function extent(values) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return [0, 1];
    return [Math.min(...clean), Math.max(...clean)];
  }
  function padExtent([min, max], pad = .08) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (min === max) return [min - 1, max + 1];
    const d = max - min;
    return [min - d * pad, max + d * pad];
  }
  function scale(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const den = d1 - d0 || 1;
    return value => r0 + ((value - d0) / den) * (r1 - r0);
  }
  function el(name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function makeSvg(container, wide = false) {
    if (!container) return null;
    container.innerHTML = '';
    const cardWidth = container.closest('.extra-graph-card')?.clientWidth;
    const fallbackWidth = Math.min(wide ? 960 : 760, Math.max(360, Math.round(cardWidth || window.innerWidth - 44 || (wide ? 860 : 520))));
    const width = Math.max(320, Math.round(container.clientWidth || fallbackWidth));
    const height = wide ? 380 : Math.round(Math.min(320, Math.max(230, width * 0.44)));
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
    container.appendChild(svg);
    return { svg, width, height };
  }
  function addGrid(svg, xTicks, yTicks, x, y, plot) {
    yTicks.forEach(t => {
      const yy = y(t);
      svg.appendChild(el('line', { x1: plot.left, y1: yy, x2: plot.right, y2: yy, stroke: grid, 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: plot.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'extra-axis-label' }, fmt(t, 1)));
    });
    xTicks.forEach(t => {
      const xx = x(t);
      svg.appendChild(el('line', { x1: xx, y1: plot.top, x2: xx, y2: plot.bottom, stroke: 'rgba(255,255,255,.05)', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: xx, y: plot.bottom + 20, 'text-anchor': 'middle', class: 'extra-axis-label' }, Number.isInteger(t) ? String(t) : fmt(t, 1)));
    });
    svg.appendChild(el('line', { x1: plot.left, y1: plot.bottom, x2: plot.right, y2: plot.bottom, stroke: axis, 'stroke-width': 1 }));
    svg.appendChild(el('line', { x1: plot.left, y1: plot.top, x2: plot.left, y2: plot.bottom, stroke: axis, 'stroke-width': 1 }));
  }
  function linePath(points, x, y, xKey, yKey) {
    return points.map((d, i) => `${i ? 'L' : 'M'}${x(d[xKey])},${y(d[yKey])}`).join(' ');
  }

  function renderLine(containerId, rows, valueKey, yLabel, unit, color = cyan, labelPosition = 'top-right') {
    const box = makeSvg($(containerId));
    if (!box) return;
    const { svg, width, height } = box;
    const plot = { left: 58, right: width - 22, top: 24, bottom: height - 54 };
    const normalized = rows.map(d => ({ year: d.year, value: Number.isFinite(d[valueKey]) ? d[valueKey] : d.value }));
    const x = scale(extent(normalized.map(d => d.year)), [plot.left, plot.right]);
    const yDomain = padExtent(extent(normalized.map(d => d.value)), .08);
    const y = scale(yDomain, [plot.bottom, plot.top]);
    const yTicks = Array.from({ length: 5 }, (_, i) => yDomain[0] + (yDomain[1] - yDomain[0]) * i / 4);
    addGrid(svg, [2005, 2010, 2015, 2020, 2024], yTicks, x, y, plot);
    const sorted = normalized.slice().sort((a, b) => a.year - b.year);
    svg.appendChild(el('path', { d: linePath(sorted, x, y, 'year', 'value'), fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    sorted.forEach(d => svg.appendChild(el('circle', { cx: x(d.year), cy: y(d.value), r: 3.3, fill: color, stroke: '#000', 'stroke-width': 1 })));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const labelAttrs = labelPosition === 'top-left'
      ? { x: plot.left + 10, y: plot.top + 18, 'text-anchor': 'start' }
      : { x: plot.right - 10, y: plot.top + 18, 'text-anchor': 'end' };
    svg.appendChild(el('text', { ...labelAttrs, class: 'extra-value-label' }, `${fmt(first.value, 1)}${unit} → ${fmt(last.value, 1)}${unit}`));
  }

  function init(data) {
    renderLine('extra-mma-line', data.mean_maternal_age || data.annual || [], 'MeanMaternalAge', 'Edad media', ' años', '#d3d98e', 'top-left');
    renderLine('extra-firstbirth-line', data.first_birth_rate || data.annual || [], 'FirstBirthRate', 'Primeros nacimientos', '‰', blueC, 'top-right');
  }

  fetch(DATA_URL)
    .then(response => {
      if (!response.ok) throw new Error(`No se pudo cargar ${DATA_URL}`);
      return response.json();
    })
    .then(data => {
      init(data);
      let t;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => init(data), 120);
      });
    })
    .catch(error => {
      const section = $('lecturas-visuales');
      if (section) section.insertAdjacentHTML('beforeend', `<p class="extra-error">${esc(error.message)}</p>`);
    });
})();
