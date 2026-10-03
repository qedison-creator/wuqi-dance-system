"use strict";

var _unsupported_iterable_to_array = require("./_unsupported_iterable_to_array.js");

function _create_for_of_iterator_helper_loose(o, allowArrayLike) {
    var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];

    if (it) return (it = it.call(o)).next.bind(it);
    // Fallback for engines without symbol support
    if (Array.isArray(o) || (it = _unsupported_iterable_to_array._(o)) || allowArrayLike && o && typeof o.length === "number") {
        if (it) o = it;

        var i = 0;

        return function() {
            if (i >= o.length) return { done: true };

            return { done: false, value: o[i++] };
        };
    }

    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
exports._ = _create_for_of_iterator_helper_loose;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_create_for_of_iterator_helper_loose'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
