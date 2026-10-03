"use strict";

var _overload_yield = require("./_overload_yield.js");

function _async_generator_delegate(inner) {
    var iter = {}, waiting = false;

    function pump(key, value) {
        waiting = true;
        value = new Promise(function(resolve) {
            resolve(inner[key](value));
        });

        return { done: false, value: new _overload_yield._(value, /* kind: delegate */ 1) };
    }

    iter[(typeof Symbol !== "undefined" && Symbol.iterator) || "@@iterator"] = function() {
        return this;
    };

    iter.next = function(value) {
        if (waiting) {
            waiting = false;

            return value;
        }

        return pump("next", value);
    };

    if (typeof inner.throw === "function") {
        iter.throw = function(value) {
            if (waiting) {
                waiting = false;
                throw value;
            }

            return pump("throw", value);
        };
    }
    if (typeof inner.return === "function") {
        iter.return = function(value) {
            if (waiting) {
                waiting = false;
                return value;
            }
            return pump("return", value);
        };
    }

    return iter;
}
exports._ = _async_generator_delegate;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_async_generator_delegate'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
