/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const logger = require('../logger').child({ component: 'PromiseShim' })
const Shim = require('./shim')
const symbols = require('../symbols')
const { ClassWrapSpec } = require('./specs')

/**
 * Checks if function is actually not a function
 * or it is wrapped
 *
 * @private
 * @param {Shim} shim instance of shim
 * @param {Function} fn function to wrap
 * @returns {boolean} is already wrapped or not
 */
function isWrapped(shim, fn) {
  return shim.isFunction(fn) === false || shim.isWrapped(fn)
}

/**
 * A helper class for wrapping promise modules.
 *
 * @augments Shim
 */
/* eslint-disable camelcase */
class PromiseShim extends Shim {
  /**
   * Constructs a shim associated with the given agent instance, specialized for
   * instrumenting promise libraries.
   *
   * @param {Agent} agent The agent this shim will use.
   * @param {string} moduleName The name of the module being instrumented.
   * @param {string} resolvedName The full path to the loaded module.
   * @param {string} shimName Used to persist shim ids across different shim instances.
   * @param {string} pkgVersion version of module
   * @see Shim
   */
  constructor(agent, moduleName, resolvedName, shimName, pkgVersion) {
    super(agent, moduleName, resolvedName, shimName, pkgVersion)
    this._logger = logger.child({ module: moduleName })
    this._class = null
  }

  /**
   * Grants access to the `Contextualizer` class used by the `PromiseShim` to
   * propagate context down promise chains.
   *
   * @private
   * @returns {Contextualizer} contextualizer class
   */
  static get Contextualizer() {
    return Contextualizer
  }

  /**
   * Sets the class used to identify promises from the wrapped promise library.
   *
   * @param {Function} clss - The promise library's class.
   */
  setClass(clss) {
    this._class = clss
  }

  /**
   * Checks if the given object is an instance of a promise from the promise
   * library being wrapped.
   *
   * @param {*} obj - The object to check the instance type of.
   * @returns {boolean} True if the provided object is an instance of a promise from
   *  this promise library.
   * @see PromiseShim#setClass
   */
  isPromiseInstance(obj) {
    return !!this._class && obj instanceof this._class
  }

  /**
   * Wraps the given properties as constructors for the promise library.
   *
   * - `wrapConstructor(nodule, properties)`
   * - `wrapConstructor(func)`
   *
   * It is only necessary to wrap the constructor for the class if there is no
   * other way to access the executor function. Some libraries expose a separate
   * method which is called to execute the executor. If that is available, it is
   * better to wrap that using {@link PromiseShim#wrapExecutorCaller} than to
   * use this method.
   *
   * @param {object | Function} nodule
   *  The source of the properties to wrap, or a single function to wrap.
   * @param {string | Array.<string>} [properties]
   *  One or more properties to wrap. If omitted, the `nodule` parameter is
   *  assumed to be the constructor to wrap.
   * @returns {object | Function} The first parameter to this function, after
   *  wrapping it or its properties.
   * @see PromiseShim#wrapExecutorCaller
   */
  wrapConstructor(nodule, properties) {
    return this.wrapClass(
      nodule,
      properties,
      new ClassWrapSpec({
        // eslint-disable-next-line sonarjs/no-globals-shadowing
        pre: function prePromise(shim, Promise, name, args) {
          // We are expecting one function argument for executor, anything else is
          // non-standard, do not attempt to wrap. Also do not attempt to wrap if
          // we are not in a transaction.
          if (args.length !== 1 || !shim.isFunction(args[0]) || !shim.getActiveSegment()) {
            return
          }
          _wrapExecutorContext(shim, args)
        },
        // eslint-disable-next-line sonarjs/no-globals-shadowing
        post: function postPromise(shim, Promise, name, args) {
          const transaction = shim.tracer.getTransaction()
          // This extra property is added by `_wrapExecutorContext` in the pre step.
          const executor = args[0]
          const context = executor?.[symbols.executorContext]
          if (!context || !shim.isFunction(context.executor)) {
            return
          }

          context.promise = this
          Contextualizer.link(null, this, shim.getSegment(), transaction)
          try {
            // Must run after promise is defined so that `__NR_wrapper` can be set.
            context.executor.apply(context.self, context.args)
          } catch (e) {
            const reject = context.args[1]
            reject(e)
          }
        }
      })
    )
  }

