"use strict";

var _get_prototype_of = require("./_get_prototype_of.js");
var _is_native_reflect_construct = require("./_is_native_reflect_construct.js");
var _possible_constructor_return = require("./_possible_constructor_return.js");

function _create_super(Derived) {
    var hasNativeReflectConstruct = _is_native_reflect_construct._();

    return function _createSuperInternal() {
        var Super = _get_prototype_of._(Derived), result;

        if (hasNativeReflectConstruct) {
            var NewTarget = _get_prototype_of._(this).constructor;
            result = Reflect.construct(Super, arguments, NewTarget);
        } else {
            result = Super.apply(this, arguments);
        }

        return _possible_constructor_return._(this, result);
    };
}
exports._ = _create_super;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_create_super'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
