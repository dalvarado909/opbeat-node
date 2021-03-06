'use strict'

var debug = require('debug')('opbeat')
var protocol = require('./protocol')

var MAX_FLUSH_DELAY_ON_BOOT = 5000
var boot = true

module.exports = Queue

function Queue (opts, onFlush) {
  if (typeof opts === 'function') return new Queue(null, opts)
  if (!opts) opts = {}
  this._onFlush = onFlush
  this._samples = []
  this._sampled = {}
  this._durations = {}
  this._timeout = null
  this._flushInterval = (opts.flushInterval || 60) * 1000

  // The purpose of the boot flush time is to be lower than the normal flush
  // time in order to get a result quickly when the app first boots. But if a
  // custom flush interval is provided and it's lower than the boot flush time,
  // it doesn't make much sense anymore. In that case, just pretend we have
  // already used the boot flush time.
  if (this._flushInterval < MAX_FLUSH_DELAY_ON_BOOT) boot = false
}

Queue.prototype.add = function (transaction) {
  var k1 = protocol.transactionGroupingKey(transaction)
  var k2 = sampleKey(transaction)

  if (k1 in this._durations) {
    this._durations[k1].push(transaction.duration())
  } else {
    this._durations[k1] = [transaction.duration()]
  }

  if (!(k2 in this._sampled)) {
    this._sampled[k2] = true
    this._samples.push(transaction)
  }

  if (!this._timeout) this._queueFlush()
}

Queue.prototype._queueFlush = function () {
  var self = this
  var ms = boot ? MAX_FLUSH_DELAY_ON_BOOT : this._flushInterval

  // Randomize flush time to avoid servers started at the same time to
  // all connect to the APM server simultaneously
  ms = fuzzy(ms, 0.05) // +/- 5%

  debug('setting timer to flush queue: %dms', ms)
  this._timeout = setTimeout(function () {
    self._flush()
  }, ms)
  this._timeout.unref()
  boot = false
}

Queue.prototype._flush = function () {
  debug('flushing transaction queue')
  protocol.encode(this._samples, this._durations, this._onFlush)
  this._clear()
}

Queue.prototype._clear = function () {
  clearTimeout(this._timeout)
  this._samples = []
  this._sampled = {}
  this._durations = {}
  this._timeout = null
}

function sampleKey (trans) {
  var durationBucket = Math.floor(trans.duration() / 15)
  return durationBucket + '|' + trans.type + '|' + trans.name
}

// TODO: Check if there's an existing algorithm for this we can use instead
function fuzzy (n, pct) {
  var variance = n * pct * 2
  return Math.floor(n + (Math.random() * variance - variance / 2))
}
