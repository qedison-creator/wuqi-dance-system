"use strict";

var _array_with_holes = require("./_array_with_holes.js");
var _iterable_to_array = require("./_iterable_to_array.js");
var _non_iterable_rest = require("./_non_iterable_rest.js");
var _unsupported_iterable_to_array = require("./_unsupported_iterable_to_array.js");

function _to_array(arr) {
    return _array_with_holes._(arr) || _iterable_to_array._(arr) || _unsupported_iterable_to_array._(arr) || _non_iterable_rest._();
}
exports._ = _to_array;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_to_array'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
