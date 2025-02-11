/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { Stream } = require('node:stream')

// a basic version of AWS's response stream for Lambda, for testing

class HttpsResponseStream extends Stream.Writable {
  getContentType() {
    return this._contentType
  }

  setContentType(contentType) {
    this._contentType = contentType
  }

  static from(originalStream, prelude) {
    originalStream.setContentType('application/vnd.awslambda.http-integration-response')

    const streamMetaData = JSON.stringify(prelude)
    originalStream._onBeforeFirstWrite = (write) => {
      write(streamMetaData)
      write(new Uint8Array(0))
    }
    return originalStream
  }
}

module.exports = { HttpsResponseStream }
