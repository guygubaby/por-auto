module.exports = function (por) {
  var message = require('./lib/message.js');
  var config = por.readConfig();
  config.runs = (typeof config.runs === 'number' ? config.runs : 0) + 1;
  por.saveConfig(config);
  por.log(message(por.version), { runs: config.runs });
  toast(message(por.version) + '\n第 ' + config.runs + ' 次运行');
};
