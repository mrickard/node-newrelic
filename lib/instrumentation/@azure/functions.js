/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const TransactionShim = require('../../shim/transaction-shim')
const specs = require('../../shim/specs')
const logger = require('../../logger').child({ component: '@azure/functions' })

// need to make sure this is part of a transaction
// const TransactionShim = require('../../shim/transaction-shim')
// const specs = require('../../shim/specs');

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


  // wrap transaction enders
  // wrap AzFuncError
  // wrap fatal errors
  // wrap http
  // shim.wrap(azureFunctions.app.generic.prototype, 'handleRequest', wrapAzureGeneric)
  // shim.wrapReturn(azureFunctions.app.generic.prototype, 'makeRequest', wrapMakeRequest)

  // Shouldn't wrap azureFunctions app proto; it's undefined
  // const proto = azureFunctions.app.prototype

  wrapAzureWebApp(shim, azureFunctions.app)
  // wrapAzureBackgroundApp(shim, azureFunctions.app)
}

function wrapAzureWebApp(shim, app) {
  // TODO: determine if streaming is enabled via app.setup
  const methodsToWrap = ['generic', 'http', 'get', 'put', 'patch', 'post', 'deleteRequest', 'setup']
  return shim.wrap(app, methodsToWrap, function wrapApp(shim, fn) {
    if (!shim.isFunction(fn)) {
      return fn
    }
    // do we have a transaction after we've wrapped? No:
    // const transactionFromAgent = shim._agent.getTransaction() // null

    // The shim that's passed in here has a bare minimum of properties, and can't on its own create
    // a transaction.

    // shim top-level props here: [
    //   '_logger',
    //   '_agent',
    //   '_toExport',
    //   '_debug',
    //   'moduleName',
    //   'id',
    //   'pkgVersion',
    //   '_moduleRoot'
    // ]
    // so this shim does not have a tracer

    // creating a separate Transaction shim as we do in Lambda causes a firstpartyinstrumentation error in shimmer
    const txnShim = new TransactionShim(shim._agent, '@azure/functions')

    const wrapper = function wrappedApp() {
      const args = txnShim.argsToArray.apply(shim, arguments)
      logger.trace('args', args)
      const fnName = args[0]
      const fnOptions = args[1]

      // for get/post/put/patch/delete, args[1] could be an object of options including .handler,, or it could just be the handler
      if (typeof fnOptions === 'function') {
        args[1] = wrapHttpHandler(txnShim, args[1])
      } else if (txnShim.isFunction(args[1].handler)) {
        args[1].handler = wrapHttpHandler(txnShim, args[1].handler, fnOptions)
      }

      return fn.apply(this, args)
    }
    return txnShim.bindCreateTransaction(wrapper, new specs.TransactionSpec({ type: shim.WEB }))
  })
}

function wrapHttpHandler(shim, handler, options) {
  return function wrappedHandler() {
    const request = arguments[0]
    const context = arguments[1]

    // TODO: get the method from the wrapped method, or options...or metadata?
    // or from the request object
    const azureAttributes = {
      'cloud.resource_id': createCloudResourceId(context),
      'faas.name': `${process.env.WEBSITE_SITE_NAME}/${context.functionName}`,
      'faas.trigger': options?.methods || 'UNKNOWN',
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
