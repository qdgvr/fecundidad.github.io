(() => {
  'use strict';

  const api = () => window.ComunicacionCharts;
  const number = value => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
  const escapeText = value => String(value ?? '');

  const pointInArea = (area, x, y) => {
    if (area.shape === 'rect') return x >= area.x - 8 && x <= area.x + area.width + 8 && y >= area.y - 8 && y <= area.y + area.height + 8;
    if (area.shape === 'circle') return Math.hypot(x - area.x, y - area.y) <= area.radius;
    if (area.shape !== 'arc') return false;
    const distance = Math.hypot(x - area.x, y - area.y);
    if (distance < area.innerRadius || distance > area.outerRadius) return false;
    const tau = Math.PI * 2;
    const normalize = angle => (angle % tau + tau) % tau;
    const angle = normalize(Math.atan2(y - area.y, x - area.x));
    const start = normalize(area.startAngle);
    const end = normalize(area.endAngle);
    return start <= end ? angle >= start && angle <= end : angle >= start || angle <= end;
  };

  const tooltipLines = area => {
    const lines = [escapeText(area.label)];
    if (area.xSeries) lines.push(`${escapeText(area.xSeries)}: ${number(area.xValue)}`);
    lines.push(`${escapeText(area.series)}: ${number(area.value)}`);
    return lines;
  };

  const createDataTable = data => {
    const wrapper = document.createElement('div');
    wrapper.className = 'interactive-chart-data';
    wrapper.hidden = true;
    const scroller = document.createElement('div');
    scroller.className = 'interactive-chart-data-scroll';
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    [data.labelKey || 'Etiqueta', ...data.series].forEach(label => {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    const body = document.createElement('tbody');
    data.rows.forEach(row => {
      const tr = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = row.label;
      tr.appendChild(label);
      data.series.forEach(series => {
        const cell = document.createElement('td');
        const value = row.values[series];
        cell.textContent = Number.isFinite(value) ? number(value) : '—';
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
    table.append(head, body);
    scroller.appendChild(table);
    wrapper.appendChild(scroller);
    return wrapper;
  };

  const mountFigure = figure => {
    if (figure.dataset.chartMounted === 'true') return;
    const charts = api();
    if (!charts) return;
    let spec;
    try { spec = charts.decodeSpec(figure.dataset.chartSpec); }
    catch (error) {
      figure.classList.add('interactive-chart-error');
      figure.textContent = 'No se pudo cargar este gráfico interactivo.';
      console.warn('[interactive-chart]', error.message);
      return;
    }

    figure.dataset.chartMounted = 'true';
    figure.querySelector('.interactive-chart-placeholder')?.remove();
    const caption = figure.querySelector('figcaption');
    const shell = document.createElement('div');
    shell.className = 'interactive-chart-shell';
    const stage = document.createElement('div');
    stage.className = 'interactive-chart-stage';
    const canvas = document.createElement('canvas');
    canvas.className = 'interactive-chart-canvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${spec.options.title || spec.template.name}. Gráfico interactivo; pulse “Ver datos” para consultar todos los valores.`);
    const tooltip = document.createElement('div');
    tooltip.className = 'interactive-chart-tooltip';
    tooltip.setAttribute('role', 'status');
    tooltip.hidden = true;
    stage.append(canvas, tooltip);

    let rendered = charts.renderChart(canvas, spec.template, spec.data, spec.options);
    const controls = document.createElement('div');
    controls.className = 'interactive-chart-controls';
    const dataButton = document.createElement('button');
    dataButton.type = 'button';
    dataButton.className = 'interactive-chart-data-button';
    dataButton.textContent = 'Ver datos';
    dataButton.setAttribute('aria-expanded', 'false');
    const table = createDataTable(rendered.data);
    const tableId = `chart-data-${Math.random().toString(36).slice(2, 10)}`;
    table.id = tableId;
    dataButton.setAttribute('aria-controls', tableId);
    controls.appendChild(dataButton);
    shell.append(stage, controls, table);
    if (caption) figure.insertBefore(shell, caption);
    else figure.appendChild(shell);

    const hideTooltip = () => { tooltip.hidden = true; };
    const showTooltip = event => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (event.clientX - rect.left) * canvas.width / rect.width;
      const y = (event.clientY - rect.top) * canvas.height / rect.height;
      const area = [...rendered.hitAreas].reverse().find(item => pointInArea(item, x, y));
      if (!area) { hideTooltip(); return; }
      tooltip.replaceChildren(...tooltipLines(area).map((line, index) => {
        const node = document.createElement(index ? 'span' : 'strong');
        node.textContent = line;
        return node;
      }));
      tooltip.hidden = false;
      const stageRect = stage.getBoundingClientRect();
      const left = Math.min(stageRect.width - 16, Math.max(16, event.clientX - stageRect.left));
      const top = Math.min(stageRect.height - 16, Math.max(16, event.clientY - stageRect.top));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    canvas.addEventListener('pointermove', showTooltip);
    canvas.addEventListener('pointerdown', showTooltip);
    canvas.addEventListener('pointerleave', hideTooltip);
    canvas.addEventListener('blur', hideTooltip);
    dataButton.addEventListener('click', () => {
      const open = table.hidden;
      table.hidden = !open;
      dataButton.textContent = open ? 'Ocultar datos' : 'Ver datos';
      dataButton.setAttribute('aria-expanded', String(open));
      if (open) table.querySelector('table')?.focus?.();
    });

    const observer = new ResizeObserver(() => {
      hideTooltip();
      rendered = charts.renderChart(canvas, spec.template, spec.data, spec.options);
    });
    observer.observe(stage);
  };

  const mount = (root = document) => root.querySelectorAll('.interactive-chart[data-chart-spec]').forEach(mountFigure);
  window.ComunicacionInteractiveCharts = { mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();
})();
