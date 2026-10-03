"use strict";

var _is_native_reflect_construct = require("./_is_native_reflect_construct.js");
var _set_prototype_of = require("./_set_prototype_of.js");
function _construct(Parent, args, Class) {
    if (_is_native_reflect_construct._()) exports._ = _construct = Reflect.construct;
    else {
        exports._ = _construct = function construct(Parent, args, Class) {
            var a = [null];
            a.push.apply(a, args);
            var Constructor = Function.bind.apply(Parent, a);
            var instance = new Constructor();

            if (Class) _set_prototype_of._(instance, Class.prototype);

            return instance;
        };
    }

    return _construct.apply(null, arguments);
}
exports._ = _construct;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_construct'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
