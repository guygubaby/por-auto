'use strict';

function detect(pixels, width, height) {
  if (width < 100 || height < 100 || width > 10000 || height > 10000 || width * height > 20000000 || pixels.length < width * height) throw new Error('截图尺寸无效');
  var left = Math.floor(width * 45 / 1000), right = Math.floor(width * 130 / 1000), flags = [], y, x;
  for (y = 0; y < height; y++) {
    var count = 0, bg = pixels[y * width + 5];
    if (y > Math.floor(height * 8 / 100)) for (x = left; x < right; x++) {
      var color = pixels[y * width + x];
      if (Math.abs((color >>> 16 & 255) - (bg >>> 16 & 255)) > 35 || Math.abs((color >>> 8 & 255) - (bg >>> 8 & 255)) > 35 || Math.abs((color & 255) - (bg & 255)) > 35) count++;
    }
    flags[y] = y > Math.floor(height * 8 / 100) && count * 10 >= (right - left) * 4;
  }
  for (y = 4; y < height - 4; y++) if (!flags[y] && (flags[y - 1] || flags[y - 2] || flags[y - 3]) && (flags[y + 1] || flags[y + 2] || flags[y + 3])) flags[y] = true;
  var points = {}, count = 0, start = null;
  for (y = 0; y <= height; y++) {
    if (y < height && flags[y]) { if (start === null) start = y; }
    else if (start !== null) {
      var size = y - start;
      // shortcut: standard left-avatar WeChat lists only; an unmarked row cannot be clicked.
      if (size * 1000 >= width * 65 && size * 100 <= width * 14 && count < 60) {
        points[(count * 37 + 30) % 97 + 1] = [Math.floor((left + right) * 500 / width), Math.floor((start + y) * 500 / height)]; count++;
      }
      start = null;
    }
  }
  return points;
}
function selected(selection, points, title) {
  function key(s) { return String(s).replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').replace(/[｜丨]/g, '|'); }
  if (!selection || selection.found !== true || typeof selection.text !== 'string' || key(selection.text) !== key(title)
      || typeof selection.marker !== 'number' || selection.marker % 1 || !Object.prototype.hasOwnProperty.call(points, selection.marker)) throw new Error('目标名称与头像编号未能唯一对应，未点击');
  return points[selection.marker].slice();
}
function unchanged(a, b, width, height, point, editor) {
  if (!a || !b || a.length !== width * height || b.length !== a.length) return false;
  function region(top, bottom, caret) {
    var min = width, max = -1;
    for (var y = Math.max(0, top); y < Math.min(height, bottom); y++) for (var x = 0; x < width; x++) {
      if ((a[y * width + x] & 0xffffff) !== (b[y * width + x] & 0xffffff)) {
        min = Math.min(min, x); max = Math.max(max, x);
        if (!caret || max - min > Math.floor(width * 6 / 1000)) return false;
      }
    }
    return true;
  }
  if (editor && !region(Math.floor(height * .04), Math.floor(height * .13), false)) return false;
  var y = Math.floor(point[1] * height / 1000), radius = editor ? Math.floor(height * .035) : Math.floor(width * .06);
  return region(y - radius, y + radius, editor);
}
var DIGITS = [
  [14,17,19,21,25,17,14], [4,12,4,4,4,4,14], [14,17,1,2,4,8,31],
  [30,1,1,14,1,1,30], [2,6,10,18,31,2,2], [31,16,16,30,1,1,30],
  [14,16,16,30,17,17,14], [31,1,2,4,8,8,8], [14,17,17,14,17,17,14], [14,17,17,15,1,1,14]
];
function draw(points, width, height, rectangle) {
  // Keep digits legible after the provider scales down a tall phone screenshot.
  var scale = Math.max(4, Math.min(12, Math.floor(width / 100)));
  Object.keys(points).forEach(function (id) {
    var p = points[id], x = Math.floor(p[0] * width / 1000), y = Math.floor(p[1] * height / 1000), w = id.length * 6 * scale + 12, h = 7 * scale + 12;
    var left = Math.max(0, x - Math.floor(w / 2)), top = Math.max(0, y - Math.floor(h / 2));
    rectangle(left, top, w, h, 0xff00ffff); rectangle(left + 3, top + 3, w - 6, h - 6, 0xff003c48);
    id.split('').forEach(function (digit, index) { DIGITS[Number(digit)].forEach(function (mask, row) { for (var col = 0; col < 5; col++) if (mask & 1 << 4 - col) rectangle(left + 6 + index * 6 * scale + col * scale, top + 6 + row * scale, scale, scale, 0xffffffff); }); });
  });
}
module.exports = { detect: detect, selected: selected, draw: draw, unchanged: unchanged };
