/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const urltils = require('../util/urltils')

module.exports = {
  isExpected: function isExpected(type, message, transaction, config) {
    let isExpectedTransactionCode = false
    if (transaction && urltils.isExpectedError(config, transaction.statusCode)) {
      isExpectedTransactionCode = true
    }
    return (
      this.isExpectedErrorMessage(config, type, message) ||
      this.isExpectedErrorClass(config, type) ||
      isExpectedTransactionCode
    )
  },
  isTransactionError: function isTransactionError(transaction, config) {
    return transaction && urltils.isError(config, transaction?.statusCode)
  },
  isExpectedErrorMessage: function isExpectedErrorMessage(config, type, message) {
    if (!config.error_collector.expected_messages[type]) {
      return false
    }

    return (
      config.error_collector.expected_messages[type].length > 0 &&
      config.error_collector.expected_messages[type].indexOf(message) !== -1
    )
  },
  isExpectedErrorClass: function isExpectedErrorClass(config, className) {
    return (
      config.error_collector.expected_classes.length > 0 &&
      config.error_collector.expected_classes.indexOf(className) !== -1
    )
  },
  isExpectedException: function isExpectedException(transaction, exception, config) {
    // this is getting JUST the exception.error
    const { type, message } = this.extractErrorInformation(transaction, exception.error, config)

    return (
      exception._expected ||
      this.isExpectedErrorClass(config, type) ||
      this.isExpectedErrorMessage(config, type, message)
    )
  },
  extractErrorName: function extractErrorName(transaction, omitNaming) {
    let name = 'Unknown'
    if (!omitNaming && transaction) {
      const txName = transaction.getFullName()

      if (txName) {
        name = txName
      }
    }
    return name
  },
  extractErrorMessage: function extractErrorMessage(transaction, error, config) {
    let message = ''
    if (typeof error === 'string') {
      message = error
    } else if (
      error !== null &&
      error?.message &&
      !config.high_security &&
      !config.strip_exception_messages.enabled
    ) {
      message = error.message
    } else if (this.isTransactionError(transaction, config)) {
      message = 'HttpError ' + transaction.statusCode
    }

    return message
  },
  extractErrorType: function extractErrorType(transaction, error, config) {
    let type = 'Error'
    if (this.isTransactionError(transaction, config)) {
      type = `${transaction.statusCode}`
    } else if (error !== null && typeof error === 'object' && error.message) {
      type = error?.name || error?.constructor?.name
    }

    return type
  },

  extractErrorInformation: function extractErrorInformation(
    transaction,
    error,
    config,
    omitNaming
  ) {
    const name = this.extractErrorName(transaction, omitNaming)
    const message = this.extractErrorMessage(transaction, error, config)
    const type = this.extractErrorType(transaction, error, config)

    return {
      name,
      message,
      type
    }
  },

  shouldIgnoreError: function shouldIgnoreError(transaction, error, config) {
    // extract _just_ the error information, not transaction stuff
    const errorInfo = this.extractErrorInformation(null, error, config, null)

    return (
      this.shouldIgnoreErrorClass(errorInfo, config) ||
      this.shouldIgnoreErrorMessage(errorInfo, config) ||
      this.shouldIgnoreStatusCode(transaction, config)
    )
  },

  shouldIgnoreStatusCode: function shouldIgnoreStatusCode(transaction, config) {
    if (!transaction) {
      return false
    }
    return config.error_collector.ignore_status_codes.indexOf(transaction.statusCode) !== -1
  },

  shouldIgnoreErrorClass: function shouldIgnoreErrorClass(errorInfo, config) {
    if (config.error_collector.ignore_classes.length < 1) {
      return false
    }

    return -1 !== config.error_collector.ignore_classes.indexOf(errorInfo.type)
  },

  shouldIgnoreErrorMessage: function shouldIgnoreErrorMessage(errorInfo, config) {
    const configIgnoreMessages = config.error_collector.ignore_messages[errorInfo.type]
    if (!configIgnoreMessages) {
      return false
    }

    return configIgnoreMessages.length > 0 && configIgnoreMessages.indexOf(errorInfo.message) !== -1
  }
}
