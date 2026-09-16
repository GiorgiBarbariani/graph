'use strict';

// Minimal browser globals for combo-chart.js, backed by jsdom.
// jsdom does no layout: element sizes are 0, so charts fall back to 350×175 and
// getBoundingClientRect() is at (0, 0) — clientX/clientY equal chart-local coordinates.
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const W = 350, H = 175;

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function frames(n = 2) {
  for (let i = 0; i < n; i++) await nextFrame();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pointer(target, type, x, y, pointerType = 'mouse') {
  target.dispatchEvent(new window.PointerEvent(type, { clientX: x, clientY: y, pointerType, bubbles: true }));
}

function key(target, name) {
  const e = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// The data from the reference recording.
const REFERENCE = {
  animation: false,
  area: { name: 'Cost', data: [['2026-06-10', 2.04], ['2026-06-11', 25.85], ['2026-06-12', 44.36], ['2026-06-13', 55.65], ['2026-06-14', 63.75]] },
  bar: { name: 'CPA', data: [['2026-06-10', 0.68], ['2026-06-11', 0.86], ['2026-06-12', 1.23], ['2026-06-13', 0.79], ['2026-06-14', 0.71]] },
  spline: { name: 'ROI confirmed', data: [['2026-06-10', 610.78], ['2026-06-11', 180.5], ['2026-06-12', 161.47], ['2026-06-13', 56.33], ['2026-06-14', 357.25]] },
  line: { name: 'Conversions', data: [['2026-06-10', 3], ['2026-06-11', 30], ['2026-06-12', 36], ['2026-06-13', 70], ['2026-06-14', 90]] }
};

module.exports = { window, W, H, frames, wait, pointer, key, mount, REFERENCE };
