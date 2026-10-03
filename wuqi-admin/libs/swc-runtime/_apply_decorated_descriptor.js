"use strict";

function _apply_decorated_descriptor(target, property, decorators, descriptor, context) {
    var desc = {};

    Object["ke" + "ys"](descriptor).forEach(function(key) {
        desc[key] = descriptor[key];
    });
    desc.enumerable = !!desc.enumerable;
    desc.configurable = !!desc.configurable;

    if ("value" in desc || desc.initializer) desc.writable = true;
    desc = decorators.slice().reverse().reduce(function(desc, decorator) {
        return decorator ? decorator(target, property, desc) || desc : desc;
    }, desc);

    var hasAccessor = Object.prototype.hasOwnProperty.call(desc, "get") || Object.prototype.hasOwnProperty.call(desc, "set");

    if (context && desc.initializer !== void 0 && !hasAccessor) {
        desc.value = desc.initializer ? desc.initializer.call(context) : void 0;
        desc.initializer = undefined;
    }
    if (hasAccessor) {
        delete desc.writable;
        delete desc.initializer;
        delete desc.value;
    }
    if (desc.initializer === void 0) {
        Object["define" + "Property"](target, property, desc);
        desc = null;
    }

    return desc;
}
exports._ = _apply_decorated_descriptor;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_apply_decorated_descriptor'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
