/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const Config = require('../config')
const { truncate } = require('../util/byte-limit')

const { DESTINATIONS } = require('../config/attribute-filter')
const { addSpanKind, isEntryPointSpan, reparentSpan, shouldCreateSpan, HTTP_LIBRARY, REGEXS, SPAN_KIND, CATEGORIES } = require('./helpers')
const EMPTY_USER_ATTRS = Object.freeze(Object.create(null))
const SERVER_ADDRESS = 'server.address'

/**
 * All the intrinsic attributes for span events, regardless of kind.
 */
class SpanIntrinsics {
  constructor() {
    this.type = 'Span'
    this.traceId = null
    this.guid = null
    this.parentId = null
    this.transactionId = null
    this.sampled = null
    this.priority = null
    this.name = null
    this.category = CATEGORIES.GENERIC
    this.component = null
    this.timestamp = null
    this.duration = null
    this['nr.entryPoint'] = null
    this['span.kind'] = null
    this.trustedParentId = null
    this.tracingVendors = null
  }
}

/**
 * General span event class.
 *
 * Do not construct directly, instead use one of the static `from*` methods such
 * as `SpanEvent.fromSegment`.
 *
 * @private
 * @class
 */
class SpanEvent {
  constructor(attributes, customAttributes) {
    this.customAttributes = customAttributes
    this.attributes = attributes
    this.intrinsics = new SpanIntrinsics()

    if (attributes.host) {
      this.addAttribute(SERVER_ADDRESS, attributes.host)
      attributes.host = null
    }

    if (attributes.port) {
      this.addAttribute('server.port', attributes.port, true)
      attributes.port = null
    }
  }

  getIntrinsicAttributes() {
    return this.intrinsics
  }

  addIntrinsicAttribute(key, value) {
    this.intrinsics[key] = value
  }

  static get CATEGORIES() {
    return CATEGORIES
  }

  static get DatastoreSpanEvent() {
    return DatastoreSpanEvent
  }

  static get HttpSpanEvent() {
    return HttpSpanEvent
  }

  /**
   * Constructs a `SpanEvent` from the given segment.
   *
   * The constructed span event will contain extra data depending on the
   * category of the segment.
   *
   * @param {TraceSegment} segment segment to turn into a span event.
   * @param {Transaction} transaction active transaction
   * @param {?string} [parentId] ID of the segment's parent.
   * @param {boolean} isRoot if segment is root segment
   * @param {boolean} inProcessSpans if the segment is in-process, create span
   * @returns {SpanEvent} The constructed event.
   */
  static fromSegment({ segment, transaction, parentId = null, isRoot = false, inProcessSpans }) {
    const entryPoint = isEntryPointSpan({ segment, transaction })
    if (!inProcessSpans && !shouldCreateSpan({ entryPoint, segment, transaction })) {
      return null
    }

    const spanContext = segment.getSpanContext()

    // Since segments already hold span agent attributes and we want to leverage
    // filtering, we add to the segment attributes prior to processing.
    if (spanContext.hasError && !transaction.hasIgnoredErrorStatusCode()) {
      const details = spanContext.errorDetails
      segment.addSpanAttribute('error.message', details.message)
      segment.addSpanAttribute('error.class', details.type)
      if (details.expected) {
        segment.addSpanAttribute('error.expected', details.expected)
      }
    }

    const attributes = segment.attributes.get(DESTINATIONS.SPAN_EVENT)

    const customAttributes = spanContext.customAttributes.get(DESTINATIONS.SPAN_EVENT)

    let span = null
    if (HttpSpanEvent.testSegment(segment)) {
      span = new HttpSpanEvent(attributes, customAttributes)
    } else if (DatastoreSpanEvent.testSegment(segment)) {
      span = new DatastoreSpanEvent(attributes, customAttributes)
    } else {
      span = new SpanEvent(attributes, customAttributes)
    }

    for (const [key, value] of Object.entries(spanContext.intrinsicAttributes)) {
      span.intrinsics[key] = value
    }

    span.intrinsics.traceId = transaction.traceId
    span.intrinsics.guid = segment.id
    span.intrinsics.parentId = reparentSpan({ inProcessSpans, isRoot, segment, transaction, parentId })
    span.intrinsics.transactionId = transaction.id
    span.intrinsics.sampled = transaction.sampled
    span.intrinsics.priority = transaction.priority
    span.intrinsics.name = segment.name

    if (isRoot) {
      span.intrinsics.trustedParentId = transaction.traceContext.trustedParentId
      if (transaction.traceContext.tracingVendors) {
        span.intrinsics.tracingVendors = transaction.traceContext.tracingVendors
      }
    }

    // Only set this if it will be `true`. Must be `null` otherwise.
    if (entryPoint) {
      span.intrinsics['nr.entryPoint'] = true
    }

    // Timestamp in milliseconds, duration in seconds. Yay consistency!
    span.intrinsics.timestamp = segment.timer.start
    span.intrinsics.duration = segment.timer.getDurationInMillis() / 1000

    addSpanKind({ segment, span })
    return span
  }

