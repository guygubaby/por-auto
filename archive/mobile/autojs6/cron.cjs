'use strict';

function parse(expression) {
  if (typeof expression !== 'string' || expression.length > 200) throw new Error('Cron 表达式无效');
  var parts = expression.trim().toUpperCase().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron 需要五段：分 时 日 月 周');
  var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  function field(text, min, max, aliases, sunday) {
    var values = [];
    function number(text) {
      var index = aliases.indexOf(text);
      var value = index < 0 ? /^\d{1,2}$/.test(text) ? Number(text) : NaN : index + min;
      if (!isFinite(value) || value % 1 || value < min || value > max) throw new Error('Cron 字段超出范围或格式无效');
      return value;
    }
    text.split(',').forEach(function (item) {
      var step = item.split('/');
      if (step.length > 2 || !step[0] || step.length === 2 && !/^\d{1,2}$/.test(step[1])) throw new Error('Cron 步长无效');
      var stride = step.length === 2 ? Number(step[1]) : 1;
      if (!stride || stride > max - min + 1) throw new Error('Cron 步长超出范围');
      var range = step[0] === '*' ? [min, max] : step[0].split('-').map(number);
      if (!range.length || range.length > 2 || range.length === 2 && range[0] > range[1]) throw new Error('Cron 范围无效');
      var end = range.length === 2 ? range[1] : step.length === 2 ? max : range[0];
      for (var n = range[0]; n <= end; n += stride) {
        var actual = sunday && n === 7 ? 0 : n;
        if (values.indexOf(actual) < 0) values.push(actual);
      }
    });
    return { values: values.sort(function (a, b) { return a - b; }), wildcard: text === '*' };
  }
  return [field(parts[0], 0, 59, []), field(parts[1], 0, 23, []), field(parts[2], 1, 31, []), field(parts[3], 1, 12, months), field(parts[4], 0, 7, weekdays, true)];
}

function next(expression, timezone, after, io) {
  var fields = parse(expression);
  io.validateZone(timezone);
  if (typeof after !== 'number' || !isFinite(after) || after % 1 || after < 0 || after > 250000000000000) throw new Error('计算时间超出支持范围');
  function has(index, value) { return fields[index].values.indexOf(value) >= 0; }
  // ZoneOffset is bounded by +/-18 h; scanning civil days this way also covers midnight clock changes.
  var day = Math.floor((after - 18 * 3600000) / 86400000) * 86400000, best = null;
  for (var i = 0; i <= 146097 + 2; i++, day += 86400000) {
    if (best !== null && day - 18 * 3600000 > best) return best;
    var date = new Date(day), dom = has(2, date.getUTCDate()), dow = has(4, date.getUTCDay());
    if (!has(3, date.getUTCMonth() + 1) || !(fields[2].wildcard || fields[4].wildcard ? dom && dow : dom || dow)) continue;
    fields[1].values.forEach(function (hour) {
      fields[0].values.forEach(function (minute) {
        var nominal = day + hour * 3600000 + minute * 60000;
        if (nominal + 18 * 3600000 <= after || best !== null && nominal - 18 * 3600000 >= best) return;
        // The adapter returns no instant in a DST gap and only the first instant in a repeated minute.
        var instant = io.cronInstant(timezone, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute);
        if (instant !== null && (typeof instant !== 'number' || !isFinite(instant) || instant % 1 || Math.abs(instant - nominal) > 18 * 3600000)) throw new Error('时区计算结果无效');
        if (instant !== null && instant > after && (best === null || instant < best)) best = instant;
      });
    });
  }
  if (best !== null) return best;
  throw new Error('Cron 没有可用的未来时间，请检查日期');
}

module.exports = { parse: parse, next: next };
