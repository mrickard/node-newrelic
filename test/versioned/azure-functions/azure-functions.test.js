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