  toJSON() {
    return [
      _filterNulls(this.intrinsics),
      this.customAttributes ? _filterNulls(this.customAttributes) : EMPTY_USER_ATTRS,
      _filterNulls(this.attributes)
    ]
  }

  addCustomAttribute(key, value, truncateExempt = false) {
    const { attributeFilter } = Config.getInstance()
    const dest = attributeFilter.filterSegment(DESTINATIONS.SPAN_EVENT, key)
    if (dest & DESTINATIONS.SPAN_EVENT) {
      this.customAttributes[key] = truncateExempt ? value : _truncate(value)
    }
  }

  addAttribute(key, value, truncateExempt = false) {
    const { attributeFilter } = Config.getInstance()
    const dest = attributeFilter.filterSegment(DESTINATIONS.SPAN_EVENT, key)
    if (dest & DESTINATIONS.SPAN_EVENT) {
      this.attributes[key] = truncateExempt ? value : _truncate(value)
    }
  }
}

/**
 * Span event class for external requests.
 *
 * @private
 * @class
 */
class HttpSpanEvent extends SpanEvent {
  constructor(attributes, customAttributes) {
    super(attributes, customAttributes)

    this.intrinsics.category = CATEGORIES.HTTP
    this.intrinsics.component = attributes.library || HTTP_LIBRARY
    this.intrinsics['span.kind'] = SPAN_KIND.CLIENT

    if (attributes.library) {
      attributes.library = null
    }

    if (attributes.url) {
      this.addAttribute('http.url', attributes.url)
      attributes.url = null
    }

    if (attributes.hostname) {
      this.addAttribute(SERVER_ADDRESS, attributes.hostname)
      attributes.hostname = null
    }

    if (attributes.procedure) {
      this.addAttribute('http.method', attributes.procedure)
      this.addAttribute('http.request.method', attributes.procedure)
      attributes.procedure = null
    }
  }

  static testSegment(segment) {
    return REGEXS.CLIENT.EXTERNAL.test(segment.name)
  }
}

/**
 * Span event class for datastore operations and queries.
 *
 * @private
 * @class
 */
class DatastoreSpanEvent extends SpanEvent {
  constructor(attributes, customAttributes) {
    super(attributes, customAttributes)

    this.intrinsics.category = CATEGORIES.DATASTORE
    this.intrinsics['span.kind'] = SPAN_KIND.CLIENT

    if (attributes.product) {
      this.intrinsics.component = attributes.product
      this.addAttribute('db.system', attributes.product)
      attributes.product = null
    }

    if (attributes.collection) {
      this.addAttribute('db.collection', attributes.collection)
      attributes.collection = null
    }

    if (attributes.sql || attributes.sql_obfuscated) {
      let sql = null
      if (attributes.sql_obfuscated) {
        sql = _truncate(attributes.sql_obfuscated)
        attributes.sql_obfuscated = null
      } else if (attributes.sql) {
        sql = _truncate(attributes.sql)
        attributes.sql = null
      }

      // Flag as exempt from normal attribute truncation
      this.addAttribute('db.statement', sql, true)
    }

    if (attributes.database_name) {
      this.addAttribute('db.instance', attributes.database_name)
      attributes.database_name = null
    }

    const serverAddress = attributes[SERVER_ADDRESS]

    if (serverAddress) {
      this.addAttribute('peer.hostname', serverAddress)

      if (attributes.port_path_or_id) {
        const address = `${serverAddress}:${attributes.port_path_or_id}`
        this.addAttribute('peer.address', address)
        this.addAttribute('server.port', attributes.port_path_or_id, true)
        attributes.port_path_or_id = null
      }
    }
  }

  static testSegment(segment) {
    return REGEXS.CLIENT.DATASTORE.test(segment.name)
  }
}

function _truncate(val) {
  let truncated = truncate(val, 1997)
  if (truncated !== val) {
    truncated += '...'
  }
  return truncated
}

function _filterNulls(obj) {
  const out = Object.create(null)
  for (const key in obj) {
    if (obj[key] != null) {
      out[key] = obj[key]
    }
  }
  return out
}

module.exports = SpanEvent
