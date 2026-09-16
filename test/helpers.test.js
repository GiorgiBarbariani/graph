'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const ComboChart = require('../combo-chart.js');

const {
  parseTime, parsePoint, niceInterval, defaultDateFormat, splinePath, segments, tooltipPosition, escapeHtml
} = ComboChart._internals;

describe('parseTime', () => {
  test('YYYY-MM-DD is a local calendar date by default', () => {
    assert.equal(parseTime('2026-06-10'), new Date(2026, 5, 10).getTime());
  });

  test('YYYY-MM-DD is UTC midnight when utc = true', () => {
    assert.equal(parseTime('2026-06-10', true), Date.UTC(2026, 5, 10));
  });

  test('accepts numbers, Dates and full ISO strings', () => {
    assert.equal(parseTime(1781049600000), 1781049600000);
    assert.equal(parseTime(new Date(1781049600000)), 1781049600000);
    assert.equal(parseTime('2026-06-10T00:00:00Z'), Date.UTC(2026, 5, 10));
  });

  test('throws on values that are not dates', () => {
    assert.throws(() => parseTime('not a date'), /cannot parse time/);
    assert.throws(() => parseTime(undefined), /cannot parse time/);
  });
});

describe('parsePoint', () => {
  test('tuple form', () => {
    assert.deepEqual(parsePoint([1000, 2.5]), [1000, 2.5]);
  });

  test('object form with every supported key alias', () => {
    assert.deepEqual(parsePoint({ x: 1, y: 2 }), [1, 2]);
    assert.deepEqual(parsePoint({ time: 1, value: 2 }), [1, 2]);
    assert.deepEqual(parsePoint({ date: 1, v: 2 }), [1, 2]);
    assert.deepEqual(parsePoint({ t: 1, y: 0 }), [1, 0]);
  });

  test('missing and non-numeric values become null, numeric strings are converted', () => {
    assert.deepEqual(parsePoint([1, null]), [1, null]);
    assert.deepEqual(parsePoint([1, '']), [1, null]);
    assert.deepEqual(parsePoint([1, 'abc']), [1, null]);
    assert.deepEqual(parsePoint([1, '3.5']), [1, 3.5]);
    assert.deepEqual(parsePoint({ x: 1 }), [1, null]);
  });

  test('throws on unsupported shapes', () => {
    assert.throws(() => parsePoint(5), /unsupported data point/);
  });
});

describe('niceInterval', () => {
  test('rounds up to 1, 2, 2.5, 4, 5 or 10 times a power of ten', () => {
    assert.equal(niceInterval(30), 40);
    assert.equal(niceInterval(21.25), 25);
    assert.equal(niceInterval(203.6), 250);
    assert.equal(niceInterval(1), 1);
    assert.equal(niceInterval(0.07), 0.1);
    assert.equal(niceInterval(6), 10);
  });

  test('non-positive input falls back to 1', () => {
    assert.equal(niceInterval(0), 1);
    assert.equal(niceInterval(-5), 1);
  });
});

describe('defaultDateFormat', () => {
  test('DD.MM.YYYY', () => {
    assert.equal(defaultDateFormat(new Date(2026, 5, 1), false, false), '01.06.2026');
  });

  test('appends HH:mm when asked', () => {
    assert.equal(defaultDateFormat(new Date(2026, 11, 31, 9, 5), false, true), '31.12.2026 09:05');
  });

  test('UTC formatting', () => {
    assert.equal(defaultDateFormat(new Date(Date.UTC(2026, 0, 2, 23, 30)), true, true), '02.01.2026 23:30');
  });
});

describe('segments', () => {
  test('splits runs on null values and drops the nulls', () => {
    const pts = [1, 2, null, 4, null, null, 7].map((v, i) => ({ x: i, y: v, value: v }));
    const out = segments(pts);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((s) => s.map((p) => p.value)), [[1, 2], [4], [7]]);
  });

  test('empty input gives no segments', () => {
    assert.deepEqual(segments([]), []);
  });
});

describe('splinePath', () => {
  function parse(d) {
    // → [{ cmd, nums }]
    return d.match(/[MC][^MC]*/g).map((s) => ({ cmd: s[0], nums: s.slice(1).split(/[ ,]/).map(Number) }));
  }

  test('starts with M at the first point and ends at the last point', () => {
    const pts = [{ x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 5 }];
    const cmds = parse(splinePath(pts));
    assert.deepEqual(cmds[0], { cmd: 'M', nums: [0, 10] });
    assert.equal(cmds.length, 3);
    const last = cmds[2].nums;
    assert.deepEqual(last.slice(4), [20, 5]);
  });

  test('passes through every data point', () => {
    const pts = [{ x: 0, y: 50 }, { x: 10, y: 20 }, { x: 20, y: 30 }, { x: 30, y: 90 }];
    const cmds = parse(splinePath(pts));
    cmds.slice(1).forEach((c, i) => assert.deepEqual(c.nums.slice(4), [pts[i + 1].x, pts[i + 1].y]));
  });

  test('local extremes get horizontal tangents (no overshoot)', () => {
    // Point 1 is a local minimum in screen space (largest y).
    const pts = [{ x: 0, y: 10 }, { x: 10, y: 80 }, { x: 20, y: 30 }];
    const cmds = parse(splinePath(pts));
    const leftControlY = cmds[1].nums[3];
    const rightControlY = cmds[2].nums[1];
    assert.equal(leftControlY, 80);
    assert.equal(rightControlY, 80);
  });

  test('control points stay within the neighbouring range on monotonic data', () => {
    const pts = [0, 5, 40, 42, 100].map((y, i) => ({ x: i * 10, y }));
    const cmds = parse(splinePath(pts));
    cmds.slice(1).forEach((c, i) => {
      const lo = Math.min(pts[i].y, pts[i + 1].y), hi = Math.max(pts[i].y, pts[i + 1].y);
      [c.nums[1], c.nums[3]].forEach((cy) => assert.ok(cy >= lo - 1e-9 && cy <= hi + 1e-9, `control y ${cy} outside [${lo}, ${hi}]`));
    });
  });

  test('a single point is just a move', () => {
    assert.equal(splinePath([{ x: 3, y: 4 }]), 'M3,4');
  });
});

describe('tooltipPosition', () => {
  const distance = 16;

  test('goes to the left of the pointer when there is room, vertically centred', () => {
    const pos = tooltipPosition(100, 50, 300, 100, 400, 200, distance);
    assert.deepEqual(pos, { x: 300 - distance - 100, y: 75 });
  });

  test('goes to the right when there is no room on the left', () => {
    const pos = tooltipPosition(100, 50, 50, 100, 400, 200, distance);
    assert.equal(pos.x, 50 + distance);
  });

  test('sticks to the top/bottom edge near the chart edges', () => {
    assert.equal(tooltipPosition(100, 80, 300, 20, 400, 200, distance).y, 1);
    assert.equal(tooltipPosition(100, 80, 300, 180, 400, 200, distance).y, 200 - 80 - 2);
  });

  test('never leaves the chart box, even when it does not fit anywhere', () => {
    const pos = tooltipPosition(300, 150, 200, 100, 350, 175, distance);
    assert.ok(pos.x >= 0 && pos.x + 300 <= 350, JSON.stringify(pos));
    assert.ok(pos.y >= 0 && pos.y + 150 <= 175, JSON.stringify(pos));
  });
});

test('escapeHtml escapes markup characters', () => {
  assert.equal(escapeHtml(`<b a="1">'&'</b>`), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;');
});
