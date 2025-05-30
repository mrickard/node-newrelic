/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const shared = require('./shared')

const s = shared.makeSuite('Shim segments')
const suite = s.suite
const shim = s.shim

suite.add({
  name: 'shim.wrap',
  fn: function () {
    const test = shared.getTest()
    shim.wrap(test, 'func', function (shim, fn) {
      return function () {
        return fn.apply(this, arguments)
      }
    })
    return test
  }
})

suite.add({
  name: 'shim.wrapReturn',
  fn: function () {
    const test = shared.getTest()
    shim.wrapReturn(test, 'func', function (shim, fn, fnName, ret) {
      return { ret }
    })
    return test
  }
})

suite.add({
  name: 'shim.wrapClass',
  fn: function () {
    const test = shared.getTest()
    shim.wrapClass(test, 'func', function (shim, fn, fnName, args) {
      return { args }
    })
    return test
  }
})

suite.add({
  name: 'shim.wrapExport',
  fn: function () {
    const test = shared.getTest()
    shim.wrapExport(test, function (shim, nodule) {
      return { nodule }
    })
    return test
  }
})

suite.add({
  name: 'shim.unwrap',
  fn: function () {
    const test = shared.getTest()
    shim.unwrap(test, 'func')
    return test
  }
})

suite.run()
