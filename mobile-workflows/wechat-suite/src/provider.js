'use strict';

function imageSupport(value, model) {
  if (!value || !Array.isArray(value.data)) return null;
  var entry = value.data.filter(function (m) { return m && m.id === model; })[0];
  var inputs = entry && entry.modalities && entry.modalities.input;
  if (!Array.isArray(inputs) || !inputs.length || inputs.some(function (v) { return typeof v !== 'string'; })) return null;
  return inputs.indexOf('image') >= 0;
}
module.exports = { imageSupport: imageSupport };
