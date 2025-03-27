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

const _isColdStart = () => {
  let isCold
  isCold = typeof isCold === 'undefined' ? true : false
  return isCold
}
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
  
  debugger
  //TODO: determine if streaming is enabled via app.setup, so app should be wrapped

  // wrap transaction enders
  /// wrap AzFuncError
  // wrap fatal errors
  // wrap http
  // wrap handler
  // wrapAzureApp(shim, azureFunctions.app)
  shim.wrap(azureFunctions.app.generic.prototype, 'handleRequest', wrapAzureGeneric)
  shim.wrapReturn(azureFunctions.app.generic.prototype, 'makeRequest', wrapMakeRequest)

  // wrapAzureGeneric(shim, azureFunctions.app?.generic)
  //  
  // wrapAzureHttp(shim, azureFunctions.app.http)
}

//function instrument(shim, AWS) {
//   shim.wrap(AWS.NodeHttpClient.prototype, 'handleRequest', wrapHandleRequest)
//   shim.wrapReturn(AWS.Service.prototype, 'makeRequest', wrapMakeRequest)
// }

function wrapAzureGeneric(shim, generic) {
  debugger
  return shim.wrap(generic, 'generic', function wrapGeneric(shim, fn) {
    if (!shim.isFunction(fn)) {
      return fn
    }

    return function wrappedGeneric() {
      const args = shim.argsToArray.apply(shim, arguments)
      const fnName = args[0]
      const fnOptions = args[1]
      if (!shim.isFunction(fnOptions?.handler)) {
        return fnOptions?.handler
      }
      
      args[1].handler = wrapHandler(shim, args[1].handler, httpFnOptions)
    
      return fn.apply(args)
    }
  })
}

function wrapAzureHttp(shim, http) {
  debugger
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
      
      args[1].handler = wrapHandler(shim, args[1].handler, httpFnOptions)
    
      return fn.apply(args)
    }
  })
}

function wrapHandler(shim, handler, options) {
  const transaction = shim.tracer.getTransaction()
  return function wrappedHandler() {
    const request = arguments[0]
    const context = arguments[1]
    const azureAttributes = {
      'cloud.resource_id': createCloudResourceId(context),
      'faas.name': `${process.env.WEBSITE_SITE_NAME}/${context.functionName}`, 
      'faas.trigger': '',
      'faas.invocation_id': context.invocationId
    }
    // context.options.trigger shows the default defined trigger options, not the specific one used
    // though individual .get .post .put .patch .deleteRequest methods are rewritten for .http as a single-element 
    // array matching the HTTP method
    
    // detect cold start, and report only if true
    if (isColdStart()) {
      azureAttributes.coldStart = true
    }

    transaction.trace.attributes.addAttributes(ATTR_DEST.TRANS_COMMON, azureAttributes)

    // wrap request
    // wrap handler return

    return handler.apply(this.arguments)
  }
  
  function createCloudResourceId(context) {
    const { subscriptionId, resourceGroupName} = getSubscriptionAndResource()
    const azureFnAppName = process.env.WEBSITE_SITE_NAME // may not exist when run locally
    const functionName = context.functionName
    const parts = [
      'subscriptions',
      subscriptionId,
      'resourceGroups',
      resourceGroupName,
      'providers',
      'Microsoft.Web',
      'sites',
      azureFnAppName,
      'functions',
      functionName
    ]
    
    return `/${parts.join('/')}/`
  }

  function getSubscriptionAndResource() {
    const subscriptionId = process.env.WEBSITE_OWNER_NAME.split('+')[0]
    const regex = '([a-zA-Z0-9\-]+)-[a-zA-Z0-9]+(?:-Linux)?'
    const resourceGroupName = process.env.WEBSITE_RESOURCE_GROUP || process.env.WEBSITE_OWNER_NAME.match(regex)[0]
    return {subscriptionId, resourceGroupName}
  }
}

function wrapMakeRequest(shim, fn, name, request) {
  if (!request) {
    shim.logger.trace('No request object returned from Service#makeRequest')
    return
  }

  request.on('complete', function onAzureRequestComplete() {
    const httpRequest = request.httpRequest && request.httpRequest.stream
    const segment = shim.getSegment(httpRequest)
    if (!httpRequest || !segment) {
      shim.logger.trace('No segment found for request, not extracting information.')
      return
    }

    const requestRegion = request?.httpRequest?.region
    const requestId = request?.response?.requestId
    
    // add azure-request-specific attrs

    // segment.addAttribute('azure.attribute', request.attribute || UNKNOWN)
  })

  shim.wrap(request, 'promise', function wrapPromiseFunc(shim, original) {
    const activeSegment = shim.getActiveSegment()

    return function wrappedPromiseFunc() {
      if (!activeSegment) {
        return original.apply(this, arguments)
      }

      const promise = shim.applySegment(original, activeSegment, false, this, arguments)

      return shim.bindPromise(promise, activeSegment)
    }
  })
}
