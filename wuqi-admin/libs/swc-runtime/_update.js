"use strict";

var _get = require("./_get.js");
var _set = require("./_set.js");

function _update(target, property, receiver, isStrict) {
    return {
        get _() {
            return _get._(target, property, receiver);
        },
        set _(value) {
            _set._(target, property, value, receiver, isStrict);
        }
    };
}
exports._ = _update;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_update'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