  /**
   * Wraps the given properties as the caller of promise executors.
   *
   * - `wrapExecutorCaller(nodule, properties)`
   * - `wrapExecutorCaller(func)`
   *
   * Wrapping the executor caller method directly is preferable to wrapping
   * the constructor of the promise class.
   *
   * @param {object | Function} nodule
   *  The source of the properties to wrap, or a single function to wrap.
   * @param {string | Array.<string>} [properties]
   *  One or more properties to wrap. If omitted, the `nodule` parameter is
   *  assumed to be the function to wrap.
   * @returns {object | Function} The first parameter to this function, after
   *  wrapping it or its properties.
   * @see PromiseShim#wrapConstructor
   */
  wrapExecutorCaller(nodule, properties) {
    return this.wrap(nodule, properties, function executorWrapper(shim, caller) {
      if (isWrapped(shim, caller)) {
        return
      }

      return function wrappedExecutorCaller(...args) {
        const [executor] = args
        const parent = shim.getActiveSegment()
        const transaction = shim.tracer.getTransaction()
        if (!this || !parent) {
          return caller.apply(this, arguments)
        }

        if (!this[symbols.context]) {
          Contextualizer.link(null, this, parent, transaction)
        }

        _wrapExecutorContext(shim, args)
        const ret = caller.apply(this, args)
        const context = args[0][symbols.executorContext]
        context.promise = this

        // Bluebird catches executor errors and auto-rejects when it catches them,
        // thus we need to do so as well.
        //
        // When adding new libraries, make sure to check that they behave the same
        // way. We may need to enhance the promise spec to handle this variance.
        try {
          executor.apply(context.self, context.args)
        } catch (e) {
          const reject = context.args[1]
          reject(e)
        }
        return ret
      }
    })
  }

  /**
   * Wraps the given properties as methods which take is some value other than
   * a function to call and return a promise.
   *
   * - `wrapCast(nodule, properties)`
   * - `wrapCast(func)`
   *
   * Examples of promise cast methods include `Promise.resolve`, `Promise.all`,
   * and Bluebird's `Promise.delay`. These are static methods which accept some
   * arbitrary value and return a Promise instance.
   *
   * @param {object | Function} nodule
   *  The source of the properties to wrap, or a single function to wrap.
   * @param {string | Array.<string>} [properties]
   *  One or more properties to wrap. If omitted, the `nodule` parameter is
   *  assumed to be the function to wrap.
   * @returns {object | Function} The first parameter to this function, after
   *  wrapping it or its properties.
   */
  wrapCast(nodule, properties) {
    return this.wrap(nodule, properties, function castWrapper(shim, cast) {
      if (isWrapped(shim, cast)) {
        return
      }

      return function __NR_wrappedCast() {
        const segment = shim.getSegment()
        const transaction = shim.tracer.getTransaction()
        const prom = cast.apply(this, arguments)
        if (segment) {
          Contextualizer.link(null, prom, segment, transaction)
        }
        return prom
      }
    })
  }

  /**
   * Wraps the given properties as promise chaining methods.
   *
   * - `wrapThen(nodule, properties)`
   * - `wrapThen(func)`
   *
   * NOTE: You must set class used by the library before wrapping then-methods.
   *
   * Examples of promise then methods include `Promise#then`, `Promise#finally`,
   * and Bluebird's `Promise#map`. These are methods which take a function to
   * execute once the promise resolves and hands back a new promise.
   *
   * @param {object | Function} nodule
   *  The source of the properties to wrap, or a single function to wrap.
   * @param {string | Array.<string>} [properties]
   *  One or more properties to wrap. If omitted, the `nodule` parameter is
   *  assumed to be the function to wrap.
   * @returns {object | Function} The first parameter to this function, after
   *  wrapping it or its properties.
   * @see PromiseShim#setClass
   * @see PromiseShim#wrapCatch
   */
  wrapThen(nodule, properties) {
    return this.wrap(nodule, properties, _wrapThen, [true])
  }

  /**
   * Wraps the given properties as rejected promise chaining methods.
   *
   * - `wrapCatch(nodule, properties)`
   * - `wrapCatch(func)`
   *
   * NOTE: You must set class used by the library before wrapping catch-methods.
   *
   * Promise catch methods differ from then methods in that only one function
   * will be executed and only if the promise is rejected. Some libraries accept
   * an additional argument to `Promise#catch` which is usually an error class
   * to filter rejections by. This wrap method will handle that case.
   *
   * @param {object | Function} nodule
   *  The source of the properties to wrap, or a single function to wrap.
   * @param {string | Array.<string>} [properties]
   *  One or more properties to wrap. If omitted, the `nodule` parameter is
   *  assumed to be the function to wrap.
   * @returns {object | Function} The first parameter to this function, after
   *  wrapping it or its properties.
   * @see PromiseShim#setClass
   * @see PromiseShim#wrapThen
   */
  wrapCatch(nodule, properties) {
    return this.wrap(nodule, properties, _wrapThen, [false])
  }

