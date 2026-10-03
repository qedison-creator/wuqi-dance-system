"use strict";

var _to_primitive = require("./_to_primitive.js");
var _type_of = require("./_type_of.js");

function _to_property_key(arg) {
    var key = _to_primitive._(arg, "string");

    return _type_of._(key) === "symbol" ? key : String(key);
}
exports._ = _to_property_key;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_to_property_key'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
