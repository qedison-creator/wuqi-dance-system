"use strict";

function _class_apply_descriptor_update(receiver, descriptor) {
    if (descriptor.set) {
        if (!descriptor.get) throw new TypeError("attempted to read set only private field");

        if (!("__destrWrapper" in descriptor)) {
            descriptor.__destrWrapper = {
                set value(v) {
                    descriptor.set.call(receiver, v);
                },
                get value() {
                    return descriptor.get.call(receiver);
                }
            };
        }

        return descriptor.__destrWrapper;
    } else {
        if (!descriptor.writable) {
            // This should only throw in strict mode, but class bodies are
            // always strict and private fields can only be used inside
            // class bodies.
            throw new TypeError("attempted to set read only private field");
        }

        return descriptor;
    }
}
exports._ = _class_apply_descriptor_update;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_class_apply_descriptor_update'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
