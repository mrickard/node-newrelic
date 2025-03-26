/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
// const af = require('@azure/functions')
const recordWeb = require('#agentlib/metrics/recorders/http')
const recordBackground = require('#agentlib/metrics/recorders/other')
const urltils = require('#agentlib/util/urltils.js.js')
const { DESTINATIONS: ATTR_DEST } = require('#agentlib/config/attribute-filter.')
const headerAttributes = require('#agentlib/header-attributes')
const NAMES = require('#agentlib/metrics/names.js.js')
/**
 * Instruments the `@azure/functions` module. This function is
 * passed to `onRequire` when instantiating instrumentation.
 *
 * @param {object} _agent New Relic agent
 * @param {object} azureFunctions resolved module
 * @param {string} _moduleName string representation of require/import path
 * @param {object} shim New Relic shim
 * @returns {boolean|undefined}
 */
module.exports = function initialize(_agent, azureFunctions, _moduleName, shim) {
  if (!azureFunctions || !azureFunctions.app) {
    shim.logger.debug('Could not find Azure Functions app, not instrumenting.')
    return false
  }
  
  //TODO: determine if streaming is enabled via app.setup, so app should be wrapped

  // wrap transaction enders
  /// wrap AzFuncError
  // wrap fatal errors
  // wrap http
  // wrap handler
  // wrapAzureApp(shim, azureFunctions.app)
    
  wrapAzureHttp(shim, azureFunctions.app.http)
}

function wrapAzureHttp(shim, http) {
  return shim.wrap(http, 'http', function wrapHttp(shim, fn) {
    if (!shim.isFunction(fn)) {
      return fn
    }

    return function wrappedHttp() {
      const args = shim.argsToArray.apply(shim, arguments)
      const httpFnOptions = args[1]
      if (!shim.isFunction(httpFnOptions?.handler)) {
        return httpFnOptions?.handler
      }
      
      args[1].handler = wrapHandler(shim, args[1].handler)
    
      return fn.apply(args)
    }
  })
}

function wrapHandler(shim, handler) {
  const transaction = shim.tracer.getTransaction()
  return function wrappedHandler() {
    const request = arguments[0]
    const context = arguments[1]
    const azureAttributes = {
      'cloud.resource_id': '',
      'faas.name': context.functionName,
      'faas.trigger': '',
      'faas.invocation_id': context.invocationId
    }
    // assemble cloud resource ID
    // context.options.trigger shows the default defined trigger options, not the specific one used
    // detect cold start

    transaction.trace.attributes.addAttributes(ATTR_DEST.TRANS_COMMON, azureAttributes)

    // wrap request
    // wrap handler return

    return handler.apply(this.arguments)
  }
}
