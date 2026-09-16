/*!
 * ComboChart — lightweight dependency-free time-series combo chart.
 * Four series types on one plot: area, bar, spline, line.
 * MIT License.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.ComboChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var uid = 0;

  var DEFAULTS = {
    height: null,             // px. null → container height, or 175 if the container has none
    xSpacing: 'category',     // 'category' — equal steps between dates, 'time' — proportional to time
    utc: false,               // parse 'YYYY-MM-DD' strings and format dates in UTC
    fontFamily: '"Lucida Grande", Verdana, "Lucida Sans Unicode", Arial, Helvetica, sans-serif',
    plotBorderColor: '#cccccc',
    plotBorderWidth: 1,
    cursor: 'pointer',
    animation: { duration: 1000 }, // initial left-to-right reveal; false to disable
    ariaLabel: null,          // accessible name; default is generated from series names
    yAxes: {},                // { <yAxis key>: { min, max } } — manual scale overrides
    tooltip: {
      enabled: true,
      distance: 16,           // gap between pointer and tooltip, px
      hideDelay: 500,         // ms before the tooltip fades out after the pointer leaves
      dateFormat: null,       // function (Date) → string. Default DD.MM.YYYY (+ HH:mm when needed)
      formatter: null         // function (ctx) → HTML string. Replaces the whole tooltip body
    }
  };

  var TYPE_DEFAULTS = {
    area:   { name: 'Area',   color: '#FFF691', yAxis: 0, lineWidth: 1.5, fillOpacity: 0.5, smooth: true },
    bar:    { name: 'Bar',    color: '#3770FE', yAxis: 0, widthRatio: 0.235, maxWidth: 40, radius: 3, overhang: 2 },
    spline: { name: 'Spline', color: '#0F8401', yAxis: 1, lineWidth: 3, hoverLineWidth: 1, threshold: 100, negativeColor: '#3BC201' },
    line:   { name: 'Line',   color: '#B500FE', yAxis: 2, lineWidth: 1, markerSize: 6 }
  };

  var CSS = [
    '.cc-root{position:relative;width:100%;-webkit-tap-highlight-color:transparent;touch-action:pan-y;outline:none}',
    '.cc-root:focus-visible{box-shadow:0 0 0 2px #3770FE}',
    '.cc-svg{position:absolute;left:0;top:0;overflow:visible;display:block}',
    '.cc-graph{fill:none;stroke-linejoin:round;stroke-linecap:round;transition:stroke-width .25s ease}',
    '.cc-bar{transition:filter .15s ease}',
    '.cc-bar.cc-hover{filter:brightness(1.1)}',
    '.cc-tooltip{position:absolute;left:0;top:0;pointer-events:none;z-index:10;white-space:nowrap;',
    'background:#fff;border-radius:3px;padding:8px;color:#333;font-size:13px;line-height:18px;',
    'box-shadow:1px 1px 3px rgba(0,0,0,.28),0 0 1px rgba(0,0,0,.12);opacity:0;visibility:hidden;',
    'transition:opacity .15s ease,visibility 0s linear .15s;will-change:transform}',
    '.cc-tooltip.cc-visible{opacity:1;visibility:visible;transition:opacity .15s ease,visibility 0s}',
    '.cc-tt-date{font-size:11px;line-height:15px;margin-bottom:1px}',
    '.cc-tt-row{display:flex;align-items:center;height:18.5px}',
    '.cc-tt-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;flex:none}',
    '.cc-tt-row b{font-weight:bold;margin-left:.3em}'
  ].join('');

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('combo-chart-styles')) return;
    var style = document.createElement('style');
    style.id = 'combo-chart-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ---------- helpers ----------

  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
        var v = src[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && typeof v !== 'function') {
          target[k] = extend(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
        } else if (v !== undefined) {
          target[k] = v;
        }
      }
    }
    return target;
  }

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function parseTime(t, utc) {
    if (t instanceof Date) return t.getTime();
    if (typeof t === 'number') return t;
    if (typeof t === 'string') {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.trim());
      if (m) return utc ? Date.UTC(+m[1], m[2] - 1, +m[3]) : new Date(+m[1], m[2] - 1, +m[3]).getTime();
      var parsed = Date.parse(t);
      if (!isNaN(parsed)) return parsed;
    }
    throw new Error('ComboChart: cannot parse time value ' + JSON.stringify(t));
  }

  function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = +v;
    return isFinite(n) ? n : null;
  }

  function first() {
    for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined) return arguments[i];
  }

  function parsePoint(p, utc) {
    if (Array.isArray(p)) return [parseTime(p[0], utc), toNumber(p[1])];
    if (p && typeof p === 'object') {
      return [parseTime(first(p.x, p.time, p.date, p.t), utc), toNumber(first(p.y, p.value, p.v))];
    }
    throw new Error('ComboChart: unsupported data point ' + JSON.stringify(p));
  }

  function niceInterval(raw) {
    if (raw <= 0) return 1;
    var magnitude = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var normalized = raw / magnitude;
    var multiples = [1, 2, 2.5, 4, 5, 10];
    for (var i = 0; i < multiples.length; i++) {
      if (normalized <= multiples[i] + 1e-9) return multiples[i] * magnitude;
    }
    return 10 * magnitude;
  }

  function defaultDateFormat(date, utc, withTime) {
    var d = utc
      ? [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear(), date.getUTCHours(), date.getUTCMinutes()]
      : [date.getDate(), date.getMonth() + 1, date.getFullYear(), date.getHours(), date.getMinutes()];
    var s = pad(d[0]) + '.' + pad(d[1]) + '.' + d[2];
    return withTime ? s + ' ' + pad(d[3]) + ':' + pad(d[4]) : s;
  }

  // Spline control points — same smoothing as Highcharts' spline series (smoothing 1.5,
  // tangent correction and no overshoot past neighbouring extremes).
  function splinePath(points) {
    var smoothing = 1.5, denom = smoothing + 1, d = '';
    for (var i = 0; i < points.length; i++) {
      var p = points[i], prev = points[i - 1], next = points[i + 1];
      if (!prev) { d += 'M' + p.x + ',' + p.y; continue; }
      var lcx, lcy;
      if (next) {
        lcx = (smoothing * p.x + prev.x) / denom;
        lcy = (smoothing * p.y + prev.y) / denom;
        var rcx = (smoothing * p.x + next.x) / denom;
        var rcy = (smoothing * p.y + next.y) / denom;
        var correction = rcx !== lcx ? ((rcy - lcy) * (rcx - p.x)) / (rcx - lcx) + p.y - rcy : 0;
        lcy += correction;
        rcy += correction;
        if (lcy > prev.y && lcy > p.y) { lcy = Math.max(prev.y, p.y); rcy = 2 * p.y - lcy; }
        else if (lcy < prev.y && lcy < p.y) { lcy = Math.min(prev.y, p.y); rcy = 2 * p.y - lcy; }
        if (rcy > next.y && rcy > p.y) { rcy = Math.max(next.y, p.y); lcy = 2 * p.y - rcy; }
        else if (rcy < next.y && rcy < p.y) { rcy = Math.min(next.y, p.y); lcy = 2 * p.y - rcy; }
        p._rcx = rcx; p._rcy = rcy;
      } else {
        lcx = p.x; lcy = p.y;
      }
      d += 'C' + first(prev._rcx, prev.x) + ',' + first(prev._rcy, prev.y) + ' ' + lcx + ',' + lcy + ' ' + p.x + ',' + p.y;
    }
    return d;
  }

  function straightPath(points) {
    return points.map(function (p, i) { return (i ? 'L' : 'M') + p.x + ',' + p.y; }).join('');
  }

  // Splits points into continuous runs, breaking on null values.
  function segments(points) {
    var out = [], cur = [];
    points.forEach(function (p) {
      if (p.value === null) { if (cur.length) out.push(cur); cur = []; }
      else cur.push({ x: p.x, y: p.y, value: p.value });
    });
    if (cur.length) out.push(cur);
    return out;
  }

  // Tooltip placement: to the left of the pointer when there is room, otherwise to the right,
  // vertically centred on the pointer and kept inside the chart.
  function tooltipPosition(boxW, boxH, anchorX, anchorY, outerW, outerH, distance) {
    var ret = {}, swapped;
    var dimA = ['y', outerH, boxH, anchorY], dimB = ['x', outerW, boxW, anchorX];
    function firstDimension(dim, outerSize, innerSize, point) {
      if (innerSize < point - distance) ret[dim] = point - distance - innerSize;
      else if (point + distance + innerSize < outerSize) ret[dim] = point + distance;
      else return false;
    }
    function secondDimension(dim, outerSize, innerSize, point) {
      if (point < distance || point > outerSize - distance) return false;
      if (point < innerSize / 2) ret[dim] = 1;
      else if (point > outerSize - innerSize / 2) ret[dim] = outerSize - innerSize - 2;
      else ret[dim] = point - innerSize / 2;
    }
    function swap(count) { var t = dimA; dimA = dimB; dimB = t; swapped = count; }
    function run() {
      if (firstDimension.apply(null, dimA) !== false) {
        if (secondDimension.apply(null, dimB) === false && !swapped) { swap(true); run(); }
      } else if (!swapped) { swap(true); run(); }
      else { ret.x = ret.y = 0; }
    }
    swap();
    run();
    ret.x = Math.max(0, Math.min(ret.x, outerW - boxW));
    ret.y = Math.max(0, Math.min(ret.y, outerH - boxH));
    return ret;
  }

  // ---------- chart ----------

  function ComboChart(target, options) {
    if (!(this instanceof ComboChart)) return new ComboChart(target, options);
    this.container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.container) throw new Error('ComboChart: container not found');
    options = options || {};
    this.id = 'cc' + (++uid);
    this.options = extend({}, DEFAULTS, stripSeries(options));
    this.hover = { index: -1, series: null, mx: 0, my: 0 };
    injectStyles();
    this._build();
    this.setSeries(collectSeries(options), false);
    this.render();
  }

  function stripSeries(options) {
    var copy = {};
    for (var k in options) if (!(k in TYPE_DEFAULTS) && k !== 'series') copy[k] = options[k];
    return copy;
  }

  function collectSeries(options) {
    if (Array.isArray(options.series)) return options.series;
    var list = [];
    Object.keys(TYPE_DEFAULTS).forEach(function (type) {
      var s = options[type];
      if (!s) return;
      list.push(extend({ type: type }, Array.isArray(s) ? { data: s } : s));
    });
    return list;
  }

  ComboChart.prototype._build = function () {
    var self = this;
    this.fluidHeight = !this.options.height && this.container.clientHeight > 0;

    var root = this.root = document.createElement('div');
    root.className = 'cc-root';
    root.style.fontFamily = this.options.fontFamily;
    root.style.cursor = this.options.cursor;
    root.style.height = this.fluidHeight ? '100%' : (this.options.height || 175) + 'px';
    root.tabIndex = 0;
    root.setAttribute('role', 'img');
    this.container.appendChild(root);

    this.svg = el('svg', { 'class': 'cc-svg', xmlns: SVGNS }, root);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'cc-tooltip';
    this.tooltip.style.fontFamily = this.options.fontFamily;
    root.appendChild(this.tooltip);
    this.ttPos = null;
    this.ttTarget = null;

    // Pointer moves are coalesced to one hover update per animation frame.
    this._onMove = function (e) {
      self.lastPointer = { x: e.clientX, y: e.clientY };
      if (self.moveRaf) return;
      self.moveRaf = requestAnimationFrame(function () {
        self.moveRaf = null;
        if (self.lastPointer) self._pointerMove(self.lastPointer.x, self.lastPointer.y);
      });
    };
    this._onDown = function (e) {
      if (e.pointerType !== 'mouse') self._pointerMove(e.clientX, e.clientY);
    };
    // A finger lifting off fires pointerleave; keep the tooltip until the user taps elsewhere.
    this._onLeave = function (e) {
      if (e.pointerType !== 'touch') { self.lastPointer = null; self._pointerLeave(); }
    };
    this._onDocDown = function (e) {
      if (!root.contains(e.target)) self._pointerLeave();
    };
    this._onKey = function (e) { self._keyDown(e); };
    this._onBlur = function () { if (self.keyboardHover) self._pointerLeave(); };
    root.addEventListener('pointermove', this._onMove);
    root.addEventListener('pointerdown', this._onDown);
    root.addEventListener('pointerleave', this._onLeave);
    root.addEventListener('keydown', this._onKey);
    root.addEventListener('blur', this._onBlur);
    document.addEventListener('pointerdown', this._onDocDown);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(function () {
        var w = root.clientWidth, h = root.clientHeight;
        if (w !== self.width || h !== self.height) self.render();
      });
      this.resizeObserver.observe(root);
    } else {
      this._onResize = function () { self.render(); };
      window.addEventListener('resize', this._onResize);
    }
  };

  /** Replace all series. Accepts an array of series configs. */
  ComboChart.prototype.setSeries = function (seriesList, redraw) {
    var utc = this.options.utc;
    this.series = (seriesList || []).map(function (cfg, i) {
      var type = cfg.type;
      if (!TYPE_DEFAULTS[type]) throw new Error('ComboChart: unknown series type "' + type + '"');
      var s = extend({}, TYPE_DEFAULTS[type], cfg);
      s.index = i;
      s.map = new Map();
      (cfg.data || []).forEach(function (p) {
        var parsed = parsePoint(p, utc);
        s.map.set(parsed[0], parsed[1]);
      });
      return s;
    });

    var times = new Set();
    this.series.forEach(function (s) { s.map.forEach(function (_, t) { times.add(t); }); });
    this.times = Array.from(times).sort(function (a, b) { return a - b; });
    var times_ = this.times;
    this.hasTime = times_.some(function (t) {
      var d = new Date(t);
      return utc ? (d.getUTCHours() || d.getUTCMinutes()) : (d.getHours() || d.getMinutes());
    });
    this.series.forEach(function (s) {
      s.values = times_.map(function (t) { return s.map.has(t) ? s.map.get(t) : null; });
      s.isInteger = s.values.every(function (v) { return v === null || Math.round(v) === v; });
    });
    if (redraw !== false) this.render();
    return this;
  };

  /** Replace data of one series by index or name, keeping its styles. */
  ComboChart.prototype.setData = function (indexOrName, data) {
    var list = this.series.map(function (s) {
      var cfg = extend({}, s);
      delete cfg.map; delete cfg.values; delete cfg.index; delete cfg.isInteger;
      delete cfg.points; delete cfg.graphs; delete cfg.bars;
      cfg.data = Array.from(s.map.entries());
      return cfg;
    });
    var target = typeof indexOrName === 'number'
      ? list[indexOrName]
      : list.filter(function (s) { return s.name === indexOrName || s.type === indexOrName; })[0];
    if (!target) throw new Error('ComboChart: series "' + indexOrName + '" not found');
    target.data = data;
    return this.setSeries(list);
  };

  /** Merge new options (chart-level and/or series) and redraw. */
  ComboChart.prototype.update = function (options) {
    options = options || {};
    extend(this.options, stripSeries(options));
    if (options.series || Object.keys(TYPE_DEFAULTS).some(function (t) { return options[t]; })) {
      this.setSeries(collectSeries(options), false);
    }
    this.render();
    return this;
  };

  ComboChart.prototype._scales = function (W, H) {
    var o = this.options, n = this.times.length, times = this.times;
    var bw = o.plotBorderWidth;
    var plot = { left: bw / 2, top: bw / 2, right: W - bw / 2, bottom: H - bw / 2 };
    plot.width = plot.right - plot.left;
    plot.height = plot.bottom - plot.top;

    var xs, step;
    if (o.xSpacing === 'time' && n > 1) {
      var minGap = Infinity;
      for (var i = 1; i < n; i++) minGap = Math.min(minGap, times[i] - times[i - 1]);
      var t0 = times[0] - minGap / 2, t1 = times[n - 1] + minGap / 2;
      xs = times.map(function (t) { return plot.left + ((t - t0) / (t1 - t0)) * plot.width; });
      step = (minGap / (t1 - t0)) * plot.width;
    } else {
      step = plot.width / Math.max(n, 1);
      xs = times.map(function (_, i) { return plot.left + step * (i + 0.5); });
    }

    var axes = {};
    this.series.forEach(function (s) {
      var key = String(s.yAxis);
      var a = axes[key] || (axes[key] = { min: Infinity, max: -Infinity });
      s.values.forEach(function (v) {
        if (v === null) return;
        a.min = Math.min(a.min, v);
        a.max = Math.max(a.max, v);
      });
    });
    Object.keys(axes).forEach(function (key) {
      var a = axes[key], manual = o.yAxes[key] || {};
      if (a.min === Infinity) { a.min = 0; a.max = 1; }
      var lo = Math.min(0, a.min), hi = Math.max(0, a.max);
      if (hi === lo) hi = lo + 1;
      var interval = niceInterval((hi - lo) / 3);
      a.min = manual.min !== undefined ? manual.min : Math.floor(lo / interval) * interval;
      a.max = manual.max !== undefined ? manual.max : Math.ceil(hi / interval) * interval;
      a.toY = function (v) { return plot.bottom - ((v - a.min) / (a.max - a.min)) * plot.height; };
      a.baseline = a.toY(Math.max(a.min, Math.min(0, a.max)));
    });

    return { plot: plot, xs: xs, step: step, axes: axes };
  };

  /** Redraw everything (called automatically on resize and data changes). */
  ComboChart.prototype.render = function () {
    var self = this, o = this.options, svg = this.svg;
    var W = this.width = this.root.clientWidth || 350;
    var H = this.height = this.root.clientHeight || o.height || 175;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var sc = this.scales = this._scales(W, H), plot = sc.plot;
    var defs = el('defs', {}, svg);

    if (o.plotBorderWidth) {
      el('rect', {
        x: plot.left, y: plot.top, width: plot.width, height: plot.height,
        fill: 'none', stroke: o.plotBorderColor, 'stroke-width': o.plotBorderWidth
      }, svg);
    }

    var seriesLayer = el('g', { 'class': 'cc-series' }, svg);
    this.series.forEach(function (s) {
      var axis = sc.axes[String(s.yAxis)];
      var g = el('g', { 'class': 'cc-series-' + s.type }, seriesLayer);
      s.points = s.values.map(function (v, i) {
        return { x: sc.xs[i], y: v === null ? null : axis.toY(v), value: v };
      });
      s.graphs = [];
      s.bars = [];
      self['_draw_' + s.type](s, g, axis, sc, defs);
    });

    this.hoverLayer = el('g', { 'class': 'cc-hover-layer' }, svg);
    this._animateIn(seriesLayer, defs);
    this.root.setAttribute('aria-label', o.ariaLabel || this._ariaLabel());
    if (this.hover.index >= 0) {
      if (this.hover.index >= this.times.length) this._pointerLeave();
      else this._applyHover(true);
    }
  };

  // Reveals the series from left to right on the first render only.
  ComboChart.prototype._animateIn = function (layer, defs) {
    var anim = this.options.animation, self = this;
    if (this.animated || !this.times.length) return;
    this.animated = true;
    var reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Background tabs pause requestAnimationFrame, which would leave the series clipped away.
    if (!anim || !anim.duration || reduced || document.hidden) return;
    var id = this.id + '-reveal', pad = 20, W = this.width, H = this.height;
    var clip = el('clipPath', { id: id }, defs);
    var rect = el('rect', { x: -pad, y: -pad, width: 0, height: H + pad * 2 }, clip);
    layer.setAttribute('clip-path', 'url(#' + id + ')');
    var start = performance.now(), duration = anim.duration;
    function frame(now) {
      self.revealRaf = null;
      if (!rect.isConnected) return; // re-rendered meanwhile
      var t = Math.min(1, (now - start) / duration);
      rect.setAttribute('width', (W + pad * 2) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) self.revealRaf = requestAnimationFrame(frame);
      else layer.removeAttribute('clip-path');
    }
    this.revealRaf = requestAnimationFrame(frame);
  };

  ComboChart.prototype._ariaLabel = function () {
    var names = this.series.map(function (s) { return s.name; }).join(', ');
    var n = this.times.length;
    if (!n) return 'Chart: ' + names + ', no data';
    return 'Chart: ' + names + ', ' + n + ' dates from ' + this._dateText(this.times[0]) + ' to ' +
      this._dateText(this.times[n - 1]) + '. Use left and right arrow keys to read values.';
  };

  ComboChart.prototype._draw_area = function (s, g, axis) {
    var base = axis.baseline;
    segments(s.points).forEach(function (seg) {
      var top = s.smooth ? splinePath(seg) : straightPath(seg);
      var lastX = seg[seg.length - 1].x, firstX = seg[0].x;
      el('path', {
        d: top + 'L' + lastX + ',' + base + 'L' + firstX + ',' + base + 'Z',
        fill: s.color, 'fill-opacity': s.fillOpacity, stroke: 'none'
      }, g);
      if (s.lineWidth) {
        var line = el('path', { d: top, 'class': 'cc-graph', stroke: s.color }, g);
        line.style.strokeWidth = s.lineWidth + 'px';
        s.graphs.push(line);
      }
    });
  };

  ComboChart.prototype._draw_bar = function (s, g, axis, sc) {
    var width = Math.max(1, Math.min(sc.step * s.widthRatio, s.maxWidth));
    var base = axis.baseline;
    s.points.forEach(function (p, i) {
      if (p.value === null) { s.bars[i] = null; return; }
      var top = Math.min(p.y, base), bottom = Math.max(p.y, base) + s.overhang;
      var h = Math.max(bottom - top, 1);
      var rect = el('rect', {
        'class': 'cc-bar', x: p.x - width / 2, y: top, width: width, height: h,
        rx: Math.min(s.radius, width / 2), fill: s.color
      }, g);
      s.bars[i] = { node: rect, x0: p.x - width / 2, x1: p.x + width / 2, y0: top, y1: bottom };
    });
  };

  ComboChart.prototype._draw_spline = function (s, g, axis, sc, defs) {
    var d = segments(s.points).map(splinePath).join('');
    if (!d) return;
    var plot = sc.plot, id = this.id + '-s' + s.index;
    var zoned = s.negativeColor && s.threshold !== null && s.threshold !== undefined;
    if (!zoned) {
      var path = el('path', { d: d, 'class': 'cc-graph', stroke: s.color }, g);
      path.style.strokeWidth = s.lineWidth + 'px';
      s.graphs.push(path);
      return;
    }
    // Values >= threshold use `color`, values below use `negativeColor` (split horizontally, like zones).
    var yThr = axis.toY(s.threshold), pad = 50;
    var above = el('clipPath', { id: id + '-above' }, defs);
    el('rect', { x: -pad, y: plot.top - pad * 10, width: this.width + pad * 2, height: Math.max(0, yThr - plot.top + pad * 10) }, above);
    var below = el('clipPath', { id: id + '-below' }, defs);
    el('rect', { x: -pad, y: yThr, width: this.width + pad * 2, height: Math.max(0, plot.bottom - yThr + pad * 10) }, below);
    [[s.color, 'above'], [s.negativeColor, 'below']].forEach(function (z) {
      var path = el('path', { d: d, 'class': 'cc-graph', stroke: z[0], 'clip-path': 'url(#' + id + '-' + z[1] + ')' }, g);
      path.style.strokeWidth = s.lineWidth + 'px';
      s.graphs.push(path);
    });
  };

  ComboChart.prototype._draw_line = function (s, g) {
    var d = segments(s.points).map(straightPath).join('');
    if (d) {
      var path = el('path', { d: d, 'class': 'cc-graph', stroke: s.color }, g);
      path.style.strokeWidth = s.lineWidth + 'px';
      s.graphs.push(path);
    }
    if (s.markerSize) {
      var m = s.markerSize;
      s.points.forEach(function (p) {
        if (p.value === null) return;
        el('rect', { x: Math.round(p.x - m / 2), y: Math.round(p.y - m / 2), width: m, height: m, fill: s.color }, g);
      });
    }
  };

  ComboChart.prototype._pointColor = function (s, value) {
    if (s.type === 'spline' && s.negativeColor && value !== null && value < s.threshold) return s.negativeColor;
    return s.color;
  };

  // ---------- interaction ----------

  ComboChart.prototype._pointerMove = function (clientX, clientY) {
    if (!this.times.length || !this.scales) return;
    var rect = this.root.getBoundingClientRect();
    var mx = clientX - rect.left, my = clientY - rect.top;
    if (mx < 0 || my < 0 || mx > this.width || my > this.height) return this._pointerLeave();
    this.keyboardHover = false;

    var xs = this.scales.xs, index = 0, best = Infinity;
    for (var i = 0; i < xs.length; i++) {
      var dist = Math.abs(xs[i] - mx);
      if (dist < best) { best = dist; index = i; }
    }

    // The hovered series: a bar under the pointer, otherwise the series whose point
    // at this date is vertically closest to the pointer.
    var hovered = null, bestY = Infinity;
    this.series.forEach(function (s) {
      if (s.type !== 'bar') return;
      var b = s.bars[index];
      if (b && mx >= b.x0 && mx <= b.x1 && my >= b.y0 - 4 && my <= b.y1 + 2) hovered = s;
    });
    if (!hovered) {
      this.series.forEach(function (s) {
        if (s.type === 'bar') return;
        var p = s.points[index];
        if (!p || p.value === null) return;
        var dy = Math.abs(p.y - my);
        if (dy < bestY) { bestY = dy; hovered = s; }
      });
    }

    this._setHover(index, hovered, mx, my);
  };

  ComboChart.prototype._setHover = function (index, series, mx, my) {
    var changed = index !== this.hover.index || series !== this.hover.series;
    this.hover = { index: index, series: series, mx: mx, my: my };
    if (changed) this._applyHover(false);
    if (this.options.tooltip.enabled) this._showTooltip(changed);
  };

  // Arrow keys step through dates, Home/End jump to the ends, Escape hides the tooltip.
  ComboChart.prototype._keyDown = function (e) {
    var n = this.times.length;
    if (!n || !this.scales) return;
    var index = this.hover.index, next;
    if (e.key === 'ArrowRight') next = index < 0 ? 0 : Math.min(n - 1, index + 1);
    else if (e.key === 'ArrowLeft') next = index < 0 ? n - 1 : Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') { this._pointerLeave(); return; }
    else return;
    e.preventDefault();
    var sum = 0, count = 0;
    this.series.forEach(function (s) {
      var p = s.points[next];
      if (p && p.value !== null) { sum += p.y; count++; }
    });
    this.keyboardHover = true;
    this._setHover(next, null, this.scales.xs[next], count ? sum / count : this.height / 2);
  };

  ComboChart.prototype._pointerLeave = function () {
    var self = this;
    if (this.hover.index < 0) return;
    this.hover = { index: -1, series: null, mx: 0, my: 0 };
    this._applyHover(false);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(function () {
      self.tooltip.classList.remove('cc-visible');
      self.ttPos = null;
    }, this.options.tooltip.hideDelay);
  };

  ComboChart.prototype._applyHover = function (afterRender) {
    var self = this, index = this.hover.index, layer = this.hoverLayer;
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    this.series.forEach(function (s) {
      var isHovered = s === self.hover.series;
      var width = isHovered && s.hoverLineWidth !== undefined ? s.hoverLineWidth : s.lineWidth;
      s.graphs.forEach(function (g) {
        if (afterRender) g.style.transition = 'none';
        g.style.strokeWidth = width + 'px';
        if (afterRender) { g.getBoundingClientRect(); g.style.transition = ''; }
      });
      s.bars.forEach(function (b, i) { if (b) b.node.classList.toggle('cc-hover', i === index); });
      if (index < 0 || s.type === 'bar') return;

      var p = s.points[index];
      if (!p || p.value === null) return;
      var color = self._pointColor(s, p.value);
      el('circle', { cx: p.x, cy: p.y, r: 10, fill: color, 'fill-opacity': 0.25 }, layer);
      if (s.type === 'line') {
        var m = (s.markerSize || 6) + 2;
        el('rect', { x: p.x - m / 2, y: p.y - m / 2, width: m, height: m, fill: color, stroke: '#fff', 'stroke-width': 1 }, layer);
      } else {
        el('circle', { cx: p.x, cy: p.y, r: 4, fill: color, stroke: '#fff', 'stroke-width': 1 }, layer);
      }
    });
  };

  ComboChart.prototype._formatValue = function (s, v) {
    if (typeof s.valueFormatter === 'function') return s.valueFormatter(v);
    var decimals = s.decimals !== undefined ? s.decimals : (s.isInteger ? 0 : 2);
    return (s.valuePrefix || '') + v.toFixed(decimals) + (s.valueSuffix || '');
  };

  ComboChart.prototype._dateText = function (time) {
    var fmt = this.options.tooltip.dateFormat;
    return fmt ? fmt(new Date(time)) : defaultDateFormat(new Date(time), this.options.utc, this.hasTime);
  };

  ComboChart.prototype._tooltipHtml = function (index) {
    var self = this, o = this.options.tooltip, date = new Date(this.times[index]);
    var points = this.series.map(function (s) {
      var v = s.values[index];
      return { series: s, name: s.name, value: v, color: v === null ? s.color : self._pointColor(s, v) };
    });
    if (typeof o.formatter === 'function') {
      return o.formatter({ date: date, time: this.times[index], index: index, points: points });
    }
    var dateText = this._dateText(this.times[index]);
    var html = '<div class="cc-tt-date">' + escapeHtml(dateText) + '</div>';
    points.forEach(function (p) {
      if (p.value === null) return;
      html += '<div class="cc-tt-row"><span class="cc-tt-dot" style="background:' + escapeHtml(p.color) + '"></span>' +
        escapeHtml(p.name) + ':<b>' + escapeHtml(self._formatValue(p.series, p.value)) + '</b></div>';
    });
    return html;
  };

  ComboChart.prototype._showTooltip = function (contentChanged) {
    var tt = this.tooltip;
    clearTimeout(this.hideTimer);
    if (contentChanged || !tt.classList.contains('cc-visible')) tt.innerHTML = this._tooltipHtml(this.hover.index);

    var pos = tooltipPosition(tt.offsetWidth, tt.offsetHeight, this.hover.mx, this.hover.my,
      this.width, this.height, this.options.tooltip.distance);
    this.ttTarget = pos;
    if (!tt.classList.contains('cc-visible') || !this.ttPos) {
      this.ttPos = { x: pos.x, y: pos.y };
      this._placeTooltip();
      tt.classList.add('cc-visible');
    } else {
      this._animateTooltip();
    }
  };

  ComboChart.prototype._placeTooltip = function () {
    this.tooltip.style.transform = 'translate(' + Math.round(this.ttPos.x) + 'px,' + Math.round(this.ttPos.y) + 'px)';
  };

  // Tooltip glides towards its target position instead of jumping.
  ComboChart.prototype._animateTooltip = function () {
    var self = this;
    if (this.raf) return;
    var last = performance.now();
    function step(now) {
      self.raf = null;
      if (!self.ttPos || !self.ttTarget) return;
      var k = 1 - Math.pow(0.8, (now - last) / 16.67);
      last = now;
      var dx = self.ttTarget.x - self.ttPos.x, dy = self.ttTarget.y - self.ttPos.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        self.ttPos.x = self.ttTarget.x; self.ttPos.y = self.ttTarget.y;
        self._placeTooltip();
        return;
      }
      self.ttPos.x += dx * k;
      self.ttPos.y += dy * k;
      self._placeTooltip();
      self.raf = requestAnimationFrame(step);
    }
    this.raf = requestAnimationFrame(step);
  };

  /** Remove the chart and all listeners. */
  ComboChart.prototype.destroy = function () {
    clearTimeout(this.hideTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.moveRaf) cancelAnimationFrame(this.moveRaf);
    if (this.revealRaf) cancelAnimationFrame(this.revealRaf);
    document.removeEventListener('pointerdown', this._onDocDown);
    this.root.removeEventListener('keydown', this._onKey);
    this.root.removeEventListener('blur', this._onBlur);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    this.root.removeEventListener('pointermove', this._onMove);
    this.root.removeEventListener('pointerdown', this._onDown);
    this.root.removeEventListener('pointerleave', this._onLeave);
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  ComboChart.create = function (target, options) { return new ComboChart(target, options); };
  ComboChart.defaults = DEFAULTS;
  ComboChart.typeDefaults = TYPE_DEFAULTS;

  return ComboChart;
});
