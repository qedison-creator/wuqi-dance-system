"use strict";

/* @minVersion 7.22.0 */
function dispose_SuppressedError(error, suppressed) {
    if (typeof SuppressedError !== "undefined") {
        // eslint-disable-next-line no-undef
        dispose_SuppressedError = SuppressedError;
    } else {
        dispose_SuppressedError = function SuppressedError(error, suppressed) {
            this.suppressed = suppressed;
            this.error = error;
            this.stack = new Error().stack;
        };
        dispose_SuppressedError.prototype = Object.create(Error.prototype, { constructor: { value: dispose_SuppressedError, writable: true, configurable: true } });
    }
    return new dispose_SuppressedError(error, suppressed);
}

function _dispose(stack, error, hasError) {
    function next() {
        while (stack.length > 0) {
            try {
                var r = stack.pop();
                var p = r.d.call(r.v);
                if (r.a) return Promise.resolve(p).then(next, err);
            } catch (e) {
                return err(e);
            }
        }
        if (hasError) throw error;
    }

    function err(e) {
        error = hasError ? new dispose_SuppressedError(e, error) : e;
        hasError = true;

        return next();
    }

    return next();
}

exports._ = _dispose;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_dispose'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
