"use strict";

var _class_apply_descriptor_set = require("./_class_apply_descriptor_set.js");
var _class_check_private_static_access = require("./_class_check_private_static_access.js");
var _class_check_private_static_field_descriptor = require("./_class_check_private_static_field_descriptor.js");

function _class_static_private_field_spec_set(receiver, classConstructor, descriptor, value) {
    _class_check_private_static_access._(receiver, classConstructor);
    _class_check_private_static_field_descriptor._(descriptor, "set");
    _class_apply_descriptor_set._(receiver, descriptor, value);

    return value;
}
exports._ = _class_static_private_field_spec_set;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_class_static_private_field_spec_set'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
