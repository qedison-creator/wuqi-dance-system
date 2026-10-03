"use strict";

var _type_of = require("./_type_of.js");

function _to_primitive(input, hint) {
    if (_type_of._(input) !== "object" || input === null) return input;

    var prim = input[Symbol.toPrimitive];

    if (prim !== undefined) {
        var res = prim.call(input, hint || "default");
        if (_type_of._(res) !== "object") return res;
        throw new TypeError("@@toPrimitive must return a primitive value.");
    }

    return (hint === "string" ? String : Number)(input);
}
exports._ = _to_primitive;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_to_primitive'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
