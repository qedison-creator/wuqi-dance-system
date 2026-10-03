"use strict";

function _iterable_to_array_limit_loose(arr, i) {
    var _i = arr && (typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"]);

    if (_i == null) return;

    var _arr = [];

    for (_i = _i.call(arr), _step; !(_step = _i.next()).done;) {
        _arr.push(_step.value);
        if (i && _arr.length === i) break;
    }

    return _arr;
}
exports._ = _iterable_to_array_limit_loose;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_iterable_to_array_limit_loose'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
