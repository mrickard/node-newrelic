/*
 * Copyright 2023 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const tap = require('tap')
tap.Test.prototype.addAssert('clmAttrs', 1, assertCLMAttrs)
tap.Test.prototype.addAssert('isNonWritable', 1, isNonWritable)
tap.Test.prototype.addAssert('compareSegments', 2, compareSegments)
tap.Test.prototype.addAssert('exactClmAttrs', 2, assertExactClmAttrs)
tap.Test.prototype.addAssert('assertErrorTrace', 1, assertErrorTrace)

function assertExactClmAttrs(segmentStub, expectedAttrs) {
  const attrs = segmentStub.addAttribute.args
  const attrsObj = attrs.reduce((obj, [key, value]) => {
    obj[key] = value
    return obj
  }, {})
  this.same(attrsObj, expectedAttrs, 'CLM attrs should match')
}

/**
 * Asserts the appropriate Code Level Metrics attributes on a segment
 *
 * @param {object} params
 * @param {object} params.segments list of segments to assert { segment, filepath, name }
 * @param {boolean} params.enabled if CLM is enabled or not
 */
function assertCLMAttrs({ segments, enabled: clmEnabled }) {
  segments.forEach((segment) => {
    const attrs = segment.segment.getAttributes()
    if (clmEnabled) {
      this.equal(attrs['code.function'], segment.name, 'should have appropriate code.function')
      this.ok(
        attrs['code.filepath'].endsWith(segment.filepath),
        'should have appropriate code.filepath'
      )
      this.match(attrs['code.lineno'], /[\d]+/, 'lineno should be a number')
      this.match(attrs['code.column'], /[\d]+/, 'column should be a number')
    } else {
      this.notOk(attrs['code.function'], 'function should not exist')
      this.notOk(attrs['code.filepath'], 'filepath should not exist')
      this.notOk(attrs['code.lineno'], 'lineno should not exist')
      this.notOk(attrs['code.column'], 'column should not exist')
    }
  })
}

/**
 * assertion to test if a property is non-writable
 *
 * @param {Object} params
 * @param {Object} params.obj obj to assign value
 * @param {string} params.key key to assign value
 * @param {string} params.value expected value of obj[key]
 */
function isNonWritable({ obj, key, value }) {
  this.throws(function () {
    obj[key] = 'testNonWritable test value'
  }, new RegExp("(read only property '" + key + "'|Cannot set property " + key + ')'))

  if (value) {
    this.equal(obj[key], value)
  } else {
    this.not(obj[key], 'testNonWritable test value', 'should not set value when non-writable')
  }
}

/**
 *  Verifies the expected length of children segments and that every
 *  id matches between a segment array and the children
 *
 *  @param {Object} parent trace
 *  @param {Array} segments list of expected segments
 */
function compareSegments(parent, segments) {
  this.ok(parent.children.length, segments.length, 'should be the same amount of children')
  segments.forEach((segment, index) => {
    this.equal(parent.children[index].id, segment.id, 'should have same ids')
  })
}

/**
 * Asserts portions of traced error
 * [timestamp, transactionName, message, type, errorTraceAttributes, transactionId]
 *
 * @param {Object} params params to fn
 * @param {Object} params.error error trace to check
 * @param {string} params.type expected class of error
 * @param {string} params.msg expected err message
 * @param {Object} params.tx active transaction
 * @param {Object} params.attrs error trace attributes to compare in error trace
 */
function assertErrorTrace({ error, type, msg, tx, attrs }) {
  const [, txName, errMessage, errType, errAttrs, txId] = error
  this.equal(error.length, 6, 'should have 6 args in error trace')

  this.equal(errType, type, 'should match the type, status code if http call')
  this.equal(errMessage, msg, 'should match err message')

  if (tx) {
    this.equal(txName, tx.name, 'should match transaction name')
    this.equal(tx.id, txId, 'should match transaction id')
  }

  if (attrs) {
    this.match(attrs, errAttrs, 'should match error trace attrs')
  }
}
