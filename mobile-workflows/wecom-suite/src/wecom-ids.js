'use strict';

// WeCom keeps the same controls but changes their resource IDs between releases.
var profiles = {
  '5.0.12': {
    ncq: 'o6j', czp: 'db5', fg8: 'fwr', fg9: 'fws', hrr: 'ibi',
    ndh: 'o7a', ndw: 'o7p', og3: 'pce', mi0: 'n8x', i_6: 'iu5', i_d: 'ith', lba: 'm0f', n5o: 'nxc', km_: 'l_8',
    message_row: 'ixq', message_avatar: 'j3b'
  }
};
module.exports = { profile: function (version) { return profiles[version] || {}; } };
