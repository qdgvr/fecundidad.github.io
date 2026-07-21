(() => {
  'use strict';

  const TYPES = new Set(['bar', 'horizontalBar', 'line', 'area', 'scatter', 'donut']);
  const DEFAULT_PALETTE = ['#36babc', '#75a8e8', '#e9b44c', '#ef8354', '#9b87d1', '#8fcf72'];
  const LIMITS = { templates: 40, rows: 250, series: 8, text: 500000 };

  const cleanText = (value, length = 180) => String(value ?? '').trim().slice(0, length);
  const finite = value => {
    const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  };
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;

  function validateTemplate(input, index = 0) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('La plantilla no es un objeto JSON válido.');
    const type = cleanText(input.type, 30);
    if (!TYPES.has(type)) throw new Error(`Tipo de gráfico no permitido: ${type || 'vacío'}.`);
    const palette = Array.isArray(input.palette)
      ? input.palette.slice(0, LIMITS.series).map((item, i) => color(item, DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]))
      : DEFAULT_PALETTE;
    const content = input.content && typeof input.content === 'object' ? input.content : input;
    return {
      id: cleanText(input.id || `imported-${index + 1}`, 60).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      name: cleanText(input.name || input.title || `Plantilla ${index + 1}`, 80),
      type,
      description: cleanText(input.description, 180),
      palette,
      defaults: {
        legend: input.defaults?.legend !== false,
        grid: input.defaults?.grid !== false,
        stacked: Boolean(input.defaults?.stacked)
      },
      content: {
        title: cleanText(content.title, 180),
        subtitle: cleanText(content.subtitle, 260),
        source: cleanText(content.source, 220),
        xLabel: cleanText(content.xLabel, 100),
        yLabel: cleanText(content.yLabel, 100),
        theme: content.theme === 'light' ? 'light' : 'dark',
        data: content.data ?? null
      }
    };
  }

  function validateCatalog(input) {
    const raw = Array.isArray(input) ? input : Array.isArray(input?.templates) ? input.templates : [input];
    if (!raw.length || raw.length > LIMITS.templates) throw new Error(`El catálogo debe contener entre 1 y ${LIMITS.templates} plantillas.`);
    const templates = raw.map(validateTemplate);
    const ids = new Set();
    templates.forEach(template => {
      if (!template.id || ids.has(template.id)) throw new Error('Cada plantilla necesita un identificador único.');
      ids.add(template.id);
    });
    return templates;
  }

  function parseCsvLine(line, delimiter) {
    const values = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) { values.push(value.trim()); value = ''; }
      else value += char;
    }
    values.push(value.trim());
    return values;
  }

  function parseCsv(text) {
    const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('Incluya una fila de encabezados y al menos una fila de datos.');
    const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const headers = parseCsvLine(lines[0], delimiter).map((header, index) => cleanText(header || `Columna ${index + 1}`, 80));
    return lines.slice(1).map(line => {
      const values = parseCsvLine(line, delimiter);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
  }

  function parseData(input) {
    let rows = input;
    if (typeof input === 'string') {
      const text = input.trim();
      if (!text) throw new Error('Añada datos en CSV o JSON.');
      if (text.length > LIMITS.text) throw new Error('El conjunto de datos es demasiado grande.');
      if (/^[\[{]/.test(text)) {
        try { rows = JSON.parse(text); } catch (_) { throw new Error('El JSON de datos no es válido.'); }
      } else rows = parseCsv(text);
    }
    if (rows && !Array.isArray(rows) && Array.isArray(rows.data)) rows = rows.data;
    if (!Array.isArray(rows) || !rows.length) throw new Error('Los datos deben ser una lista no vacía.');
    if (rows.length > LIMITS.rows) throw new Error(`Use como máximo ${LIMITS.rows} filas.`);
    if (Array.isArray(rows[0])) {
      const [headers, ...body] = rows;
      rows = body.map(row => Object.fromEntries(headers.map((header, index) => [cleanText(header, 80), row[index]])));
    }
    if (!rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('Cada fila debe ser un objeto o una matriz de valores.');
    const keys = Object.keys(rows[0]).slice(0, LIMITS.series + 1);
    if (keys.length < 2) throw new Error('Se necesitan una columna de etiquetas y al menos una columna numérica.');
    const labelKey = keys[0];
    const series = keys.slice(1).filter(key => rows.some(row => finite(row[key]) !== null)).slice(0, LIMITS.series);
    if (!series.length) throw new Error('No se encontró ninguna serie numérica.');
    return {
      labelKey,
      series,
      rows: rows.map((row, index) => ({
        label: cleanText(row[labelKey] ?? `Fila ${index + 1}`, 80),
        values: Object.fromEntries(series.map(key => [key, finite(row[key])]))
      }))
    };
  }

  const roundedRect = (ctx, x, y, width, height, radius) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  };
  const formatNumber = value => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value);
  const extent = values => {
    const filtered = values.filter(Number.isFinite);
    let min = Math.min(0, ...filtered);
    let max = Math.max(0, ...filtered);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * .08;
    return [min - (min < 0 ? pad : 0), max + pad];
  };
  const scale = (value, sourceMin, sourceMax, targetMin, targetMax) => targetMin + ((value - sourceMin) / (sourceMax - sourceMin)) * (targetMax - targetMin);

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const words = cleanText(text, 300).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(word => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; }
      else line = next;
    });
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
    return Math.min(lines.length, maxLines) * lineHeight;
  }

  function renderChart(canvas, template, rawData, options = {}) {
    const data = parseData(rawData);
    const width = 1600;
    const height = 900;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const theme = options.theme === 'light' ? 'light' : 'dark';
    const colors = theme === 'light'
      ? { bg: '#f7f4ed', ink: '#111111', muted: '#5f5c56', grid: '#d6d1c8' }
      : { bg: '#000000', ink: '#f7f4ed', muted: '#aaa7a1', grid: '#2c2c2c' };
    const palette = [...(template.palette || DEFAULT_PALETTE)];
    palette[0] = color(options.primaryColor, palette[0]);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = colors.ink;
    ctx.font = '700 58px Arial, sans-serif';
    const titleHeight = drawWrapped(ctx, options.title || template.name, 90, 86, 1420, 65, 2);
    ctx.fillStyle = colors.muted;
    ctx.font = '30px Arial, sans-serif';
    const subtitleY = 102 + titleHeight;
    const subtitleHeight = options.subtitle ? drawWrapped(ctx, options.subtitle, 90, subtitleY, 1420, 39, 2) : 0;

    const showLegend = Boolean(options.legend ?? template.defaults.legend);
    const chart = { left: 155, right: 1510, top: Math.max(220, subtitleY + subtitleHeight + 35), bottom: showLegend ? 680 : 730 };
    const plotWidth = chart.right - chart.left;
    const plotHeight = chart.bottom - chart.top;
    const stacked = Boolean(options.stacked ?? template.defaults.stacked);
    const allValues = stacked && ['bar', 'horizontalBar'].includes(template.type)
      ? data.rows.flatMap(row => {
          const values = data.series.map(series => row.values[series]).filter(Number.isFinite);
          return [values.filter(value => value >= 0).reduce((sum, value) => sum + value, 0), values.filter(value => value < 0).reduce((sum, value) => sum + value, 0)];
        })
      : data.rows.flatMap(row => data.series.map(series => row.values[series])).filter(Number.isFinite);
    const [min, max] = extent(allValues);
    const x = value => scale(value, min, max, chart.left, chart.right);
    const y = value => scale(value, min, max, chart.bottom, chart.top);
    const drawGrid = template.defaults.grid !== false && options.grid !== false;
    const scatterSeries = template.type === 'scatter' ? [data.series[0], data.series[1] || data.series[0]] : null;
    const scatterXExtent = scatterSeries ? extent(data.rows.map(row => row.values[scatterSeries[0]])) : null;
    const scatterYExtent = scatterSeries ? extent(data.rows.map(row => row.values[scatterSeries[1]])) : null;

    if (template.type !== 'donut') {
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 2;
      ctx.fillStyle = colors.muted;
      ctx.font = '24px Arial, sans-serif';
      for (let tick = 0; tick <= 5; tick += 1) {
        const value = min + ((max - min) * tick / 5);
        if (template.type === 'scatter') {
          const xValue = scatterXExtent[0] + ((scatterXExtent[1] - scatterXExtent[0]) * tick / 5);
          const yValue = scatterYExtent[0] + ((scatterYExtent[1] - scatterYExtent[0]) * tick / 5);
          const px = scale(xValue, scatterXExtent[0], scatterXExtent[1], chart.left, chart.right);
          const py = scale(yValue, scatterYExtent[0], scatterYExtent[1], chart.bottom, chart.top);
          if (drawGrid) {
            ctx.beginPath(); ctx.moveTo(px, chart.top); ctx.lineTo(px, chart.bottom); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(chart.left, py); ctx.lineTo(chart.right, py); ctx.stroke();
          }
          ctx.textAlign = 'center';
          ctx.fillText(formatNumber(xValue), px, chart.bottom + 42);
          ctx.textAlign = 'right';
          ctx.fillText(formatNumber(yValue), chart.left - 22, py + 8);
        } else if (template.type === 'horizontalBar') {
          const px = x(value);
          if (drawGrid) { ctx.beginPath(); ctx.moveTo(px, chart.top); ctx.lineTo(px, chart.bottom); ctx.stroke(); }
          ctx.textAlign = 'center';
          ctx.fillText(formatNumber(value), px, chart.bottom + 42);
        } else {
          const py = y(value);
          if (drawGrid) { ctx.beginPath(); ctx.moveTo(chart.left, py); ctx.lineTo(chart.right, py); ctx.stroke(); }
          ctx.textAlign = 'right';
          ctx.fillText(formatNumber(value), chart.left - 22, py + 8);
        }
      }
      ctx.textAlign = 'left';
    }

    const visibleRows = data.rows.slice(0, template.type === 'horizontalBar' ? 16 : 30);
    if (template.type === 'bar') {
      const groupWidth = plotWidth / visibleRows.length;
      const barWidth = Math.min(62, (groupWidth * .76) / (stacked ? 1 : data.series.length));
      visibleRows.forEach((row, rowIndex) => {
        let positive = 0;
        let negative = 0;
        data.series.forEach((series, seriesIndex) => {
          const value = row.values[series];
          if (!Number.isFinite(value)) return;
          const baseValue = stacked ? (value >= 0 ? positive : negative) : 0;
          const nextValue = baseValue + value;
          if (stacked) { if (value >= 0) positive = nextValue; else negative = nextValue; }
          const px = chart.left + rowIndex * groupWidth + (groupWidth - barWidth * (stacked ? 1 : data.series.length)) / 2 + (stacked ? 0 : seriesIndex * barWidth);
          const py = y(Math.max(baseValue, nextValue));
          const h = Math.abs(y(nextValue) - y(baseValue));
          ctx.fillStyle = palette[seriesIndex % palette.length];
          roundedRect(ctx, px, py, Math.max(2, barWidth - 5), Math.max(2, h), 7);
          ctx.fill();
        });
      });
    } else if (template.type === 'horizontalBar') {
      const rowHeight = plotHeight / visibleRows.length;
      const barHeight = Math.min(38, (rowHeight * .75) / (stacked ? 1 : data.series.length));
      ctx.font = '22px Arial, sans-serif';
      visibleRows.forEach((row, rowIndex) => {
        ctx.fillStyle = colors.muted;
        ctx.textAlign = 'right';
        ctx.fillText(row.label, chart.left - 18, chart.top + rowIndex * rowHeight + rowHeight / 2 + 7);
        let positive = 0;
        let negative = 0;
        data.series.forEach((series, seriesIndex) => {
          const value = row.values[series];
          if (!Number.isFinite(value)) return;
          const baseValue = stacked ? (value >= 0 ? positive : negative) : 0;
          const nextValue = baseValue + value;
          if (stacked) { if (value >= 0) positive = nextValue; else negative = nextValue; }
          const px = Math.min(x(baseValue), x(nextValue));
          const py = chart.top + rowIndex * rowHeight + (rowHeight - barHeight * (stacked ? 1 : data.series.length)) / 2 + (stacked ? 0 : seriesIndex * barHeight);
          ctx.fillStyle = palette[seriesIndex % palette.length];
          roundedRect(ctx, px, py, Math.max(2, Math.abs(x(nextValue) - x(baseValue))), Math.max(2, barHeight - 4), 7);
          ctx.fill();
        });
      });
      ctx.textAlign = 'left';
    } else if (template.type === 'line' || template.type === 'area') {
      data.series.forEach((series, seriesIndex) => {
        const points = visibleRows.map((row, index) => ({
          x: chart.left + (visibleRows.length === 1 ? plotWidth / 2 : index * plotWidth / (visibleRows.length - 1)),
          y: Number.isFinite(row.values[series]) ? y(row.values[series]) : null
        })).filter(point => point.y !== null);
        if (!points.length) return;
        if (template.type === 'area') {
          const gradient = ctx.createLinearGradient(0, chart.top, 0, chart.bottom);
          gradient.addColorStop(0, `${palette[seriesIndex % palette.length]}99`);
          gradient.addColorStop(1, `${palette[seriesIndex % palette.length]}08`);
          ctx.beginPath();
          ctx.moveTo(points[0].x, y(0));
          points.forEach(point => ctx.lineTo(point.x, point.y));
          ctx.lineTo(points[points.length - 1].x, y(0));
          ctx.closePath();
          ctx.fillStyle = gradient;
          ctx.fill();
        }
        ctx.beginPath();
        points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
        ctx.strokeStyle = palette[seriesIndex % palette.length];
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        points.forEach(point => {
          ctx.beginPath(); ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = palette[seriesIndex % palette.length]; ctx.fill();
          ctx.strokeStyle = colors.bg; ctx.lineWidth = 3; ctx.stroke();
        });
      });
    } else if (template.type === 'scatter') {
      const [xSeries, ySeries] = scatterSeries;
      const [xMin, xMax] = scatterXExtent;
      const [yMin, yMax] = scatterYExtent;
      visibleRows.forEach(row => {
        const xv = row.values[xSeries];
        const yv = row.values[ySeries];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
        ctx.beginPath();
        ctx.arc(scale(xv, xMin, xMax, chart.left, chart.right), scale(yv, yMin, yMax, chart.bottom, chart.top), 12, 0, Math.PI * 2);
        ctx.fillStyle = palette[0];
        ctx.globalAlpha = .78;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    } else if (template.type === 'donut') {
      const series = data.series[0];
      const values = visibleRows.map(row => Math.max(0, row.values[series] || 0));
      const total = values.reduce((sum, value) => sum + value, 0);
      if (!total) throw new Error('El gráfico de anillo necesita valores positivos.');
      const cx = 560;
      const cy = 490;
      const radius = 235;
      let angle = -Math.PI / 2;
      values.forEach((value, index) => {
        const next = angle + value / total * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, angle, next);
        ctx.strokeStyle = palette[index % palette.length];
        ctx.lineWidth = 120;
        ctx.stroke();
        angle = next;
      });
      ctx.fillStyle = colors.ink;
      ctx.font = '700 52px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(formatNumber(total), cx, cy + 10);
      ctx.fillStyle = colors.muted;
      ctx.font = '24px Arial, sans-serif';
      ctx.fillText('Total', cx, cy + 52);
      ctx.textAlign = 'left';
    }

    if (['bar', 'line', 'area'].includes(template.type) && visibleRows.length) {
      const step = Math.max(1, Math.ceil(visibleRows.length / 9));
      ctx.fillStyle = colors.muted;
      ctx.font = '22px Arial, sans-serif';
      ctx.textAlign = 'center';
      visibleRows.forEach((row, index) => {
        if (index % step && index !== visibleRows.length - 1) return;
        const px = chart.left + (template.type === 'bar'
          ? (index + .5) * plotWidth / visibleRows.length
          : (visibleRows.length === 1 ? plotWidth / 2 : index * plotWidth / (visibleRows.length - 1)));
        ctx.fillText(row.label, px, chart.bottom + 38);
      });
      ctx.textAlign = 'left';
    }

    if (showLegend) {
      const legendItems = template.type === 'donut' ? visibleRows.map(row => row.label) : data.series;
      ctx.font = '24px Arial, sans-serif';
      let lx = template.type === 'donut' ? 940 : chart.left;
      let ly = template.type === 'donut' ? 330 : chart.bottom + 92;
      legendItems.slice(0, 12).forEach((item, index) => {
        if (template.type !== 'donut' && lx + ctx.measureText(item).width + 70 > chart.right) { lx = chart.left; ly += 42; }
        ctx.fillStyle = palette[index % palette.length];
        roundedRect(ctx, lx, ly - 17, 28, 16, 5); ctx.fill();
        ctx.fillStyle = colors.muted;
        ctx.fillText(item, lx + 40, ly);
        if (template.type === 'donut') ly += 47;
        else lx += ctx.measureText(item).width + 90;
      });
    }

    ctx.fillStyle = colors.muted;
    ctx.font = '22px Arial, sans-serif';
    ctx.textAlign = 'left';
    if (options.source) ctx.fillText(`Fuente: ${cleanText(options.source, 220)}`, 90, 870);
    if (options.xLabel && template.type !== 'donut') { ctx.textAlign = 'center'; ctx.fillText(cleanText(options.xLabel, 100), (chart.left + chart.right) / 2, chart.bottom + 68); }
    if (options.yLabel && template.type !== 'donut') {
      ctx.save(); ctx.translate(45, (chart.top + chart.bottom) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText(cleanText(options.yLabel, 100), 0, 0); ctx.restore();
    }
    return { data, width, height };
  }

  async function loadCatalog(url = 'chart-templates.json') {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar el catálogo de gráficos.');
    return validateCatalog(await response.json());
  }

  window.ComunicacionCharts = { LIMITS, loadCatalog, parseData, renderChart, validateCatalog, validateTemplate };
})();
