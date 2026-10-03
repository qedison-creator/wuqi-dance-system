"use strict";

var _define_property = require("./_define_property.js");
var _super_prop_base = require("./_super_prop_base.js");

function set(target, property, value, receiver) {
    if (typeof Reflect !== "undefined" && Reflect.set) set = Reflect.set;
    else {
        set = function set(target, property, value, receiver) {
            var base = _super_prop_base._(target, property);
            var desc;
            if (base) {
                desc = Object.getOwnPropertyDescriptor(base, property);
                if (desc.set) {
                    desc.set.call(receiver, value);

                    return true;
                } else if (!desc.writable) {
                    return false;
                }
            }
            desc = Object.getOwnPropertyDescriptor(receiver, property);
            if (desc) {
                if (!desc.writable) return false;
                desc.value = value;
                Object.defineProperty(receiver, property, desc);
            } else {
                _define_property._(receiver, property, value);
            }

            return true;
        };
    }

    return set(target, property, value, receiver);
}

function _set(target, property, value, receiver, isStrict) {
    var s = set(target, property, value, receiver || target);
    if (!s && isStrict) throw new Error("failed to set property");

    return value;
}
exports._ = _set;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_set'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
