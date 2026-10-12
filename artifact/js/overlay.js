// Overlay helpers: SVG strings in SCREEN px that carry class names only. WS3 styles the classes.
import { contoursToD, transformContours } from './geometry.js';

const r = v => Math.round(v * 100) / 100;

export const outline = (contoursScreen, cls = 'ov-outline') =>
  `<path class="${cls}" d="${contoursToD(contoursScreen, 2)}"/>`;

export const box = (b, cls = 'ov-bbox') =>
  `<rect class="${cls}" x="${r(b.x)}" y="${r(b.y)}" width="${r(b.w)}" height="${r(b.h)}"/>`;

export const handle = (x, y, cls = 'ov-handle') =>
  `<rect class="${cls}" x="${r(x - 4)}" y="${r(y - 4)}" width="8" height="8"/>`;

export const anchor = (x, y, selected = false) =>
  `<rect class="ov-anchor${selected ? ' is-selected' : ''}" x="${r(x - 3.5)}" y="${r(y - 3.5)}" width="7" height="7"/>`;

export const ctrl = (x, y) => `<circle class="ov-ctrl" cx="${r(x)}" cy="${r(y)}" r="3.5"/>`;

export const line = (a, b, cls = 'ov-ctrl-line') =>
  `<line class="${cls}" x1="${r(a.x)}" y1="${r(a.y)}" x2="${r(b.x)}" y2="${r(b.y)}"/>`;

export const toScreenContours = (contours, v) =>
  transformContours(contours, [v.zoom, 0, 0, v.zoom, v.panX, v.panY]);
