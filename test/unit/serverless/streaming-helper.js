/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { HttpsResponseStream } = require('./HttpsResponseStream')

const HANDLER_STREAMING = Symbol.for('aws.lambda.runtime.handler.streaming')
const HANDLER_HIGHWATERMARK = Symbol.for(
  'aws.lambda.runtime.handler.streaming.highWaterMark'
)
const STREAM_RESPONSE = 'response'

// Definition of this object is from AWS's runtime client interface
// https://github.com/aws/aws-lambda-nodejs-runtime-interface-client/blob/main/src/UserFunction.js
const awslambda = {
  streamifyResponse: (handler, options) => {
    handler[HANDLER_STREAMING] = STREAM_RESPONSE
    if (typeof options?.highWaterMark === 'number') {
      handler[HANDLER_HIGHWATERMARK] = parseInt(options.highWaterMark)
    }
    return handler
  },
  HttpsResponseStream
}

module.exports = { lambdaBuiltIns: awslambda, constants: { HANDLER_STREAMING } }
