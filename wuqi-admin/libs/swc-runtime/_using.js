"use strict";

/* @minVersion 7.22.0 */

function _using(stack, value, isAwait) {
    if (value === null || value === void 0) return value;
    if (Object(value) !== value) {
        throw new TypeError("using declarations can only be used with objects, functions, null, or undefined.");
    }
    // core-js-pure uses Symbol.for for polyfilling well-known symbols
    if (isAwait) {
        var dispose = value[Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose")];
    }
    if (dispose === null || dispose === void 0) {
        dispose = value[Symbol.dispose || Symbol.for("Symbol.dispose")];
    }
    if (typeof dispose !== "function") {
        throw new TypeError(`Property [Symbol.dispose] is not a function.`);
    }
    stack.push({ v: value, d: dispose, a: isAwait });
    return value;
}

exports._ = _using;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_using'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