  /**
   * Wraps the given properties as callback-to-promise conversion methods.
   *
   * - `wrapPromisify(nodule, properties)`
   * - `wrapPromisify(func)`
   *
   * @param {object | Function} nodule
   *  The source of the properties to wrap, or a single function to wrap.
   * @param {string | Array.<string>} [properties]
   *  One or more properties to wrap. If omitted, the `nodule` parameter is
   *  assumed to be the function to wrap.
   * @returns {object | Function} The first parameter to this function, after
   *  wrapping it or its properties.
   */
  wrapPromisify(nodule, properties) {
    return this.wrap(nodule, properties, function promisifyWrapper(shim, promisify) {
      if (isWrapped(shim, promisify)) {
        return
      }

      return function __NR_wrappedPromisify() {
        const promisified = promisify.apply(this, arguments)
        if (typeof promisified !== 'function') {
          return promisified
        }

        Object.keys(promisified).forEach(function forEachProperty(prop) {
          __NR_wrappedPromisified[prop] = promisified[prop]
        })

        return __NR_wrappedPromisified
        /**
         * Returns wrapped promise that binds the active segment accordingly
         *
         * @returns {Promise} promise bound to active segment
         */
        function __NR_wrappedPromisified() {
          const context = shim.tracer.getContext()
          const segment = shim.getActiveSegment()
          const transaction = shim.tracer.getTransaction()
          if (!segment) {
            return promisified.apply(this, arguments)
          }

          const prom = shim.applyContext({
            func: promisified,
            context,
            full: true,
            boundThis: this,
            args: arguments
          })
          Contextualizer.link(null, prom, segment, transaction)
          return prom
        }
      }
    })
  }
}
module.exports = PromiseShim

// -------------------------------------------------------------------------- //

/**
 * @param {object} shim instance of shim
 * @param {Array} args arguments passed to executor function
 * @private
 */
function _wrapExecutorContext(shim, args) {
  const context = {
    executor: args[0],
    promise: null,
    self: null,
    args: null
  }
  contextExporter[symbols.executorContext] = context
  args[0] = contextExporter

  /**
   *
   * @param {Function} resolve function of promise
   * @param {Function} reject function of promise
   * @param {...any} args
   */
  function contextExporter(...args) {
    const [resolve, reject] = args
    context.self = this
    context.args = args
    context.args[0] = _wrapResolver(context, resolve)
    context.args[1] = _wrapResolver(context, reject)
  }
}

/**
 * @private
 * @param {object} context context object
 * @param {Function} fn function that is wrapped
 * @returns {Function} wrapped function
 * @private
 */
function _wrapResolver(context, fn) {
  return function wrappedResolveReject(val) {
    const promise = context.promise
    promise?.[symbols.context]?.getSegment()?.touch()
    fn(val)
  }
}

/**
 *
 * @private
 * @param {object} params object passed to wrapHandler
 * @param {Function} params.handler to wrap
 * @param {number} params.index index of argument
 * @param {number} params.argsLength length of args
 * @param {boolean} params.useAllParams flag to use all params
 * @param {object} params.ctx context passed in to store the next handler and isWrapped
 * @param {object} params.shim shim instance
 * @returns {Function} wrapped function
 */
function wrapHandler({ handler, index, argsLength, useAllParams, ctx, shim }) {
  if (
    isWrapped(shim, handler) ||
    (!useAllParams && index !== argsLength - 1) // Don't want all and not last
  ) {
    ctx.isWrapped = shim.isWrapped(handler)
    return handler
  }

  return function __NR_wrappedThenHandler() {
    if (!ctx?.handler?.[symbols.context]) {
      return handler.apply(this, arguments)
    }

    let promSegment = ctx.handler[symbols.context].getSegment()
    const segment = promSegment || shim.getSegment()
    if (segment && segment !== promSegment) {
      ctx.handler[symbols.context].setSegment(segment)
      promSegment = segment
    }
    const transaction = ctx.handler[symbols.context].getTransaction()

    let context = shim.tracer.getContext()
    context = context.enterSegment({ transaction, segment: promSegment })
    let ret = shim.applyContext({
      func: handler,
      context,
      full: true,
      boundThis: this,
      args: arguments
    })
    if (ret && typeof ret.then === 'function') {
      ret = ctx.handler[symbols.context].continueContext(ret)
    }

    return ret
  }
}

/**
 * @param {object} shim instance of shim
 * @param {Function} fn function that is wrapped
 * @param {string} _name function name(unused)
 * @param {boolean} useAllParams flag to indicate if all params of function are used
 * @returns {Function|undefined} wrapped function
 * @private
 */
