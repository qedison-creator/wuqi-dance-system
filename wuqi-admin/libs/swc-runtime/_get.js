"use strict";

var _super_prop_base = require("./_super_prop_base.js");

function _get(target, property, receiver) {
    if (typeof Reflect !== "undefined" && Reflect.get) exports._ = _get = Reflect.get;
    else {
        exports._ = _get = function get(target, property, receiver) {
            var base = _super_prop_base._(target, property);

            if (!base) return;

            var desc = Object.getOwnPropertyDescriptor(base, property);

            if (desc.get) return desc.get.call(receiver || target);

            return desc.value;
        };
    }

    return _get(target, property, receiver || target);
}
exports._ = _get;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_get'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
