/*
 * Copyright 2024 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const instrument = require('../../../lib/instrumentation/@azure/functions')
const shims = require('../../../lib/shim')
const helper = require('../../lib/agent_helper')

test.beforeEach((ctx) => {
    ctx.nr = {}
    ctx.nr.agent = helper.instrumentMockedAgent()

    // ctx.nr.server = utils.getServer()
})

test.afterEach((ctx) => {
    helper.unloadAgent(ctx.nr.agent)
    // ctx.nr.server.stop()
})

test('preserves server creation return', (t) => {
    const { agent } = t.nr

    const azureFns = require('@azure/functions')
    const returned = utils.getServer({ azureFns })

    assert.ok(returned != null, 'Azure functions returns from server creation')

    const shim = new shims.WebFrameworkShim(agent, 'azureFns')
    instrument(agent, azureFns, 'azureFns', shim)

    const returned2 = utils.getServer({ azureFns })

    assert.ok(returned2 != null, 'Server creation returns when instrumented')
})