function _wrapThen(shim, fn, _name, useAllParams) {
  // Don't wrap non-functions.
  if (isWrapped(shim, fn)) {
    return
  }

  return function __NR_wrappedThen() {
    if (!(this instanceof shim._class)) {
      return fn.apply(this, arguments)
    }

    const transaction = shim.tracer.getTransaction()

    const thenSegment = shim.getSegment()
    const promise = this

    // store isWrapped and current handler on context object to be passed into wrapHandler
    const ctx = { isWrapped: false, handler: null }

    const args = new Array(arguments.length)
    for (let i = 0; i < arguments.length; ++i) {
      args[i] = wrapHandler({
        shim,
        handler: arguments[i],
        index: i,
        argsLength: arguments.length,
        useAllParams,
        ctx
      })
    }
    ctx.handler = fn.apply(this, args)

    // If we got a promise (which we should have), link the parent's context.
    if (!ctx.isWrapped && ctx.handler instanceof shim._class && ctx.handler !== promise) {
      Contextualizer.link(promise, ctx.handler, thenSegment, transaction)
    }
    return ctx.handler
  }
}

/**
 * @private
 */
class Context {
  constructor(segment, transaction) {
    this.segments = [segment]
    this.transaction = transaction
  }

  branch() {
    return this.segments.push(null) - 1
  }
}

/**
 * @private
 */
class Contextualizer {
  constructor(idx, context) {
    this.parentIdx = -1
    this.idx = idx
    this.context = context
    this.child = null
  }

  /**
   * Iterate over the children and assign parent/child relationship
   * via parentIdx and idx of contextualizer.
   *
   * The first child needs to be updated to have its own branch as well. And
   * each of that child's children must be updated with the new parent index.
   * This is the only non-constant-time action for linking, but it only
   * happens with branching promise chains specifically when the 2nd branch
   * is added.
   *
   * Note: This does not account for branches of branches. That may result
   * in improperly parented segments.
   *
   * @param {Contextualizer} ctxlzr instance of contextualizer
   */
  static buildContextTree(ctxlzr) {
    // When the branch-point is the 2nd through nth link in the chain, it is
    // necessary to track its segment separately so the branches can parent
    // their segments on the branch-point.
    if (ctxlzr.parentIdx !== -1) {
      ctxlzr.idx = ctxlzr.context.branch()
    }

    let parent = ctxlzr
    let child = ctxlzr.child
    const branchIdx = ctxlzr.context.branch()
    do {
      child.parentIdx = parent.idx
      child.idx = branchIdx
      parent = child
      child = child.child
    } while (child)

    // We set the child to something falsey that isn't `null` so we can
    // distinguish between having no child, having one child, and having
    // multiple children.
    ctxlzr.child = false
  }

  static link(prev, next, segment, transaction) {
    let ctxlzr = prev && prev[symbols.context]
    if (ctxlzr && !ctxlzr.isActive()) {
      ctxlzr = prev[symbols.context] = null
    }

    if (ctxlzr) {
      // If prev has one child already, branch the context and update the child.
      if (ctxlzr.child) {
        Contextualizer.buildContextTree(ctxlzr)
      }

      // If this is a branching link then create a new branch for the next promise.
      // Otherwise, we can just piggy-back on the previous link's spot.
      const idx = ctxlzr.child === false ? ctxlzr.context.branch() : ctxlzr.idx

      // Create a new context for this next promise.
      next[symbols.context] = new Contextualizer(idx, ctxlzr.context)
      next[symbols.context].parentIdx = ctxlzr.idx

      // If this was our first child, remember it in case we have a 2nd.
      if (ctxlzr.child === null) {
        ctxlzr.child = next[symbols.context]
      }
    } else if (segment) {
      // This next promise is the root of a chain. Either there was no previous
      // promise or the promise was created out of context.
      next[symbols.context] = new Contextualizer(0, new Context(segment, transaction))
    }
  }

  isActive() {
    const segments = this.context.segments
    const segment = segments[this.idx] || segments[this.parentIdx] || segments[0]
    const transaction = this.getTransaction()
    return segment && transaction?.isActive()
  }

  getTransaction() {
    return this.context.transaction
  }

  getSegment() {
    const segments = this.context.segments
    let segment = segments[this.idx]
    if (segment == null) {
      segment = segments[this.idx] = segments[this.parentIdx] || segments[0]
    }
    return segment
  }

  setSegment(segment) {
    this.context.segments[this.idx] = segment
    return this.context.segments[this.idx]
  }

  toJSON() {
    // No-op.
  }

  continueContext(prom) {
    const self = this
    const nextContext = prom[symbols.context]
    if (!nextContext) {
      return prom
    }

    // If we have `finally`, use that to sneak our context update.
    if (typeof prom.finally === 'function') {
      return prom.finally(__NR_continueContext)
    }

    // No `finally` means we need to hook into resolve and reject individually and
    // pass through whatever happened.
    return prom.then(
      function __NR_thenContext(val) {
        __NR_continueContext()
        return val
      },
      function __NR_catchContext(err) {
        __NR_continueContext()
        throw err // Re-throwing promise rejection, this is not New Relic's error.
      }
    )

    /**
     *
     */
    function __NR_continueContext() {
      self.setSegment(nextContext.getSegment())
    }
  }
}
/* eslint-enable camelcase */
