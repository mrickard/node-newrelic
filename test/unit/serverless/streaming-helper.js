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
  HttpsResponseStream,
}

// Sample function adapted from
// https://github.com/aws-samples/serverless-patterns/blob/main/lambda-streaming-ttfb-write-sam/src/index.js
const sampleFunction = async (event, responseStream, context) => {
  const httpResponseMetadata = {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html',
      'X-Custom-Header': 'Example-Custom-Header'
    }
  }

  responseStream = awslambda.HttpsResponseStream.from(responseStream, httpResponseMetadata)

  responseStream.write('<html>')
  responseStream.write('<head>')
  responseStream.write('<title>Streaming HTML page</title>')
  responseStream.write('</head>')
  responseStream.write('<body>')

  responseStream.write('<h1>H1 of streaming page</h1>')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  responseStream.write('<h2>H2 of streaming page</h2>')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  responseStream.write('<h3>H3 of streaming page</h3>')
  await new Promise((resolve) => setTimeout(resolve, 1000))

  const loremIpsum = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque interdum non lectus id faucibus. Fusce in metus ut diam placerat lacinia. Proin fringilla massa non dignissim ultricies. Integer nec mollis purus. Nunc sollicitudin enim vitae eros commodo, sed faucibus lacus ultrices. Vestibulum euismod dictum turpis et porttitor. Sed ultrices, ipsum nec condimentum dignissim, velit lacus viverra nisl, eu accumsan tellus lectus et tellus. Etiam porta faucibus lacus, at congue felis congue sit amet. Integer iaculis fringilla sagittis. Vestibulum at orci ipsum. Suspendisse eros sapien, condimentum nec condimentum pretium, luctus vitae leo. Aenean ultrices mauris accumsan mollis mattis. Pellentesque pretium facilisis sapien quis hendrerit. Cras enim tortor, tristique ac libero ut, rhoncus pretium sem. Nullam aliquet lorem id est porta pharetra. Nunc posuere non ipsum eget congue.'
  responseStream.write(`<p>${loremIpsum}</p>`)
  await new Promise((resolve) => setTimeout(resolve, 1000))

  responseStream.write('<p>And that is the end of the stream.</p>')
  responseStream.write('</body>')
  responseStream.write('</html>')
  responseStream.end()
}

module.exports = { lambdaBuiltIns: awslambda, constants: { HANDLER_STREAMING }, sampleFunction }
