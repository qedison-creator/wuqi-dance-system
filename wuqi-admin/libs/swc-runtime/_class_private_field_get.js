"use strict";

var _class_apply_descriptor_get = require("./_class_apply_descriptor_get.js");
var _class_extract_field_descriptor = require("./_class_extract_field_descriptor.js");

function _class_private_field_get(receiver, privateMap) {
    var descriptor = _class_extract_field_descriptor._(receiver, privateMap, "get");
    return _class_apply_descriptor_get._(receiver, descriptor);
}
exports._ = _class_private_field_get;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_class_private_field_get'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
