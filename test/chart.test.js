'use strict';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { W, H, frames, wait, pointer, key, mount, REFERENCE } = require('./setup-dom.js');
const ComboChart = require('../combo-chart.js');

let charts = [];
function create(options, el = mount()) {
  const chart = new ComboChart(el, options);
  charts.push(chart);
  return chart;
}

afterEach(() => {
  charts.forEach((c) => c.destroy());
  charts = [];
  document.body.innerHTML = '';
});

const q = (chart, sel) => chart.root.querySelector(sel);
const qa = (chart, sel) => Array.from(chart.root.querySelectorAll(sel));
const tooltipRows = (chart) => qa(chart, '.cc-tt-row').map((r) => r.textContent);

// Hover the point of `series` at `index` (plus an optional vertical offset).
async function hoverPoint(chart, seriesIndex, index, dy = 0) {
  const p = chart.series[seriesIndex].points[index];
  pointer(chart.root, 'pointermove', p.x, p.y + dy);
  await frames(2);
}

describe('rendering', () => {
  test('draws every series type with the expected elements', () => {
    const chart = create(REFERENCE);
    assert.equal(chart.width, W);
    assert.equal(chart.height, H);

    const area = q(chart, '.cc-series-area');
    assert.equal(area.querySelectorAll('path').length, 2, 'area fill + area line');
    assert.equal(area.querySelector('path').getAttribute('fill'), '#FFF691');

    assert.equal(qa(chart, '.cc-series-bar rect').length, 5);

    const splinePaths = qa(chart, '.cc-series-spline path');
    assert.equal(splinePaths.length, 2, 'one path per colour zone');
    assert.deepEqual(splinePaths.map((p) => p.getAttribute('stroke')), ['#0F8401', '#3BC201']);
    splinePaths.forEach((p) => assert.match(p.getAttribute('clip-path'), /^url\(#cc\d+-s2-(above|below)\)$/));

    assert.equal(qa(chart, '.cc-series-line path').length, 1);
    assert.equal(qa(chart, '.cc-series-line rect').length, 5, 'square markers');

    const border = q(chart, 'svg > rect');
    assert.equal(border.getAttribute('stroke'), '#cccccc');
  });

  test('series are drawn in the given order (later on top)', () => {
    const chart = create(REFERENCE);
    const order = qa(chart, '.cc-series > g').map((g) => g.getAttribute('class'));
    assert.deepEqual(order, ['cc-series-area', 'cc-series-bar', 'cc-series-spline', 'cc-series-line']);
  });

  test('dates are placed at category centres', () => {
    const chart = create(REFERENCE);
    const step = (W - 1) / 5;
    chart.scales.xs.forEach((x, i) => assert.ok(Math.abs(x - (0.5 + step * (i + 0.5))) < 1e-9));
  });

  test('Y scales are rounded up to nice maxima like on the recording', () => {
    const { axes } = create(REFERENCE).scales;
    assert.deepEqual(
      Object.fromEntries(Object.entries(axes).map(([k, a]) => [k, [a.min, a.max]])),
      { 0: [0, 75], 1: [0, 750], 2: [0, 120] }
    );
  });

  test('bars share the area scale by default, so small CPA values give short bars', () => {
    const chart = create(REFERENCE);
    const heights = qa(chart, '.cc-bar').map((r) => +r.getAttribute('height'));
    heights.forEach((h) => assert.ok(h < 8, `bar height ${h}`));
    // tallest bar is the largest CPA (1.23 on 12.06)
    assert.equal(heights.indexOf(Math.max(...heights)), 2);
  });

  test('a bar on its own axis fills the plot height', () => {
    const chart = create({ ...REFERENCE, bar: { ...REFERENCE.bar, yAxis: 'cpa' } });
    const tallest = Math.max(...qa(chart, '.cc-bar').map((r) => +r.getAttribute('height')));
    assert.ok(tallest > H / 2, `tallest bar ${tallest}`);
  });

  test('manual yAxes override the scale', () => {
    const chart = create({ ...REFERENCE, yAxes: { 2: { min: 0, max: 1000 } } });
    assert.equal(chart.scales.axes[2].max, 1000);
  });

  test('negative values extend the scale below zero', () => {
    const chart = create({ animation: false, line: [['2026-01-01', -30], ['2026-01-02', 50]] });
    const axis = chart.scales.axes[2];
    assert.ok(axis.min < 0 && axis.min <= -30, `min ${axis.min}`);
    assert.ok(axis.max >= 50);
  });

  test('the series shorthand and the series array render identically', () => {
    const a = create(REFERENCE);
    const b = create({
      animation: false,
      series: ['area', 'bar', 'spline', 'line'].map((type) => ({ type, ...REFERENCE[type] }))
    });
    const normalize = (chart) => chart.svg.innerHTML.replace(/cc\d+-/g, 'ID-');
    assert.equal(normalize(a), normalize(b));
  });

  test('shorthand accepts a bare data array', () => {
    const chart = create({ animation: false, line: [['2026-01-01', 1], ['2026-01-02', 2]] });
    assert.equal(chart.series[0].name, 'Line');
    assert.deepEqual(chart.series[0].values, [1, 2]);
  });

  test('X axis is the union of all dates; missing values break the line', () => {
    const chart = create({
      animation: false,
      area: [['2026-01-01', 1], ['2026-01-02', 2], ['2026-01-03', 3], ['2026-01-04', 4]],
      line: [['2026-01-01', 5], ['2026-01-02', 6], ['2026-01-04', 8]]
    });
    assert.equal(chart.times.length, 4);
    assert.deepEqual(chart.series[1].values, [5, 6, null, 8]);
    const d = q(chart, '.cc-series-line path').getAttribute('d');
    assert.equal((d.match(/M/g) || []).length, 2, d);
    assert.equal(qa(chart, '.cc-series-line rect').length, 3);
  });

  test('data points are sorted by time regardless of input order', () => {
    const chart = create({ animation: false, line: [['2026-01-03', 3], ['2026-01-01', 1], ['2026-01-02', 2]] });
    assert.deepEqual(chart.series[0].values, [1, 2, 3]);
  });

  test('negativeColor: null draws the spline as a single path', () => {
    const chart = create({ ...REFERENCE, spline: { ...REFERENCE.spline, negativeColor: null } });
    const paths = qa(chart, '.cc-series-spline path');
    assert.equal(paths.length, 1);
    assert.equal(paths[0].getAttribute('clip-path'), null);
  });

  test("xSpacing: 'time' spaces dates proportionally", () => {
    const chart = create({
      animation: false,
      xSpacing: 'time',
      line: [['2026-01-01', 1], ['2026-01-02', 2], ['2026-01-05', 3]]
    });
    const [a, b, c] = chart.scales.xs;
    assert.ok(Math.abs((c - b) / (b - a) - 3) < 1e-9);
  });

  test('renders without data and without series', () => {
    assert.doesNotThrow(() => create({ animation: false }));
    assert.doesNotThrow(() => create({ animation: false, line: [] }));
  });

  test('uses the container height when it has one', () => {
    const el = mount();
    Object.defineProperty(el, 'clientHeight', { value: 300 });
    const chart = create(REFERENCE, el);
    assert.equal(chart.root.style.height, '100%');
  });

  test('explicit height option', () => {
    const chart = create({ ...REFERENCE, height: 260 });
    assert.equal(chart.root.style.height, '260px');
    assert.equal(chart.height, 260);
  });
});

describe('tooltip and hover', () => {
  test('shows date and all values of the hovered date', async () => {
    const chart = create(REFERENCE);
    await hoverPoint(chart, 3, 2);
    const tt = q(chart, '.cc-tooltip');
    assert.ok(tt.classList.contains('cc-visible'));
    assert.equal(q(chart, '.cc-tt-date').textContent, '12.06.2026');
    assert.deepEqual(tooltipRows(chart), ['Cost:44.36', 'CPA:1.23', 'ROI confirmed:161.47', 'Conversions:36']);
  });

  test('keeps two decimals for fractional series and none for integer series', async () => {
    const chart = create(REFERENCE);
    await hoverPoint(chart, 0, 1);
    assert.deepEqual(tooltipRows(chart), ['Cost:25.85', 'CPA:0.86', 'ROI confirmed:180.50', 'Conversions:30']);
  });

  test('dot colour follows the spline zone', async () => {
    const chart = create(REFERENCE);
    const dotColor = () => q(chart, '.cc-tt-row:nth-of-type(4) .cc-tt-dot, .cc-tt-row:nth-child(4) .cc-tt-dot').style.background;
    await hoverPoint(chart, 3, 3); // ROI 56.33 < 100
    assert.equal(dotColor(), 'rgb(59, 194, 1)');
    await hoverPoint(chart, 3, 2); // ROI 161.47
    assert.equal(dotColor(), 'rgb(15, 132, 1)');
  });

  test('halos and hover markers on every non-bar series, bar highlighted', async () => {
    const chart = create(REFERENCE);
    await hoverPoint(chart, 3, 2);
    const layer = q(chart, '.cc-hover-layer');
    const halos = Array.from(layer.querySelectorAll('circle[r="10"]'));
    assert.equal(halos.length, 3);
    assert.equal(layer.querySelectorAll('circle[r="4"]').length, 2, 'area + spline markers');
    assert.equal(layer.querySelectorAll('rect').length, 1, 'line marker');
    const bars = qa(chart, '.cc-bar');
    assert.deepEqual(bars.map((b) => b.classList.contains('cc-hover')), [false, false, true, false, false]);
  });

  test('spline gets thin only while it is the series nearest to the pointer', async () => {
    const chart = create(REFERENCE);
    const widths = () => qa(chart, '.cc-series-spline path').map((p) => p.style.strokeWidth);
    assert.deepEqual(widths(), ['3px', '3px']);

    await hoverPoint(chart, 2, 3, 2); // right next to the ROI point on 13.06
    assert.equal(chart.hover.series.type, 'spline');
    assert.deepEqual(widths(), ['1px', '1px']);

    await hoverPoint(chart, 3, 3, -2); // next to the Conversions point
    assert.equal(chart.hover.series.type, 'line');
    assert.deepEqual(widths(), ['3px', '3px']);
  });

  test('pointer over a bar makes the bar series the hovered one', async () => {
    const chart = create(REFERENCE);
    const bar = chart.series[1].bars[2];
    pointer(chart.root, 'pointermove', (bar.x0 + bar.x1) / 2, bar.y0 + 1);
    await frames(2);
    assert.equal(chart.hover.series.type, 'bar');
  });

  test('the nearest date wins along X', async () => {
    const chart = create(REFERENCE);
    const [x0, x1] = chart.scales.xs;
    pointer(chart.root, 'pointermove', x0 + (x1 - x0) * 0.49, 50);
    await frames(2);
    assert.equal(chart.hover.index, 0);
    pointer(chart.root, 'pointermove', x0 + (x1 - x0) * 0.51, 50);
    await frames(2);
    assert.equal(chart.hover.index, 1);
  });

  test('mouse leave clears hover at once and hides the tooltip after hideDelay', async () => {
    const chart = create({ ...REFERENCE, tooltip: { hideDelay: 30 } });
    await hoverPoint(chart, 3, 2);
    pointer(chart.root, 'pointerleave', -1, -1);
    assert.equal(q(chart, '.cc-hover-layer').childNodes.length, 0);
    assert.deepEqual(qa(chart, '.cc-series-spline path').map((p) => p.style.strokeWidth), ['3px', '3px']);
    assert.ok(q(chart, '.cc-tooltip').classList.contains('cc-visible'), 'still visible during hideDelay');
    await wait(60);
    assert.ok(!q(chart, '.cc-tooltip').classList.contains('cc-visible'));
  });

  test('coming back before hideDelay keeps the tooltip', async () => {
    const chart = create({ ...REFERENCE, tooltip: { hideDelay: 40 } });
    await hoverPoint(chart, 3, 2);
    pointer(chart.root, 'pointerleave', -1, -1);
    await hoverPoint(chart, 3, 1);
    await wait(80);
    assert.ok(q(chart, '.cc-tooltip').classList.contains('cc-visible'));
    assert.equal(q(chart, '.cc-tt-date').textContent, '11.06.2026');
  });

  test('moving outside the chart box counts as leaving', async () => {
    const chart = create(REFERENCE);
    await hoverPoint(chart, 3, 2);
    pointer(chart.root, 'pointermove', W + 10, 20);
    await frames(2);
    assert.equal(chart.hover.index, -1);
  });

  test('tooltip stays inside the chart box', async () => {
    const chart = create(REFERENCE);
    Object.defineProperty(chart.tooltip, 'offsetWidth', { configurable: true, value: 180 });
    Object.defineProperty(chart.tooltip, 'offsetHeight', { configurable: true, value: 100 });
    for (let i = 0; i < 5; i++) {
      await hoverPoint(chart, 3, i);
      const t = chart.ttTarget;
      assert.ok(t.x >= 0 && t.x + 180 <= W && t.y >= 0 && t.y + 100 <= H, `index ${i}: ${JSON.stringify(t)}`);
    }
  });

  test('tooltip.enabled = false keeps hover effects but no tooltip', async () => {
    const chart = create({ ...REFERENCE, tooltip: { enabled: false } });
    await hoverPoint(chart, 3, 2);
    assert.ok(!q(chart, '.cc-tooltip').classList.contains('cc-visible'));
    assert.ok(q(chart, '.cc-hover-layer').childNodes.length > 0);
  });
});

describe('touch', () => {
  test('tap shows the tooltip, lifting the finger keeps it, tapping elsewhere hides it', async () => {
    const chart = create({ ...REFERENCE, tooltip: { hideDelay: 20 } });
    const p = chart.series[3].points[1];
    pointer(chart.root, 'pointerdown', p.x, p.y, 'touch');
    assert.equal(chart.hover.index, 1);
    pointer(chart.root, 'pointerleave', p.x, p.y, 'touch');
    await wait(50);
    assert.ok(q(chart, '.cc-tooltip').classList.contains('cc-visible'));

    pointer(document.body, 'pointerdown', 0, 0, 'touch');
    await wait(50);
    assert.equal(chart.hover.index, -1);
    assert.ok(!q(chart, '.cc-tooltip').classList.contains('cc-visible'));
  });

  test('mouse down does not hover by itself (pointermove does)', () => {
    const chart = create(REFERENCE);
    pointer(chart.root, 'pointerdown', 100, 50, 'mouse');
    assert.equal(chart.hover.index, -1);
  });
});

describe('keyboard', () => {
  test('arrows step through dates, Home/End jump, Escape hides', async () => {
    const chart = create({ ...REFERENCE, tooltip: { hideDelay: 10 } });
    assert.equal(chart.root.tabIndex, 0);

    assert.ok(key(chart.root, 'ArrowRight').defaultPrevented);
    assert.equal(chart.hover.index, 0);
    assert.equal(q(chart, '.cc-tt-date').textContent, '10.06.2026');

    key(chart.root, 'ArrowRight');
    key(chart.root, 'ArrowRight');
    assert.equal(chart.hover.index, 2);

    key(chart.root, 'End');
    assert.equal(chart.hover.index, 4);
    key(chart.root, 'ArrowRight');
    assert.equal(chart.hover.index, 4, 'does not run past the end');

    key(chart.root, 'Home');
    assert.equal(chart.hover.index, 0);
    key(chart.root, 'ArrowLeft');
    assert.equal(chart.hover.index, 0, 'does not run past the start');

    key(chart.root, 'Escape');
    assert.equal(chart.hover.index, -1);
    await wait(40);
    assert.ok(!q(chart, '.cc-tooltip').classList.contains('cc-visible'));
  });

  test('ArrowLeft with nothing selected starts from the last date', () => {
    const chart = create(REFERENCE);
    key(chart.root, 'ArrowLeft');
    assert.equal(chart.hover.index, 4);
  });

  test('other keys are ignored', () => {
    const chart = create(REFERENCE);
    assert.ok(!key(chart.root, 'a').defaultPrevented);
    assert.ok(!key(chart.root, 'Tab').defaultPrevented);
    assert.equal(chart.hover.index, -1);
  });

  test('blur hides a keyboard selection', () => {
    const chart = create(REFERENCE);
    key(chart.root, 'ArrowRight');
    chart.root.dispatchEvent(new window.FocusEvent('blur'));
    assert.equal(chart.hover.index, -1);
  });
});

describe('formatting options', () => {
  test('prefix, suffix, decimals and valueFormatter', async () => {
    const chart = create({
      ...REFERENCE,
      area: { ...REFERENCE.area, valuePrefix: '$' },
      bar: { ...REFERENCE.bar, decimals: 3 },
      spline: { ...REFERENCE.spline, valueSuffix: '%', decimals: 0 },
      line: { ...REFERENCE.line, valueFormatter: (v) => v + ' conv.' }
    });
    await hoverPoint(chart, 3, 2);
    assert.deepEqual(tooltipRows(chart), ['Cost:$44.36', 'CPA:1.230', 'ROI confirmed:161%', 'Conversions:36 conv.']);
  });

  test('custom dateFormat', async () => {
    const chart = create({ ...REFERENCE, tooltip: { dateFormat: (d) => 'day ' + d.getDate() } });
    await hoverPoint(chart, 3, 0);
    assert.equal(q(chart, '.cc-tt-date').textContent, 'day 10');
  });

  test('custom formatter receives date, index and points', async () => {
    let ctx;
    const chart = create({
      ...REFERENCE,
      tooltip: { formatter: (c) => { ctx = c; return '<i>custom</i>'; } }
    });
    await hoverPoint(chart, 3, 4);
    assert.equal(q(chart, '.cc-tooltip').innerHTML, '<i>custom</i>');
    assert.equal(ctx.index, 4);
    assert.equal(ctx.date.getDate(), 14);
    assert.deepEqual(ctx.points.map((p) => [p.name, p.value]), [
      ['Cost', 63.75], ['CPA', 0.71], ['ROI confirmed', 357.25], ['Conversions', 90]
    ]);
  });

  test('times of day switch the default date format to include HH:mm', async () => {
    const chart = create({
      animation: false,
      line: [[new Date(2026, 0, 1, 9, 30), 1], [new Date(2026, 0, 1, 18, 0), 2]]
    });
    key(chart.root, 'ArrowRight');
    assert.equal(q(chart, '.cc-tt-date').textContent, '01.01.2026 09:30');
  });

  test('series names are HTML-escaped', async () => {
    const chart = create({ animation: false, line: { name: '<img src=x onerror=alert(1)>', data: [['2026-01-01', 1]] } });
    key(chart.root, 'ArrowRight');
    assert.equal(q(chart, '.cc-tooltip img'), null);
    assert.match(tooltipRows(chart)[0], /^<img src=x onerror=alert\(1\)>:1$/);
  });

  test('values missing on the hovered date are left out of the tooltip', async () => {
    const chart = create({
      animation: false,
      area: [['2026-01-01', 1], ['2026-01-02', 2]],
      line: [['2026-01-01', 5]]
    });
    key(chart.root, 'End');
    assert.deepEqual(tooltipRows(chart), ['Area:2']);
  });
});

describe('API', () => {
  test('setData replaces one series by name, type or index and keeps its style', () => {
    const chart = create({ ...REFERENCE, line: { ...REFERENCE.line, color: '#123456' } });
    chart.setData('Conversions', [['2026-06-10', 1], ['2026-06-11', 2]]);
    assert.deepEqual(chart.series[3].values, [1, 2, null, null, null]);
    assert.equal(chart.series[3].color, '#123456');

    chart.setData('bar', [['2026-06-10', 5]]);
    assert.equal(chart.series[1].values[0], 5);

    chart.setData(0, [['2026-06-15', 9]]);
    assert.equal(chart.times.length, 6);
    assert.equal(chart.series[0].values[5], 9);
  });

  test('setData throws for an unknown series', () => {
    const chart = create(REFERENCE);
    assert.throws(() => chart.setData('nope', []), /not found/);
  });

  test('update merges chart options and redraws', () => {
    const chart = create(REFERENCE);
    chart.update({ plotBorderWidth: 0 });
    assert.equal(q(chart, 'svg > rect'), null);
    assert.equal(chart.series.length, 4, 'series untouched');
    assert.equal(chart.options.tooltip.hideDelay, 500, 'nested defaults kept');
  });

  test('update with new series replaces them', () => {
    const chart = create(REFERENCE);
    chart.update({ line: [['2026-01-01', 1]] });
    assert.equal(chart.series.length, 1);
    assert.equal(chart.times.length, 1);
  });

  test('redraw while hovering keeps the hover state', async () => {
    const chart = create(REFERENCE);
    await hoverPoint(chart, 3, 2);
    chart.render();
    assert.equal(chart.hover.index, 2);
    assert.equal(q(chart, '.cc-hover-layer').querySelectorAll('circle[r="10"]').length, 3);
  });

  test('shrinking data below the hovered index drops the hover', async () => {
    const chart = create(REFERENCE);
    await hoverPoint(chart, 3, 4);
    chart.update({ line: [['2026-06-10', 1]] });
    assert.equal(chart.hover.index, -1);
  });

  test('destroy removes the chart and stops reacting to events', async () => {
    const el = mount();
    const chart = new ComboChart(el, REFERENCE);
    const root = chart.root;
    chart.destroy();
    assert.equal(el.children.length, 0);
    pointer(root, 'pointermove', 100, 50);
    pointer(document.body, 'pointerdown', 0, 0, 'touch');
    await frames(2);
    assert.equal(chart.hover.index, -1);
  });

  test('ComboChart.create and calling without new', () => {
    charts.push(ComboChart.create(mount(), REFERENCE));
    charts.push(ComboChart(mount(), REFERENCE)); // eslint-disable-line new-cap
    charts.forEach((c) => assert.ok(c instanceof ComboChart));
  });

  test('accepts a CSS selector', () => {
    const el = mount();
    el.id = 'target';
    const chart = create(REFERENCE, '#target');
    assert.equal(chart.container, el);
  });

  test('throws for a missing container or an unknown series type', () => {
    assert.throws(() => new ComboChart('#missing', REFERENCE), /container not found/);
    assert.throws(() => create({ series: [{ type: 'pie', data: [] }] }), /unknown series type "pie"/);
  });

  test('styles are injected once for many charts', () => {
    create(REFERENCE);
    create(REFERENCE);
    assert.equal(document.querySelectorAll('#combo-chart-styles').length, 1);
  });
});

describe('animation and accessibility', () => {
  test('first render reveals the series with a clip that is removed at the end', async () => {
    const chart = create({ ...REFERENCE, animation: { duration: 40 } });
    const layer = q(chart, '.cc-series');
    assert.match(layer.getAttribute('clip-path'), /reveal/);
    await wait(120);
    await frames(2);
    assert.equal(layer.getAttribute('clip-path'), null);
  });

  test('only the first render animates', () => {
    const chart = create({ ...REFERENCE, animation: { duration: 40 } });
    chart.render();
    assert.equal(q(chart, '.cc-series').getAttribute('clip-path'), null);
  });

  test('animation: false renders immediately', () => {
    const chart = create(REFERENCE);
    assert.equal(q(chart, '.cc-series').getAttribute('clip-path'), null);
  });

  test('default aria-label describes series and date range; custom label wins', () => {
    const chart = create(REFERENCE);
    assert.equal(chart.root.getAttribute('role'), 'img');
    assert.equal(
      chart.root.getAttribute('aria-label'),
      'Chart: Cost, CPA, ROI confirmed, Conversions, 5 dates from 10.06.2026 to 14.06.2026. Use left and right arrow keys to read values.'
    );
    const custom = create({ ...REFERENCE, ariaLabel: 'Campaign stats' });
    assert.equal(custom.root.getAttribute('aria-label'), 'Campaign stats');
  });
});
