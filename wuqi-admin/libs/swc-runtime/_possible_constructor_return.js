"use strict";

var _assert_this_initialized = require("./_assert_this_initialized.js");
var _type_of = require("./_type_of.js");

function _possible_constructor_return(self, call) {
    if (call && (_type_of._(call) === "object" || typeof call === "function")) return call;

    return _assert_this_initialized._(self);
}
exports._ = _possible_constructor_return;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_possible_constructor_return'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
