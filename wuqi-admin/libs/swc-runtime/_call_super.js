"use strict";

var _get_prototype_of = require("./_get_prototype_of.js");
var _is_native_reflect_construct = require("./_is_native_reflect_construct.js");
var _possible_constructor_return = require("./_possible_constructor_return.js");

function _call_super(_this, derived, args) {
    // Super
    derived = _get_prototype_of._(derived);
    return _possible_constructor_return._(
        _this,
        _is_native_reflect_construct._()
            // NOTE: This doesn't work if this.__proto__.constructor has been modified.
            ? Reflect.construct(derived, args || [], _get_prototype_of._(_this).constructor)
            : derived.apply(_this, args)
    );
}

exports._ = _call_super;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_call_super'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
