"use strict";

var _class_check_private_static_access = require("./_class_check_private_static_access.js");

function _class_static_private_method_get(receiver, classConstructor, method) {
    _class_check_private_static_access._(receiver, classConstructor);

    return method;
}
exports._ = _class_static_private_method_get;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_class_static_private_method_get'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
