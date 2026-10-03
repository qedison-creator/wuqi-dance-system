"use strict";

var _array_like_to_array = require("./_array_like_to_array.js");

function _array_without_holes(arr) {
    if (Array.isArray(arr)) return _array_like_to_array._(arr);
}
exports._ = _array_without_holes;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_array_without_holes'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
