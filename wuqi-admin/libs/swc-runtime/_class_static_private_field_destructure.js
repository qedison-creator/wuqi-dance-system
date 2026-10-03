"use strict";

var _class_apply_descriptor_destructure = require("./_class_apply_descriptor_destructure.js");
var _class_check_private_static_access = require("./_class_check_private_static_access.js");
var _class_check_private_static_field_descriptor = require("./_class_check_private_static_field_descriptor.js");

function _class_static_private_field_destructure(receiver, classConstructor, descriptor) {
    _class_check_private_static_access._(receiver, classConstructor);
    _class_check_private_static_field_descriptor._(descriptor, "set");

    return _class_apply_descriptor_destructure._(receiver, descriptor);
}
exports._ = _class_static_private_field_destructure;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_class_static_private_field_destructure'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
