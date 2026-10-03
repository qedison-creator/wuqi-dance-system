"use strict";

function _initializer_warning_helper(descriptor, context) {
    throw new Error(
        "Decorating class property failed. Please ensure that "
            + "proposal-class-properties is enabled and set to use loose mode. "
            + "To use proposal-class-properties in spec mode with decorators, wait for "
            + "the next major version of decorators in stage 2."
    );
}
exports._ = _initializer_warning_helper;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_initializer_warning_helper'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
