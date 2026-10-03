"use strict";

var _construct = require("./_construct.js");
var _get_prototype_of = require("./_get_prototype_of.js");
var _is_native_function = require("./_is_native_function.js");
var _set_prototype_of = require("./_set_prototype_of.js");

function _wrap_native_super(Class) {
    var _cache = typeof Map === "function" ? new Map() : undefined;
    exports._ = _wrap_native_super = function(Class) {
        if (Class === null || !_is_native_function._(Class)) return Class;
        if (typeof Class !== "function") throw new TypeError("Super expression must either be null or a function");
        if (typeof _cache !== "undefined") {
            if (_cache.has(Class)) return _cache.get(Class);
            _cache.set(Class, Wrapper);
        }

        function Wrapper() {
            return _construct._(Class, arguments, _get_prototype_of._(this).constructor);
        }
        Wrapper.prototype = Object.create(Class.prototype, { constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true } });

        return _set_prototype_of._(Wrapper, Class);
    };

    return _wrap_native_super(Class);
}
exports._ = _wrap_native_super;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_wrap_native_super'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
