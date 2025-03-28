/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const logger = require('../../logger').child({ component: '@azure/functions' })
// const af = require('@azure/functions')
// const recordWeb = require('#agentlib/metrics/recorders/http')
// const recordBackground = require('#agentlib/metrics/recorders/other')
// const urltils = require('#agentlib/util/urltils')
// const { DESTINATIONS: ATTR_DEST } = require('../../../lib/config/attribute-filter')
// const headerAttributes = require('#agentlib/header-attributes')
// const NAMES = require('#agentlib/metrics/names.js')
let isCold

const _isColdStart = () => {
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
  // transaction null
  // const transaction = shim.tracer.getTransaction()
  // console.log('transaction?', transaction)

  // inspect shim here

  // TODO: determine if streaming is enabled via app.setup, so app should be wrapped
  // wrap transaction enders
  // wrap AzFuncError
  // wrap fatal errors
  // wrap http
  // wrap handler
  // shim.wrap(azureFunctions.app.generic.prototype, 'handleRequest', wrapAzureGeneric)
  // shim.wrapReturn(azureFunctions.app.generic.prototype, 'makeRequest', wrapMakeRequest)

  wrapAzureApp(shim, azureFunctions.app)
}

// function instrument(shim, AWS) {
//   shim.wrap(AWS.NodeHttpClient.prototype, 'handleRequest', wrapHandleRequest)
//   shim.wrapReturn(AWS.Service.prototype, 'makeRequest', wrapMakeRequest)
// }

function wrapAzureApp(shim, app) {
  const methodsToWrap = ['generic', 'http', 'get', 'put', 'patch', 'post', 'deleteRequest']
  return shim.wrap(app, methodsToWrap, function wrapApp(shim, fn) {
    if (!shim.isFunction(fn)) {
      return fn
    }

    return function wrappedApp() {
      const args = shim.argsToArray.apply(shim, arguments)
      logger.trace('args', args)
      const fnName = args[0]
      const fnOptions = args[1]
      if (!shim.isFunction(fnOptions?.handler)) {
        return fnOptions?.handler
      }

      args[1].handler = wrapHandler(shim, args[1].handler, fnOptions)

      return fn.apply(this, args)
    }
  })
}

function wrapHandler(shim, handler, options) {
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
    if (_isColdStart()) {
      azureAttributes.coldStart = true
    }

    // currently transaction is null
    // transaction.trace.attributes.addAttributes(ATTR_DEST.TRANS_COMMON, azureAttributes)

    // wrap request
    // wrap handler return value

    return handler.apply(this, arguments)
  }

  function createCloudResourceId(context) {
    const { subscriptionId, resourceGroupName } = getSubscriptionAndResource()
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
    // this code needs to be defensive. These are always defined in Azure, but have to be supplied by local environments
    const subscriptionId = process.env.WEBSITE_OWNER_NAME.split('+')[0]
    const regex = '([a-zA-Z0-9-]+)-[a-zA-Z0-9]+(?:-Linux)?'
    const resourceGroupName = process.env.WEBSITE_RESOURCE_GROUP || process.env.WEBSITE_OWNER_NAME.match(regex)[0]
    return { subscriptionId, resourceGroupName }
  }
}
