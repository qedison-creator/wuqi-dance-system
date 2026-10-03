"use strict";

function _async_iterator(iterable) {
    var method, async, sync, retry = 2;
    for ("undefined" != typeof Symbol && (async = Symbol.asyncIterator, sync = Symbol.iterator); retry--;) {
        if (async && null != (method = iterable[async])) return method.call(iterable);
        if (sync && null != (method = iterable[sync])) return new AsyncFromSyncIterator(method.call(iterable));
        async = "@@asyncIterator", sync = "@@iterator";
    }
    throw new TypeError("Object is not async iterable");
}
function AsyncFromSyncIterator(s) {
    function AsyncFromSyncIteratorContinuation(r) {
        if (Object(r) !== r) return Promise.reject(new TypeError(r + " is not an object."));

        var done = r.done;

        return Promise.resolve(r.value).then(function(value) {
            return { value: value, done: done };
        });
    }

    return AsyncFromSyncIterator = function(s) {
        this.s = s, this.n = s.next;
    },
        AsyncFromSyncIterator.prototype = {
            s: null,
            n: null,

            next: function() {
                return AsyncFromSyncIteratorContinuation(this.n.apply(this.s, arguments));
            },
            return: function(value) {
                var ret = this.s.return;

                return void 0 === ret ? Promise.resolve({ value: value, done: !0 }) : AsyncFromSyncIteratorContinuation(ret.apply(this.s, arguments));
            },
            throw: function(value) {
                var thr = this.s.return;

                return void 0 === thr ? Promise.reject(value) : AsyncFromSyncIteratorContinuation(thr.apply(this.s, arguments));
            }
        },
        new AsyncFromSyncIterator(s);
}
exports._ = _async_iterator;

// ===== swc-runtime compat（由 gen-swc-runtime.js 追加）=====
(function () {
  try {
    var keys = Object.keys(module.exports);
    var main = null;
    for (var i = 0; i < keys.length; i++) {
      if (typeof module.exports[keys[i]] === 'function') { main = module.exports[keys[i]]; break; }
    }
    if (typeof main !== 'function' || typeof module.exports === 'function') return;
    main['_async_iterator'] = main;
    main._ = main;
    main.default = main;
    module.exports = main;
  } catch (e) { /* 保持原导出 */ }
})();
