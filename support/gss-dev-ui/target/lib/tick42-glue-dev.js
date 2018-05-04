(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function() {
	//Do not do anything if there is no support of ECMAScript 5
	if (typeof [].forEach !== 'function') {
		require("es5-shim");
		require("es5-shim/es5-sham");
	}

	var metrics = require("tick42-metrics");
	var agm = require("tick42-agm");
	var gatewayConnection = require("tick42-gateway-connection");
	var logger = require("tick42-logger");
	var appconfig = require("tick42-appconfig/src/js/appconfig");
	var windows = require("tick42-windows");
	var appManager = require("tick42-app-manager");
	var activity = require("tick42-activity");
	var pjson = require("../package.json");
	var cuid = require('cuid');

	//Do not do anything if the user turned off the auto initialization
	//
	if (typeof window !== 'undefined' && window.glue_auto_initialize === false) {
		return;
	}

	//Init the GLUE namespace
	var glue = {};
	glue.version = pjson.version;
	//Base configurations. Later they are updated depending on the runtime.
	var loggerConfiguration = {identity: {system: "Tick42"}};
	var metricsConfiguration = {identity: {system: "Tick42"}};
	var agmConfiguration = {instance: {}, server: {presence_interval: 3000}};

	//Here we will store a reference to the connection with the Service Provider
	glue.connection = undefined;
	var app_name;

	//If we are running in an HTML Container, use the HTML Container environment variables
	if (typeof window !== 'undefined' && window.htmlContainer !== undefined) {
		//Generate AGM app name
		app_name = window.agm_application || window.htmlContainer.containerName + "." + window.htmlContainer.browserWindowName;

		//Fill logger configurations with custom properties
		agmConfiguration.instance.application = app_name;
		loggerConfiguration.identity.system = "HtmlContainer." + window.htmlContainer.containerName;
		loggerConfiguration.identity.service = "JS." + window.htmlContainer.browserWindowName;
		loggerConfiguration.identity.instance = "~" + window.htmlContainer.machineName;

		if (window.htmlContainer.appConfigFacade !== undefined && window.htmlContainer.appConfigFacade.config !== undefined) {
			// Initialize AppConfig
			glue.appconfig = appconfig();
			glue.appconfig.init(function () {
				function supplant(template) {
					return template.replace(/\{([^{}]*)\}/g, function (match, key) {
						var value = this;
						key.split('.').forEach(function (part) {
							if (value) {
								value = value[part];
							}
						});
						return typeof value === 'string' || typeof value === 'number' ? value : match;
					});
				}

				var settings = window.htmlContainer.appConfigFacade.config;
				var identity = {};
				Object.keys(settings.identity).forEach(function (key) {
					var value = supplant(settings.identity[key]);
					identity[key] = value;
				});
				settings.identity = identity;
				return settings;
			}());
		}

		//Init the Connection
		glue.connection = gatewayConnection();

		//If we are running in normal browser, connect via Websocket
	} else {
		var connection_config = {};
		var uid_prefix;
		if (require("detect-node") || ('WebSocket' in window && window.WebSocket.CLOSING === 2)) {
			uid_prefix = "WS";
			//Websocket URL (this is the default that is used in the demo WS server) Defaults to insecure.
			var default_ws_url = 'ws://localhost:22037';
			if (window && window.location && window.location.protocol === 'https') {
				default_ws_url = 'wss://localhost:22037'
			}
			connection_config.websocket_url = window && window.glue_ws_url || default_ws_url;
		} else {
			// if no support for WebSocket use HTTP
			uid_prefix = "HTTP";
			// don't make insecure requests from secure env
			var default_http_url = window.location.protocol === 'http:' ? "http://localhost:22037" : "https://localhost:22037";
			connection_config.http_url = window.glue_http_url || default_http_url;
		}

		//Generate application UID to allow for the same application to be called multiple times.
		var uid = uid_prefix + cuid();

		//Generate AGM app name
		if (typeof document !== 'undefined' && document.title) {
			app_name =  document.title + uid
		} else if (window && window.agm_application) {
			app_name = window.agm_application;
		} else {
			app_name = uid;
		}

		//Fill configurations with custom properties
		agmConfiguration.instance.application = app_name;
		loggerConfiguration.identity.system = "Browser";
		loggerConfiguration.identity.service = typeof document !== 'undefined' ? document.title || 'unknown' : 'unknown';
		loggerConfiguration.identity.instance = "~" + uid;

		// Init the Connection and specify the URL of the Web Socket server that we are connecting to.
		glue.connection = gatewayConnection(connection_config);
	}

	//Place the Connection, as part of the components' configuration
	loggerConfiguration.connection = glue.connection;
	metricsConfiguration.connection = glue.connection;
	agmConfiguration.connection = glue.connection;

	//Override some props with environment variables, if provided
	loggerConfiguration.identity.system = window && window.glue_metric_system || loggerConfiguration.identity.system;
	loggerConfiguration.identity.service = window && window.glue_metric_service || loggerConfiguration.identity.service;
	loggerConfiguration.identity.instance = window && window.glue_metric_instance || loggerConfiguration.identity.instance;

	//Initialize Logger (uses the same configuration as Metrics)
	glue.logger = logger(loggerConfiguration);

	//Fill metrics configuration with the same properties as metrics configurations
	metricsConfiguration.identity = loggerConfiguration.identity;
	metricsConfiguration.logger = glue.logger.subLogger("metrics");

	//Initialize Metrics and save into the 'glue' global variable
	var rootMetrics = metrics(metricsConfiguration);
	glue.metrics = rootMetrics.subSystem("App");

	//Initialize the metrics system in the logger's "metrics_level" method
	glue.logger.metricsLevel("warn", glue.metrics.parent.subSystem("LogEvents"));

	agmConfiguration.instance.application = window && window.glue_agm_application || agmConfiguration.instance.application;

	//Include the metric repo in the AGM configuration (so that AGM can broadcast metrics)
	agmConfiguration.metrics = rootMetrics.subSystem("AGM");

	//Initialize AGM save into the 'glue' global variable
	glue.agm = agm(agmConfiguration);

	// Add activity in the container only
	var activitiesFacade = window && window.htmlContainer ? window.htmlContainer.activityFacade : undefined;
	if (typeof activitiesFacade !== "undefined") {
		var activityLogger = glue.logger.subLogger("activity");
		activityLogger.publishLevel("debug");
		activityLogger.consoleLevel("info");
		activityLogger.metricsLevel("off");
		glue.activities = activity({agm: glue.agm, logger: activityLogger});
	}

	glue.windows = windows(glue.agm);

	// camel case for App Manager
	glue.appManager = appManager(glue.agm, glue.windows);

	glue.info = {
		glueVersion: pjson.version,
		activities: glue.activities ? glue.activities.version : 'unknown',
		metrics: glue.metrics.repo.version,
		agm: glue.agm.version,
		windows: glue.windows.version,
		logger: glue.logger.version,
		appManager: glue.appManager.version,
		connection: glue.connection.version
	};

	// no conflict function
	var originalGlue = window && window.glue;
	glue.noConflict = function() {
		window.glue = originalGlue;
		return glue;
	};

	// feedback option
	glue.feedback = function() {
		if (!glue.agm){
			return;
		}

		glue.agm.invoke("T42.ACS.Feedback", {}, "best");
	};

	//Export GLUE
	if (window) {
		window.glue = glue;
	}
	module.exports = glue;
}());

},{"../package.json":80,"cuid":4,"detect-node":5,"es5-shim":7,"es5-shim/es5-sham":6,"tick42-activity":14,"tick42-agm":32,"tick42-app-manager":44,"tick42-appconfig/src/js/appconfig":49,"tick42-gateway-connection":55,"tick42-logger":60,"tick42-metrics":75,"tick42-windows":76}],2:[function(require,module,exports){
/**
 * (c) 2013 Beau Sorensen
 * MIT Licensed
 * For all details and documentation:
 * https://github.com/sorensen/ascii-table
 */

;(function() {
'use strict';

/*!
 * Module dependencies
 */

var slice = Array.prototype.slice
  , toString = Object.prototype.toString

/**
 * AsciiTable constructor
 *
 * @param {String|Object} title or JSON table
 * @param {Object} table options
 *  - `prefix` - string prefix added to each line on render
 * @constructor
 * @api public
 */

function AsciiTable(name, options) {
  this.options = options || {}
  this.reset(name)
}

/*!
 * Current library version, should match `package.json`
 */

AsciiTable.VERSION = '0.0.8'

/*!
 * Alignment constants
 */

AsciiTable.LEFT = 0
AsciiTable.CENTER = 1
AsciiTable.RIGHT = 2

/*!
 * Static methods
 */

/**
 * Create a new table instance
 *
 * @param {String|Object} title or JSON table
 * @param {Object} table options
 * @api public
 */

AsciiTable.factory = function(name, options) {
  return new AsciiTable(name, options)
}

/**
 * Align the a string at the given length
 *
 * @param {Number} direction
 * @param {String} string input
 * @param {Number} string length
 * @param {Number} padding character
 * @api public
 */

AsciiTable.align = function(dir, str, len, pad) {
  if (dir === AsciiTable.LEFT) return AsciiTable.alignLeft(str, len, pad)
  if (dir === AsciiTable.RIGHT) return AsciiTable.alignRight(str, len, pad)
  if (dir === AsciiTable.CENTER) return AsciiTable.alignCenter(str, len, pad)
  return AsciiTable.alignAuto(str, len, pad)
}

/**
 * Left align a string by padding it at a given length
 *
 * @param {String} str
 * @param {Number} string length
 * @param {String} padding character (optional, default '')
 * @api public
 */

AsciiTable.alignLeft = function(str, len, pad) {
  if (!len || len < 0) return ''
  if (str === undefined || str === null) str = ''
  if (typeof pad === 'undefined') pad = ' '
  if (typeof str !== 'string') str = str.toString()
  var alen = len + 1 - str.length
  if (alen <= 0) return str
  return str + Array(len + 1 - str.length).join(pad)
}

/**
 * Center align a string by padding it at a given length
 *
 * @param {String} str
 * @param {Number} string length
 * @param {String} padding character (optional, default '')
 * @api public
 */

AsciiTable.alignCenter = function(str, len, pad) {
  if (!len || len < 0) return ''
  if (str === undefined || str === null) str = ''
  if (typeof pad === 'undefined') pad = ' '
  if (typeof str !== 'string') str = str.toString()
  var nLen = str.length
    , half = Math.floor(len / 2 - nLen / 2)
    , odds = Math.abs((nLen % 2) - (len % 2))
    , len = str.length

  return AsciiTable.alignRight('', half, pad) 
    + str
    + AsciiTable.alignLeft('', half + odds, pad)
}

/**
 * Right align a string by padding it at a given length
 *
 * @param {String} str
 * @param {Number} string length
 * @param {String} padding character (optional, default '')
 * @api public
 */

AsciiTable.alignRight = function(str, len, pad) {
  if (!len || len < 0) return ''
  if (str === undefined || str === null) str = ''
  if (typeof pad === 'undefined') pad = ' '
  if (typeof str !== 'string') str = str.toString()
  var alen = len + 1 - str.length
  if (alen <= 0) return str
  return Array(len + 1 - str.length).join(pad) + str
}

/**
 * Auto align string value based on object type
 *
 * @param {Any} object to string
 * @param {Number} string length
 * @param {String} padding character (optional, default '')
 * @api public
 */

AsciiTable.alignAuto = function(str, len, pad) {
  if (str === undefined || str === null) str = ''
  var type = toString.call(str)
  pad || (pad = ' ')
  len = +len
  if (type !== '[object String]') {
    str = str.toString()
  }
  if (str.length < len) {
    switch(type) {
      case '[object Number]': return AsciiTable.alignRight(str, len, pad)
      default: return AsciiTable.alignLeft(str, len, pad)
    }
  }
  return str
}

/**
 * Fill an array at a given size with the given value
 *
 * @param {Number} array size
 * @param {Any} fill value
 * @return {Array} filled array
 * @api public
 */

AsciiTable.arrayFill = function(len, fill) {
  var arr = new Array(len)
  for (var i = 0; i !== len; i++) {
    arr[i] = fill;
  }
  return arr
}

/*!
 * Instance methods
 */

/**
 * Reset the table state back to defaults
 *
 * @param {String|Object} title or JSON table
 * @api public
 */

AsciiTable.prototype.reset = 
AsciiTable.prototype.clear = function(name) {
  this.__name = ''
  this.__nameAlign = AsciiTable.CENTER
  this.__rows = []
  this.__maxCells = 0
  this.__aligns = []
  this.__colMaxes = []
  this.__spacing = 1
  this.__heading = null
  this.__headingAlign = AsciiTable.CENTER
  this.setBorder()

  if (toString.call(name) === '[object String]') {
    this.__name = name
  } else if (toString.call(name) === '[object Object]') {
    this.fromJSON(name)
  }
  return this
}

/**
 * Set the table border
 *
 * @param {String} horizontal edges (optional, default `|`)
 * @param {String} vertical edges (optional, default `-`)
 * @param {String} top corners (optional, default `.`)
 * @param {String} bottom corners (optional, default `'`)
 * @api public
 */

AsciiTable.prototype.setBorder = function(edge, fill, top, bottom) {
  this.__border = true
  if (arguments.length === 1) {
    fill = top = bottom = edge
  }
  this.__edge = edge || '|'
  this.__fill = fill || '-'
  this.__top = top || '.'
  this.__bottom = bottom || "'"
  return this
}

/**
 * Remove all table borders
 *
 * @api public
 */

AsciiTable.prototype.removeBorder = function() {
  this.__border = false
  this.__edge = ' '
  this.__fill = ' '
  return this
}

/**
 * Set the column alignment at a given index
 *
 * @param {Number} column index
 * @param {Number} alignment direction
 * @api public
 */

AsciiTable.prototype.setAlign = function(idx, dir) {
  this.__aligns[idx] = dir
  return this
}

/**
 * Set the title of the table
 *
 * @param {String} title
 * @api public
 */

AsciiTable.prototype.setTitle = function(name) {
  this.__name = name
  return this
}

/**
 * Get the title of the table
 *
 * @return {String} title
 * @api public
 */

AsciiTable.prototype.getTitle = function() {
  return this.__name
}

/**
 * Set table title alignment
 *
 * @param {Number} direction
 * @api public
 */

AsciiTable.prototype.setTitleAlign = function(dir) {
  this.__nameAlign = dir
  return this
}

/**
 * AsciiTable sorting shortcut to sort rows
 *
 * @param {Function} sorting method
 * @api public
 */

AsciiTable.prototype.sort = function(method) {
  this.__rows.sort(method)
  return this
}

/**
 * Sort rows based on sort method for given column
 *
 * @param {Number} column index
 * @param {Function} sorting method
 * @api public
 */

AsciiTable.prototype.sortColumn = function(idx, method) {
  this.__rows.sort(function(a, b) {
    return method(a[idx], b[idx])
  })
  return this
}

/**
 * Set table heading for columns
 *
 * @api public
 */

AsciiTable.prototype.setHeading = function(row) {
  if (arguments.length > 1 || toString.call(row) !== '[object Array]') {
    row = slice.call(arguments)
  }
  this.__heading = row
  return this
}

/**
 * Get table heading for columns
 *
 * @return {Array} copy of headings
 * @api public
 */

AsciiTable.prototype.getHeading = function() {
  return this.__heading.slice()
}

/**
 * Set heading alignment
 *
 * @param {Number} direction
 * @api public
 */

AsciiTable.prototype.setHeadingAlign = function(dir) {
  this.__headingAlign = dir
  return this
}

/**
 * Add a row of information to the table
 * 
 * @param {...|Array} argument values in order of columns
 * @api public
 */

AsciiTable.prototype.addRow = function(row) {
  if (arguments.length > 1 || toString.call(row) !== '[object Array]') {
    row = slice.call(arguments)
  }
  this.__maxCells = Math.max(this.__maxCells, row.length)
  this.__rows.push(row)
  return this
}

/**
 * Get a copy of all rows of the table
 *
 * @return {Array} copy of rows
 * @api public
 */

AsciiTable.prototype.getRows = function() {
  return this.__rows.slice().map(function(row) {
    return row.slice()
  })
}

/**
 * Add rows in the format of a row matrix
 *
 * @param {Array} row matrix
 * @api public
 */

AsciiTable.prototype.addRowMatrix = function(rows) {
  for (var i = 0; i < rows.length; i++) {
    this.addRow(rows[i])
  }
  return this
}

/**
 * Add rows from the given data array, processed by the callback function rowCallback.
 *
 * @param {Array} data
 * @param (Function) rowCallback
 * @param (Boolean) asMatrix - controls if the row created by rowCallback should be assigned as row matrix
 * @api public
 */

AsciiTable.prototype.addData = function(data, rowCallback, asMatrix) {
  if (toString.call(data) !== '[object Array]') {
    return this;
  }
  for (var index = 0, limit = data.length; index < limit; index++) {
    var row = rowCallback(data[index]);
    if(asMatrix) {
      this.addRowMatrix(row);
    } else {
      this.addRow(row);
    }
  }
  return this
}

  /**
 * Reset the current row state
 *
 * @api public
 */

AsciiTable.prototype.clearRows = function() {
  this.__rows = []
  this.__maxCells = 0
  this.__colMaxes = []
  return this
}

/**
 * Apply an even spaced column justification
 *
 * @param {Boolean} on / off
 * @api public
 */

AsciiTable.prototype.setJustify = function(val) {
  arguments.length === 0 && (val = true)
  this.__justify = !!val
  return this
}

/**
 * Convert the current instance to a JSON structure
 *
 * @return {Object} json representation
 * @api public
 */

AsciiTable.prototype.toJSON = function() {
  return {
    title: this.getTitle()
  , heading: this.getHeading()
  , rows: this.getRows()
  }
}

/**
 * Populate the table from a JSON object
 *
 * @param {Object} json representation
 * @api public
 */

AsciiTable.prototype.parse = 
AsciiTable.prototype.fromJSON = function(obj) {
  return this
    .clear()
    .setTitle(obj.title)
    .setHeading(obj.heading)
    .addRowMatrix(obj.rows)
}

/**
 * Render the table with the current information
 *
 * @return {String} formatted table
 * @api public
 */

AsciiTable.prototype.render =
AsciiTable.prototype.valueOf =
AsciiTable.prototype.toString = function() {
  var self = this
    , body = []
    , mLen = this.__maxCells
    , max = AsciiTable.arrayFill(mLen, 0)
    , total = mLen * 3
    , rows = this.__rows
    , justify
    , border = this.__border
    , all = this.__heading 
        ? [this.__heading].concat(rows)
        : rows

  // Calculate max table cell lengths across all rows
  for (var i = 0; i < all.length; i++) {
    var row = all[i]
    for (var k = 0; k < mLen; k++) {
      var cell = row[k]
      max[k] = Math.max(max[k], cell ? cell.toString().length : 0)
    }
  }
  this.__colMaxes = max
  justify = this.__justify ? Math.max.apply(null, max) : 0

  // Get 
  max.forEach(function(x) {
    total += justify ? justify : x + self.__spacing
  })
  justify && (total += max.length)
  total -= this.__spacing

  // Heading
  border && body.push(this._seperator(total - mLen + 1, this.__top))
  if (this.__name) {
    body.push(this._renderTitle(total - mLen + 1))
    border && body.push(this._seperator(total - mLen + 1))
  }
  if (this.__heading) {
    body.push(this._renderRow(this.__heading, ' ', this.__headingAlign))
    body.push(this._rowSeperator(mLen, this.__fill))
  }
  for (var i = 0; i < this.__rows.length; i++) {
    body.push(this._renderRow(this.__rows[i], ' '))
  }
  border && body.push(this._seperator(total - mLen + 1, this.__bottom))

  var prefix = this.options.prefix || ''
  return prefix + body.join('\n' + prefix)
}

/**
 * Create a line seperator
 *
 * @param {Number} string size
 * @param {String} side values (default '|')
 * @api private
 */

AsciiTable.prototype._seperator = function(len, sep) {
  sep || (sep = this.__edge)
  return sep + AsciiTable.alignRight(sep, len, this.__fill)
}

/**
 * Create a row seperator
 *
 * @return {String} seperator
 * @api private
 */

AsciiTable.prototype._rowSeperator = function() {
  var blanks = AsciiTable.arrayFill(this.__maxCells, this.__fill)
  return this._renderRow(blanks, this.__fill)
}

/**
 * Render the table title in a centered box
 *
 * @param {Number} string size
 * @return {String} formatted title
 * @api private
 */

AsciiTable.prototype._renderTitle = function(len) {
  var name = ' ' + this.__name + ' '
    , str = AsciiTable.align(this.__nameAlign, name, len - 1, ' ')
  return this.__edge + str + this.__edge
}

/**
 * Render an invdividual row
 *
 * @param {Array} row
 * @param {String} column seperator
 * @param {Number} total row alignment (optional, default `auto`)
 * @return {String} formatted row
 * @api private
 */

AsciiTable.prototype._renderRow = function(row, str, align) {
  var tmp = ['']
    , max = this.__colMaxes

  for (var k = 0; k < this.__maxCells; k++) {
    var cell = row[k]
      , just = this.__justify ? Math.max.apply(null, max) : max[k]
      // , pad = k === this.__maxCells - 1 ? just : just + this.__spacing
      , pad = just
      , cAlign = this.__aligns[k]
      , use = align
      , method = 'alignAuto'
  
    if (typeof align === 'undefined') use = cAlign

    if (use === AsciiTable.LEFT) method = 'alignLeft'
    if (use === AsciiTable.CENTER) method = 'alignCenter'
    if (use === AsciiTable.RIGHT) method = 'alignRight'

    tmp.push(AsciiTable[method](cell, pad, str))
  }
  var front = tmp.join(str + this.__edge + str)
  front = front.substr(1, front.length)
  return front + str + this.__edge
}

/*!
 * Aliases
 */

// Create method shortcuts to all alignment methods for each direction
;['Left', 'Right', 'Center'].forEach(function(dir) {
  var constant = AsciiTable[dir.toUpperCase()]

  ;['setAlign', 'setTitleAlign', 'setHeadingAlign'].forEach(function(method) {
    // Call the base method with the direction constant as the last argument
    AsciiTable.prototype[method + dir] = function() {
      var args = slice.call(arguments).concat(constant)
      return this[method].apply(this, args)
    }
  })
})

/*!
 * Module exports.
 */

if (typeof exports !== 'undefined') {
  module.exports = AsciiTable
} else {
  this.AsciiTable = AsciiTable
}

}).call(this);

},{}],3:[function(require,module,exports){
module.exports = require('./ascii-table')
},{"./ascii-table":2}],4:[function(require,module,exports){
/**
 * cuid.js
 * Collision-resistant UID generator for browsers and node.
 * Sequential for fast db lookups and recency sorting.
 * Safe for element IDs and server-side lookups.
 *
 * Extracted from CLCTR
 *
 * Copyright (c) Eric Elliott 2012
 * MIT License
 */

/*global window, navigator, document, require, process, module */
(function (app) {
  'use strict';
  var namespace = 'cuid',
    c = 0,
    blockSize = 4,
    base = 36,
    discreteValues = Math.pow(base, blockSize),

    pad = function pad(num, size) {
      var s = "000000000" + num;
      return s.substr(s.length-size);
    },

    randomBlock = function randomBlock() {
      return pad((Math.random() *
            discreteValues << 0)
            .toString(base), blockSize);
    },

    safeCounter = function () {
      c = (c < discreteValues) ? c : 0;
      c++; // this is not subliminal
      return c - 1;
    },

    api = function cuid() {
      // Starting with a lowercase letter makes
      // it HTML element ID friendly.
      var letter = 'c', // hard-coded allows for sequential access

        // timestamp
        // warning: this exposes the exact date and time
        // that the uid was created.
        timestamp = (new Date().getTime()).toString(base),

        // Prevent same-machine collisions.
        counter,

        // A few chars to generate distinct ids for different
        // clients (so different computers are far less
        // likely to generate the same id)
        fingerprint = api.fingerprint(),

        // Grab some more chars from Math.random()
        random = randomBlock() + randomBlock();

        counter = pad(safeCounter().toString(base), blockSize);

      return  (letter + timestamp + counter + fingerprint + random);
    };

  api.slug = function slug() {
    var date = new Date().getTime().toString(36),
      counter,
      print = api.fingerprint().slice(0,1) +
        api.fingerprint().slice(-1),
      random = randomBlock().slice(-2);

      counter = safeCounter().toString(36).slice(-4);

    return date.slice(-2) +
      counter + print + random;
  };

  api.globalCount = function globalCount() {
    // We want to cache the results of this
    var cache = (function calc() {
        var i,
          count = 0;

        for (i in window) {
          count++;
        }

        return count;
      }());

    api.globalCount = function () { return cache; };
    return cache;
  };

  api.fingerprint = function browserPrint() {
    return pad((navigator.mimeTypes.length +
      navigator.userAgent.length).toString(36) +
      api.globalCount().toString(36), 4);
  };

  // don't change anything from here down.
  if (app.register) {
    app.register(namespace, api);
  } else if (typeof module !== 'undefined') {
    module.exports = api;
  } else {
    app[namespace] = api;
  }

}(this.applitude || this));

},{}],5:[function(require,module,exports){
(function (global){
module.exports = false;

// Only Node.JS has a process variable that is of [[Class]] process
try {
 module.exports = Object.prototype.toString.call(global.process) === '[object process]' 
} catch(e) {}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],6:[function(require,module,exports){
/*!
 * https://github.com/es-shims/es5-shim
 * @license es5-shim Copyright 2009-2015 by contributors, MIT License
 * see https://github.com/es-shims/es5-shim/blob/master/LICENSE
 */

// vim: ts=4 sts=4 sw=4 expandtab

// Add semicolon to prevent IIFE from being passed as argument to concatenated code.
;

// UMD (Universal Module Definition)
// see https://github.com/umdjs/umd/blob/master/templates/returnExports.js
(function (root, factory) {
    'use strict';

    /* global define, exports, module */
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(factory);
    } else if (typeof exports === 'object') {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like enviroments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {

    var call = Function.call;
    var prototypeOfObject = Object.prototype;
    var owns = call.bind(prototypeOfObject.hasOwnProperty);
    var isEnumerable = call.bind(prototypeOfObject.propertyIsEnumerable);
    var toStr = call.bind(prototypeOfObject.toString);

    // If JS engine supports accessors creating shortcuts.
    var defineGetter;
    var defineSetter;
    var lookupGetter;
    var lookupSetter;
    var supportsAccessors = owns(prototypeOfObject, '__defineGetter__');
    if (supportsAccessors) {
        /* eslint-disable no-underscore-dangle */
        defineGetter = call.bind(prototypeOfObject.__defineGetter__);
        defineSetter = call.bind(prototypeOfObject.__defineSetter__);
        lookupGetter = call.bind(prototypeOfObject.__lookupGetter__);
        lookupSetter = call.bind(prototypeOfObject.__lookupSetter__);
        /* eslint-enable no-underscore-dangle */
    }

    var isPrimitive = function isPrimitive(o) {
        return o == null || (typeof o !== 'object' && typeof o !== 'function');
    };

    // ES5 15.2.3.2
    // http://es5.github.com/#x15.2.3.2
    if (!Object.getPrototypeOf) {
        // https://github.com/es-shims/es5-shim/issues#issue/2
        // http://ejohn.org/blog/objectgetprototypeof/
        // recommended by fschaefer on github
        //
        // sure, and webreflection says ^_^
        // ... this will nerever possibly return null
        // ... Opera Mini breaks here with infinite loops
        Object.getPrototypeOf = function getPrototypeOf(object) {
            /* eslint-disable no-proto */
            var proto = object.__proto__;
            /* eslint-enable no-proto */
            if (proto || proto === null) {
                return proto;
            } else if (toStr(object.constructor) === '[object Function]') {
                return object.constructor.prototype;
            } else if (object instanceof Object) {
                return prototypeOfObject;
            } else {
                // Correctly return null for Objects created with `Object.create(null)`
                // (shammed or native) or `{ __proto__: null}`.  Also returns null for
                // cross-realm objects on browsers that lack `__proto__` support (like
                // IE <11), but that's the best we can do.
                return null;
            }
        };
    }

    // ES5 15.2.3.3
    // http://es5.github.com/#x15.2.3.3

    var doesGetOwnPropertyDescriptorWork = function doesGetOwnPropertyDescriptorWork(object) {
        try {
            object.sentinel = 0;
            return Object.getOwnPropertyDescriptor(object, 'sentinel').value === 0;
        } catch (exception) {
            return false;
        }
    };

    // check whether getOwnPropertyDescriptor works if it's given. Otherwise, shim partially.
    if (Object.defineProperty) {
        var getOwnPropertyDescriptorWorksOnObject = doesGetOwnPropertyDescriptorWork({});
        var getOwnPropertyDescriptorWorksOnDom = typeof document === 'undefined' ||
        doesGetOwnPropertyDescriptorWork(document.createElement('div'));
        if (!getOwnPropertyDescriptorWorksOnDom || !getOwnPropertyDescriptorWorksOnObject) {
            var getOwnPropertyDescriptorFallback = Object.getOwnPropertyDescriptor;
        }
    }

    if (!Object.getOwnPropertyDescriptor || getOwnPropertyDescriptorFallback) {
        var ERR_NON_OBJECT = 'Object.getOwnPropertyDescriptor called on a non-object: ';

        /* eslint-disable no-proto */
        Object.getOwnPropertyDescriptor = function getOwnPropertyDescriptor(object, property) {
            if (isPrimitive(object)) {
                throw new TypeError(ERR_NON_OBJECT + object);
            }

            // make a valiant attempt to use the real getOwnPropertyDescriptor
            // for I8's DOM elements.
            if (getOwnPropertyDescriptorFallback) {
                try {
                    return getOwnPropertyDescriptorFallback.call(Object, object, property);
                } catch (exception) {
                    // try the shim if the real one doesn't work
                }
            }

            var descriptor;

            // If object does not owns property return undefined immediately.
            if (!owns(object, property)) {
                return descriptor;
            }

            // If object has a property then it's for sure `configurable`, and
            // probably `enumerable`. Detect enumerability though.
            descriptor = {
                enumerable: isEnumerable(object, property),
                configurable: true
            };

            // If JS engine supports accessor properties then property may be a
            // getter or setter.
            if (supportsAccessors) {
                // Unfortunately `__lookupGetter__` will return a getter even
                // if object has own non getter property along with a same named
                // inherited getter. To avoid misbehavior we temporary remove
                // `__proto__` so that `__lookupGetter__` will return getter only
                // if it's owned by an object.
                var prototype = object.__proto__;
                var notPrototypeOfObject = object !== prototypeOfObject;
                // avoid recursion problem, breaking in Opera Mini when
                // Object.getOwnPropertyDescriptor(Object.prototype, 'toString')
                // or any other Object.prototype accessor
                if (notPrototypeOfObject) {
                    object.__proto__ = prototypeOfObject;
                }

                var getter = lookupGetter(object, property);
                var setter = lookupSetter(object, property);

                if (notPrototypeOfObject) {
                    // Once we have getter and setter we can put values back.
                    object.__proto__ = prototype;
                }

                if (getter || setter) {
                    if (getter) {
                        descriptor.get = getter;
                    }
                    if (setter) {
                        descriptor.set = setter;
                    }
                    // If it was accessor property we're done and return here
                    // in order to avoid adding `value` to the descriptor.
                    return descriptor;
                }
            }

            // If we got this far we know that object has an own property that is
            // not an accessor so we set it as a value and return descriptor.
            descriptor.value = object[property];
            descriptor.writable = true;
            return descriptor;
        };
        /* eslint-enable no-proto */
    }

    // ES5 15.2.3.4
    // http://es5.github.com/#x15.2.3.4
    if (!Object.getOwnPropertyNames) {
        Object.getOwnPropertyNames = function getOwnPropertyNames(object) {
            return Object.keys(object);
        };
    }

    // ES5 15.2.3.5
    // http://es5.github.com/#x15.2.3.5
    if (!Object.create) {

        // Contributed by Brandon Benvie, October, 2012
        var createEmpty;
        var supportsProto = !({ __proto__: null } instanceof Object);
                            // the following produces false positives
                            // in Opera Mini => not a reliable check
                            // Object.prototype.__proto__ === null

        // Check for document.domain and active x support
        // No need to use active x approach when document.domain is not set
        // see https://github.com/es-shims/es5-shim/issues/150
        // variation of https://github.com/kitcambridge/es5-shim/commit/4f738ac066346
        /* global ActiveXObject */
        var shouldUseActiveX = function shouldUseActiveX() {
            // return early if document.domain not set
            if (!document.domain) {
                return false;
            }

            try {
                return !!new ActiveXObject('htmlfile');
            } catch (exception) {
                return false;
            }
        };

        // This supports IE8 when document.domain is used
        // see https://github.com/es-shims/es5-shim/issues/150
        // variation of https://github.com/kitcambridge/es5-shim/commit/4f738ac066346
        var getEmptyViaActiveX = function getEmptyViaActiveX() {
            var empty;
            var xDoc;

            xDoc = new ActiveXObject('htmlfile');

            var script = 'script';
            xDoc.write('<' + script + '></' + script + '>');
            xDoc.close();

            empty = xDoc.parentWindow.Object.prototype;
            xDoc = null;

            return empty;
        };

        // The original implementation using an iframe
        // before the activex approach was added
        // see https://github.com/es-shims/es5-shim/issues/150
        var getEmptyViaIFrame = function getEmptyViaIFrame() {
            var iframe = document.createElement('iframe');
            var parent = document.body || document.documentElement;
            var empty;

            iframe.style.display = 'none';
            parent.appendChild(iframe);
            /* eslint-disable no-script-url */
            iframe.src = 'javascript:';
            /* eslint-enable no-script-url */

            empty = iframe.contentWindow.Object.prototype;
            parent.removeChild(iframe);
            iframe = null;

            return empty;
        };

        /* global document */
        if (supportsProto || typeof document === 'undefined') {
            createEmpty = function () {
                return { __proto__: null };
            };
        } else {
            // In old IE __proto__ can't be used to manually set `null`, nor does
            // any other method exist to make an object that inherits from nothing,
            // aside from Object.prototype itself. Instead, create a new global
            // object and *steal* its Object.prototype and strip it bare. This is
            // used as the prototype to create nullary objects.
            createEmpty = function () {
                // Determine which approach to use
                // see https://github.com/es-shims/es5-shim/issues/150
                var empty = shouldUseActiveX() ? getEmptyViaActiveX() : getEmptyViaIFrame();

                delete empty.constructor;
                delete empty.hasOwnProperty;
                delete empty.propertyIsEnumerable;
                delete empty.isPrototypeOf;
                delete empty.toLocaleString;
                delete empty.toString;
                delete empty.valueOf;

                var Empty = function Empty() {};
                Empty.prototype = empty;
                // short-circuit future calls
                createEmpty = function () {
                    return new Empty();
                };
                return new Empty();
            };
        }

        Object.create = function create(prototype, properties) {

            var object;
            var Type = function Type() {}; // An empty constructor.

            if (prototype === null) {
                object = createEmpty();
            } else {
                if (prototype !== null && isPrimitive(prototype)) {
                    // In the native implementation `parent` can be `null`
                    // OR *any* `instanceof Object`  (Object|Function|Array|RegExp|etc)
                    // Use `typeof` tho, b/c in old IE, DOM elements are not `instanceof Object`
                    // like they are in modern browsers. Using `Object.create` on DOM elements
                    // is...err...probably inappropriate, but the native version allows for it.
                    throw new TypeError('Object prototype may only be an Object or null'); // same msg as Chrome
                }
                Type.prototype = prototype;
                object = new Type();
                // IE has no built-in implementation of `Object.getPrototypeOf`
                // neither `__proto__`, but this manually setting `__proto__` will
                // guarantee that `Object.getPrototypeOf` will work as expected with
                // objects created using `Object.create`
                /* eslint-disable no-proto */
                object.__proto__ = prototype;
                /* eslint-enable no-proto */
            }

            if (properties !== void 0) {
                Object.defineProperties(object, properties);
            }

            return object;
        };
    }

    // ES5 15.2.3.6
    // http://es5.github.com/#x15.2.3.6

    // Patch for WebKit and IE8 standard mode
    // Designed by hax <hax.github.com>
    // related issue: https://github.com/es-shims/es5-shim/issues#issue/5
    // IE8 Reference:
    //     http://msdn.microsoft.com/en-us/library/dd282900.aspx
    //     http://msdn.microsoft.com/en-us/library/dd229916.aspx
    // WebKit Bugs:
    //     https://bugs.webkit.org/show_bug.cgi?id=36423

    var doesDefinePropertyWork = function doesDefinePropertyWork(object) {
        try {
            Object.defineProperty(object, 'sentinel', {});
            return 'sentinel' in object;
        } catch (exception) {
            return false;
        }
    };

    // check whether defineProperty works if it's given. Otherwise,
    // shim partially.
    if (Object.defineProperty) {
        var definePropertyWorksOnObject = doesDefinePropertyWork({});
        var definePropertyWorksOnDom = typeof document === 'undefined' ||
            doesDefinePropertyWork(document.createElement('div'));
        if (!definePropertyWorksOnObject || !definePropertyWorksOnDom) {
            var definePropertyFallback = Object.defineProperty,
                definePropertiesFallback = Object.defineProperties;
        }
    }

    if (!Object.defineProperty || definePropertyFallback) {
        var ERR_NON_OBJECT_DESCRIPTOR = 'Property description must be an object: ';
        var ERR_NON_OBJECT_TARGET = 'Object.defineProperty called on non-object: ';
        var ERR_ACCESSORS_NOT_SUPPORTED = 'getters & setters can not be defined on this javascript engine';

        Object.defineProperty = function defineProperty(object, property, descriptor) {
            if (isPrimitive(object)) {
                throw new TypeError(ERR_NON_OBJECT_TARGET + object);
            }
            if (isPrimitive(descriptor)) {
                throw new TypeError(ERR_NON_OBJECT_DESCRIPTOR + descriptor);
            }
            // make a valiant attempt to use the real defineProperty
            // for I8's DOM elements.
            if (definePropertyFallback) {
                try {
                    return definePropertyFallback.call(Object, object, property, descriptor);
                } catch (exception) {
                    // try the shim if the real one doesn't work
                }
            }

            // If it's a data property.
            if ('value' in descriptor) {
                // fail silently if 'writable', 'enumerable', or 'configurable'
                // are requested but not supported
                /*
                // alternate approach:
                if ( // can't implement these features; allow false but not true
                    ('writable' in descriptor && !descriptor.writable) ||
                    ('enumerable' in descriptor && !descriptor.enumerable) ||
                    ('configurable' in descriptor && !descriptor.configurable)
                ))
                    throw new RangeError(
                        'This implementation of Object.defineProperty does not support configurable, enumerable, or writable.'
                    );
                */

                if (supportsAccessors && (lookupGetter(object, property) || lookupSetter(object, property))) {
                    // As accessors are supported only on engines implementing
                    // `__proto__` we can safely override `__proto__` while defining
                    // a property to make sure that we don't hit an inherited
                    // accessor.
                    /* eslint-disable no-proto */
                    var prototype = object.__proto__;
                    object.__proto__ = prototypeOfObject;
                    // Deleting a property anyway since getter / setter may be
                    // defined on object itself.
                    delete object[property];
                    object[property] = descriptor.value;
                    // Setting original `__proto__` back now.
                    object.__proto__ = prototype;
                    /* eslint-enable no-proto */
                } else {
                    object[property] = descriptor.value;
                }
            } else {
                var hasGetter = 'get' in descriptor;
                var hasSetter = 'set' in descriptor;
                if (!supportsAccessors && (hasGetter || hasSetter)) {
                     return;
                }
                // If we got that far then getters and setters can be defined !!
                if (hasGetter) {
                    defineGetter(object, property, descriptor.get);
                }
                if (hasSetter) {
                    defineSetter(object, property, descriptor.set);
                }
            }
            return object;
        };
    }

    // ES5 15.2.3.7
    // http://es5.github.com/#x15.2.3.7
    if (!Object.defineProperties || definePropertiesFallback) {
        Object.defineProperties = function defineProperties(object, properties) {
            // make a valiant attempt to use the real defineProperties
            if (definePropertiesFallback) {
                try {
                    return definePropertiesFallback.call(Object, object, properties);
                } catch (exception) {
                    // try the shim if the real one doesn't work
                }
            }

            Object.keys(properties).forEach(function (property) {
                if (property !== '__proto__') {
                    Object.defineProperty(object, property, properties[property]);
                }
            });
            return object;
        };
    }

    // ES5 15.2.3.8
    // http://es5.github.com/#x15.2.3.8
    if (!Object.seal) {
        Object.seal = function seal(object) {
            if (Object(object) !== object) {
                throw new TypeError('Object.seal can only be called on Objects.');
            }
            // this is misleading and breaks feature-detection, but
            // allows "securable" code to "gracefully" degrade to working
            // but insecure code.
            return object;
        };
    }

    // ES5 15.2.3.9
    // http://es5.github.com/#x15.2.3.9
    if (!Object.freeze) {
        Object.freeze = function freeze(object) {
            if (Object(object) !== object) {
                throw new TypeError('Object.freeze can only be called on Objects.');
            }
            // this is misleading and breaks feature-detection, but
            // allows "securable" code to "gracefully" degrade to working
            // but insecure code.
            return object;
        };
    }

    // detect a Rhino bug and patch it
    try {
        Object.freeze(function () {});
    } catch (exception) {
        Object.freeze = (function (freezeObject) {
            return function freeze(object) {
                if (typeof object === 'function') {
                    return object;
                } else {
                    return freezeObject(object);
                }
            };
        }(Object.freeze));
    }

    // ES5 15.2.3.10
    // http://es5.github.com/#x15.2.3.10
    if (!Object.preventExtensions) {
        Object.preventExtensions = function preventExtensions(object) {
            if (Object(object) !== object) {
                throw new TypeError('Object.preventExtensions can only be called on Objects.');
            }
            // this is misleading and breaks feature-detection, but
            // allows "securable" code to "gracefully" degrade to working
            // but insecure code.
            return object;
        };
    }

    // ES5 15.2.3.11
    // http://es5.github.com/#x15.2.3.11
    if (!Object.isSealed) {
        Object.isSealed = function isSealed(object) {
            if (Object(object) !== object) {
                throw new TypeError('Object.isSealed can only be called on Objects.');
            }
            return false;
        };
    }

    // ES5 15.2.3.12
    // http://es5.github.com/#x15.2.3.12
    if (!Object.isFrozen) {
        Object.isFrozen = function isFrozen(object) {
            if (Object(object) !== object) {
                throw new TypeError('Object.isFrozen can only be called on Objects.');
            }
            return false;
        };
    }

    // ES5 15.2.3.13
    // http://es5.github.com/#x15.2.3.13
    if (!Object.isExtensible) {
        Object.isExtensible = function isExtensible(object) {
            // 1. If Type(O) is not Object throw a TypeError exception.
            if (Object(object) !== object) {
                throw new TypeError('Object.isExtensible can only be called on Objects.');
            }
            // 2. Return the Boolean value of the [[Extensible]] internal property of O.
            var name = '';
            while (owns(object, name)) {
                name += '?';
            }
            object[name] = true;
            var returnValue = owns(object, name);
            delete object[name];
            return returnValue;
        };
    }

}));

},{}],7:[function(require,module,exports){
/*!
 * https://github.com/es-shims/es5-shim
 * @license es5-shim Copyright 2009-2015 by contributors, MIT License
 * see https://github.com/es-shims/es5-shim/blob/master/LICENSE
 */

// vim: ts=4 sts=4 sw=4 expandtab

// Add semicolon to prevent IIFE from being passed as argument to concatenated code.
;

// UMD (Universal Module Definition)
// see https://github.com/umdjs/umd/blob/master/templates/returnExports.js
(function (root, factory) {
    'use strict';

    /* global define, exports, module */
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(factory);
    } else if (typeof exports === 'object') {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like enviroments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.returnExports = factory();
    }
}(this, function () {
    /**
     * Brings an environment as close to ECMAScript 5 compliance
     * as is possible with the facilities of erstwhile engines.
     *
     * Annotated ES5: http://es5.github.com/ (specific links below)
     * ES5 Spec: http://www.ecma-international.org/publications/files/ECMA-ST/Ecma-262.pdf
     * Required reading: http://javascriptweblog.wordpress.com/2011/12/05/extending-javascript-natives/
     */

    // Shortcut to an often accessed properties, in order to avoid multiple
    // dereference that costs universally. This also holds a reference to known-good
    // functions.
    var $Array = Array;
    var ArrayPrototype = $Array.prototype;
    var $Object = Object;
    var ObjectPrototype = $Object.prototype;
    var $Function = Function;
    var FunctionPrototype = $Function.prototype;
    var $String = String;
    var StringPrototype = $String.prototype;
    var $Number = Number;
    var NumberPrototype = $Number.prototype;
    var array_slice = ArrayPrototype.slice;
    var array_splice = ArrayPrototype.splice;
    var array_push = ArrayPrototype.push;
    var array_unshift = ArrayPrototype.unshift;
    var array_concat = ArrayPrototype.concat;
    var array_join = ArrayPrototype.join;
    var call = FunctionPrototype.call;
    var apply = FunctionPrototype.apply;
    var max = Math.max;
    var min = Math.min;

    // Having a toString local variable name breaks in Opera so use to_string.
    var to_string = ObjectPrototype.toString;

    /* global Symbol */
    /* eslint-disable one-var-declaration-per-line, no-redeclare, max-statements-per-line */
    var hasToStringTag = typeof Symbol === 'function' && typeof Symbol.toStringTag === 'symbol';
    var isCallable; /* inlined from https://npmjs.com/is-callable */ var fnToStr = Function.prototype.toString, constructorRegex = /^\s*class /, isES6ClassFn = function isES6ClassFn(value) { try { var fnStr = fnToStr.call(value); var singleStripped = fnStr.replace(/\/\/.*\n/g, ''); var multiStripped = singleStripped.replace(/\/\*[.\s\S]*\*\//g, ''); var spaceStripped = multiStripped.replace(/\n/mg, ' ').replace(/ {2}/g, ' '); return constructorRegex.test(spaceStripped); } catch (e) { return false; /* not a function */ } }, tryFunctionObject = function tryFunctionObject(value) { try { if (isES6ClassFn(value)) { return false; } fnToStr.call(value); return true; } catch (e) { return false; } }, fnClass = '[object Function]', genClass = '[object GeneratorFunction]', isCallable = function isCallable(value) { if (!value) { return false; } if (typeof value !== 'function' && typeof value !== 'object') { return false; } if (hasToStringTag) { return tryFunctionObject(value); } if (isES6ClassFn(value)) { return false; } var strClass = to_string.call(value); return strClass === fnClass || strClass === genClass; };

    var isRegex; /* inlined from https://npmjs.com/is-regex */ var regexExec = RegExp.prototype.exec, tryRegexExec = function tryRegexExec(value) { try { regexExec.call(value); return true; } catch (e) { return false; } }, regexClass = '[object RegExp]'; isRegex = function isRegex(value) { if (typeof value !== 'object') { return false; } return hasToStringTag ? tryRegexExec(value) : to_string.call(value) === regexClass; };
    var isString; /* inlined from https://npmjs.com/is-string */ var strValue = String.prototype.valueOf, tryStringObject = function tryStringObject(value) { try { strValue.call(value); return true; } catch (e) { return false; } }, stringClass = '[object String]'; isString = function isString(value) { if (typeof value === 'string') { return true; } if (typeof value !== 'object') { return false; } return hasToStringTag ? tryStringObject(value) : to_string.call(value) === stringClass; };
    /* eslint-enable one-var-declaration-per-line, no-redeclare, max-statements-per-line */

    /* inlined from http://npmjs.com/define-properties */
    var supportsDescriptors = $Object.defineProperty && (function () {
        try {
            var obj = {};
            $Object.defineProperty(obj, 'x', { enumerable: false, value: obj });
            for (var _ in obj) { // jscs:ignore disallowUnusedVariables
                return false;
            }
            return obj.x === obj;
        } catch (e) { /* this is ES3 */
            return false;
        }
    }());
    var defineProperties = (function (has) {
        // Define configurable, writable, and non-enumerable props
        // if they don't exist.
        var defineProperty;
        if (supportsDescriptors) {
            defineProperty = function (object, name, method, forceAssign) {
                if (!forceAssign && (name in object)) {
                    return;
                }
                $Object.defineProperty(object, name, {
                    configurable: true,
                    enumerable: false,
                    writable: true,
                    value: method
                });
            };
        } else {
            defineProperty = function (object, name, method, forceAssign) {
                if (!forceAssign && (name in object)) {
                    return;
                }
                object[name] = method;
            };
        }
        return function defineProperties(object, map, forceAssign) {
            for (var name in map) {
                if (has.call(map, name)) {
                    defineProperty(object, name, map[name], forceAssign);
                }
            }
        };
    }(ObjectPrototype.hasOwnProperty));

    //
    // Util
    // ======
    //

    /* replaceable with https://npmjs.com/package/es-abstract /helpers/isPrimitive */
    var isPrimitive = function isPrimitive(input) {
        var type = typeof input;
        return input === null || (type !== 'object' && type !== 'function');
    };

    var isActualNaN = $Number.isNaN || function isActualNaN(x) {
        return x !== x;
    };

    var ES = {
        // ES5 9.4
        // http://es5.github.com/#x9.4
        // http://jsperf.com/to-integer
        /* replaceable with https://npmjs.com/package/es-abstract ES5.ToInteger */
        ToInteger: function ToInteger(num) {
            var n = +num;
            if (isActualNaN(n)) {
                n = 0;
            } else if (n !== 0 && n !== (1 / 0) && n !== -(1 / 0)) {
                n = (n > 0 || -1) * Math.floor(Math.abs(n));
            }
            return n;
        },

        /* replaceable with https://npmjs.com/package/es-abstract ES5.ToPrimitive */
        ToPrimitive: function ToPrimitive(input) {
            var val, valueOf, toStr;
            if (isPrimitive(input)) {
                return input;
            }
            valueOf = input.valueOf;
            if (isCallable(valueOf)) {
                val = valueOf.call(input);
                if (isPrimitive(val)) {
                    return val;
                }
            }
            toStr = input.toString;
            if (isCallable(toStr)) {
                val = toStr.call(input);
                if (isPrimitive(val)) {
                    return val;
                }
            }
            throw new TypeError();
        },

        // ES5 9.9
        // http://es5.github.com/#x9.9
        /* replaceable with https://npmjs.com/package/es-abstract ES5.ToObject */
        ToObject: function (o) {
            if (o == null) { // this matches both null and undefined
                throw new TypeError("can't convert " + o + ' to object');
            }
            return $Object(o);
        },

        /* replaceable with https://npmjs.com/package/es-abstract ES5.ToUint32 */
        ToUint32: function ToUint32(x) {
            return x >>> 0;
        }
    };

    //
    // Function
    // ========
    //

    // ES-5 15.3.4.5
    // http://es5.github.com/#x15.3.4.5

    var Empty = function Empty() {};

    defineProperties(FunctionPrototype, {
        bind: function bind(that) { // .length is 1
            // 1. Let Target be the this value.
            var target = this;
            // 2. If IsCallable(Target) is false, throw a TypeError exception.
            if (!isCallable(target)) {
                throw new TypeError('Function.prototype.bind called on incompatible ' + target);
            }
            // 3. Let A be a new (possibly empty) internal list of all of the
            //   argument values provided after thisArg (arg1, arg2 etc), in order.
            // XXX slicedArgs will stand in for "A" if used
            var args = array_slice.call(arguments, 1); // for normal call
            // 4. Let F be a new native ECMAScript object.
            // 11. Set the [[Prototype]] internal property of F to the standard
            //   built-in Function prototype object as specified in 15.3.3.1.
            // 12. Set the [[Call]] internal property of F as described in
            //   15.3.4.5.1.
            // 13. Set the [[Construct]] internal property of F as described in
            //   15.3.4.5.2.
            // 14. Set the [[HasInstance]] internal property of F as described in
            //   15.3.4.5.3.
            var bound;
            var binder = function () {

                if (this instanceof bound) {
                    // 15.3.4.5.2 [[Construct]]
                    // When the [[Construct]] internal method of a function object,
                    // F that was created using the bind function is called with a
                    // list of arguments ExtraArgs, the following steps are taken:
                    // 1. Let target be the value of F's [[TargetFunction]]
                    //   internal property.
                    // 2. If target has no [[Construct]] internal method, a
                    //   TypeError exception is thrown.
                    // 3. Let boundArgs be the value of F's [[BoundArgs]] internal
                    //   property.
                    // 4. Let args be a new list containing the same values as the
                    //   list boundArgs in the same order followed by the same
                    //   values as the list ExtraArgs in the same order.
                    // 5. Return the result of calling the [[Construct]] internal
                    //   method of target providing args as the arguments.

                    var result = apply.call(
                        target,
                        this,
                        array_concat.call(args, array_slice.call(arguments))
                    );
                    if ($Object(result) === result) {
                        return result;
                    }
                    return this;

                } else {
                    // 15.3.4.5.1 [[Call]]
                    // When the [[Call]] internal method of a function object, F,
                    // which was created using the bind function is called with a
                    // this value and a list of arguments ExtraArgs, the following
                    // steps are taken:
                    // 1. Let boundArgs be the value of F's [[BoundArgs]] internal
                    //   property.
                    // 2. Let boundThis be the value of F's [[BoundThis]] internal
                    //   property.
                    // 3. Let target be the value of F's [[TargetFunction]] internal
                    //   property.
                    // 4. Let args be a new list containing the same values as the
                    //   list boundArgs in the same order followed by the same
                    //   values as the list ExtraArgs in the same order.
                    // 5. Return the result of calling the [[Call]] internal method
                    //   of target providing boundThis as the this value and
                    //   providing args as the arguments.

                    // equiv: target.call(this, ...boundArgs, ...args)
                    return apply.call(
                        target,
                        that,
                        array_concat.call(args, array_slice.call(arguments))
                    );

                }

            };

            // 15. If the [[Class]] internal property of Target is "Function", then
            //     a. Let L be the length property of Target minus the length of A.
            //     b. Set the length own property of F to either 0 or L, whichever is
            //       larger.
            // 16. Else set the length own property of F to 0.

            var boundLength = max(0, target.length - args.length);

            // 17. Set the attributes of the length own property of F to the values
            //   specified in 15.3.5.1.
            var boundArgs = [];
            for (var i = 0; i < boundLength; i++) {
                array_push.call(boundArgs, '$' + i);
            }

            // XXX Build a dynamic function with desired amount of arguments is the only
            // way to set the length property of a function.
            // In environments where Content Security Policies enabled (Chrome extensions,
            // for ex.) all use of eval or Function costructor throws an exception.
            // However in all of these environments Function.prototype.bind exists
            // and so this code will never be executed.
            bound = $Function('binder', 'return function (' + array_join.call(boundArgs, ',') + '){ return binder.apply(this, arguments); }')(binder);

            if (target.prototype) {
                Empty.prototype = target.prototype;
                bound.prototype = new Empty();
                // Clean up dangling references.
                Empty.prototype = null;
            }

            // TODO
            // 18. Set the [[Extensible]] internal property of F to true.

            // TODO
            // 19. Let thrower be the [[ThrowTypeError]] function Object (13.2.3).
            // 20. Call the [[DefineOwnProperty]] internal method of F with
            //   arguments "caller", PropertyDescriptor {[[Get]]: thrower, [[Set]]:
            //   thrower, [[Enumerable]]: false, [[Configurable]]: false}, and
            //   false.
            // 21. Call the [[DefineOwnProperty]] internal method of F with
            //   arguments "arguments", PropertyDescriptor {[[Get]]: thrower,
            //   [[Set]]: thrower, [[Enumerable]]: false, [[Configurable]]: false},
            //   and false.

            // TODO
            // NOTE Function objects created using Function.prototype.bind do not
            // have a prototype property or the [[Code]], [[FormalParameters]], and
            // [[Scope]] internal properties.
            // XXX can't delete prototype in pure-js.

            // 22. Return F.
            return bound;
        }
    });

    // _Please note: Shortcuts are defined after `Function.prototype.bind` as we
    // use it in defining shortcuts.
    var owns = call.bind(ObjectPrototype.hasOwnProperty);
    var toStr = call.bind(ObjectPrototype.toString);
    var arraySlice = call.bind(array_slice);
    var arraySliceApply = apply.bind(array_slice);
    var strSlice = call.bind(StringPrototype.slice);
    var strSplit = call.bind(StringPrototype.split);
    var strIndexOf = call.bind(StringPrototype.indexOf);
    var pushCall = call.bind(array_push);
    var isEnum = call.bind(ObjectPrototype.propertyIsEnumerable);
    var arraySort = call.bind(ArrayPrototype.sort);

    //
    // Array
    // =====
    //

    var isArray = $Array.isArray || function isArray(obj) {
        return toStr(obj) === '[object Array]';
    };

    // ES5 15.4.4.12
    // http://es5.github.com/#x15.4.4.13
    // Return len+argCount.
    // [bugfix, ielt8]
    // IE < 8 bug: [].unshift(0) === undefined but should be "1"
    var hasUnshiftReturnValueBug = [].unshift(0) !== 1;
    defineProperties(ArrayPrototype, {
        unshift: function () {
            array_unshift.apply(this, arguments);
            return this.length;
        }
    }, hasUnshiftReturnValueBug);

    // ES5 15.4.3.2
    // http://es5.github.com/#x15.4.3.2
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/isArray
    defineProperties($Array, { isArray: isArray });

    // The IsCallable() check in the Array functions
    // has been replaced with a strict check on the
    // internal class of the object to trap cases where
    // the provided function was actually a regular
    // expression literal, which in V8 and
    // JavaScriptCore is a typeof "function".  Only in
    // V8 are regular expression literals permitted as
    // reduce parameters, so it is desirable in the
    // general case for the shim to match the more
    // strict and common behavior of rejecting regular
    // expressions.

    // ES5 15.4.4.18
    // http://es5.github.com/#x15.4.4.18
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/array/forEach

    // Check failure of by-index access of string characters (IE < 9)
    // and failure of `0 in boxedString` (Rhino)
    var boxedString = $Object('a');
    var splitString = boxedString[0] !== 'a' || !(0 in boxedString);

    var properlyBoxesContext = function properlyBoxed(method) {
        // Check node 0.6.21 bug where third parameter is not boxed
        var properlyBoxesNonStrict = true;
        var properlyBoxesStrict = true;
        var threwException = false;
        if (method) {
            try {
                method.call('foo', function (_, __, context) {
                    if (typeof context !== 'object') {
                        properlyBoxesNonStrict = false;
                    }
                });

                method.call([1], function () {
                    'use strict';

                    properlyBoxesStrict = typeof this === 'string';
                }, 'x');
            } catch (e) {
                threwException = true;
            }
        }
        return !!method && !threwException && properlyBoxesNonStrict && properlyBoxesStrict;
    };

    defineProperties(ArrayPrototype, {
        forEach: function forEach(callbackfn/*, thisArg*/) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var i = -1;
            var length = ES.ToUint32(self.length);
            var T;
            if (arguments.length > 1) {
                T = arguments[1];
            }

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.forEach callback must be a function');
            }

            while (++i < length) {
                if (i in self) {
                    // Invoke the callback function with call, passing arguments:
                    // context, property value, property key, thisArg object
                    if (typeof T === 'undefined') {
                        callbackfn(self[i], i, object);
                    } else {
                        callbackfn.call(T, self[i], i, object);
                    }
                }
            }
        }
    }, !properlyBoxesContext(ArrayPrototype.forEach));

    // ES5 15.4.4.19
    // http://es5.github.com/#x15.4.4.19
    // https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/map
    defineProperties(ArrayPrototype, {
        map: function map(callbackfn/*, thisArg*/) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var length = ES.ToUint32(self.length);
            var result = $Array(length);
            var T;
            if (arguments.length > 1) {
                T = arguments[1];
            }

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.map callback must be a function');
            }

            for (var i = 0; i < length; i++) {
                if (i in self) {
                    if (typeof T === 'undefined') {
                        result[i] = callbackfn(self[i], i, object);
                    } else {
                        result[i] = callbackfn.call(T, self[i], i, object);
                    }
                }
            }
            return result;
        }
    }, !properlyBoxesContext(ArrayPrototype.map));

    // ES5 15.4.4.20
    // http://es5.github.com/#x15.4.4.20
    // https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/filter
    defineProperties(ArrayPrototype, {
        filter: function filter(callbackfn/*, thisArg*/) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var length = ES.ToUint32(self.length);
            var result = [];
            var value;
            var T;
            if (arguments.length > 1) {
                T = arguments[1];
            }

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.filter callback must be a function');
            }

            for (var i = 0; i < length; i++) {
                if (i in self) {
                    value = self[i];
                    if (typeof T === 'undefined' ? callbackfn(value, i, object) : callbackfn.call(T, value, i, object)) {
                        pushCall(result, value);
                    }
                }
            }
            return result;
        }
    }, !properlyBoxesContext(ArrayPrototype.filter));

    // ES5 15.4.4.16
    // http://es5.github.com/#x15.4.4.16
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/every
    defineProperties(ArrayPrototype, {
        every: function every(callbackfn/*, thisArg*/) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var length = ES.ToUint32(self.length);
            var T;
            if (arguments.length > 1) {
                T = arguments[1];
            }

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.every callback must be a function');
            }

            for (var i = 0; i < length; i++) {
                if (i in self && !(typeof T === 'undefined' ? callbackfn(self[i], i, object) : callbackfn.call(T, self[i], i, object))) {
                    return false;
                }
            }
            return true;
        }
    }, !properlyBoxesContext(ArrayPrototype.every));

    // ES5 15.4.4.17
    // http://es5.github.com/#x15.4.4.17
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/some
    defineProperties(ArrayPrototype, {
        some: function some(callbackfn/*, thisArg */) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var length = ES.ToUint32(self.length);
            var T;
            if (arguments.length > 1) {
                T = arguments[1];
            }

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.some callback must be a function');
            }

            for (var i = 0; i < length; i++) {
                if (i in self && (typeof T === 'undefined' ? callbackfn(self[i], i, object) : callbackfn.call(T, self[i], i, object))) {
                    return true;
                }
            }
            return false;
        }
    }, !properlyBoxesContext(ArrayPrototype.some));

    // ES5 15.4.4.21
    // http://es5.github.com/#x15.4.4.21
    // https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/reduce
    var reduceCoercesToObject = false;
    if (ArrayPrototype.reduce) {
        reduceCoercesToObject = typeof ArrayPrototype.reduce.call('es5', function (_, __, ___, list) {
            return list;
        }) === 'object';
    }
    defineProperties(ArrayPrototype, {
        reduce: function reduce(callbackfn/*, initialValue*/) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var length = ES.ToUint32(self.length);

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.reduce callback must be a function');
            }

            // no value to return if no initial value and an empty array
            if (length === 0 && arguments.length === 1) {
                throw new TypeError('reduce of empty array with no initial value');
            }

            var i = 0;
            var result;
            if (arguments.length >= 2) {
                result = arguments[1];
            } else {
                do {
                    if (i in self) {
                        result = self[i++];
                        break;
                    }

                    // if array contains no values, no initial value to return
                    if (++i >= length) {
                        throw new TypeError('reduce of empty array with no initial value');
                    }
                } while (true);
            }

            for (; i < length; i++) {
                if (i in self) {
                    result = callbackfn(result, self[i], i, object);
                }
            }

            return result;
        }
    }, !reduceCoercesToObject);

    // ES5 15.4.4.22
    // http://es5.github.com/#x15.4.4.22
    // https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Objects/Array/reduceRight
    var reduceRightCoercesToObject = false;
    if (ArrayPrototype.reduceRight) {
        reduceRightCoercesToObject = typeof ArrayPrototype.reduceRight.call('es5', function (_, __, ___, list) {
            return list;
        }) === 'object';
    }
    defineProperties(ArrayPrototype, {
        reduceRight: function reduceRight(callbackfn/*, initial*/) {
            var object = ES.ToObject(this);
            var self = splitString && isString(this) ? strSplit(this, '') : object;
            var length = ES.ToUint32(self.length);

            // If no callback function or if callback is not a callable function
            if (!isCallable(callbackfn)) {
                throw new TypeError('Array.prototype.reduceRight callback must be a function');
            }

            // no value to return if no initial value, empty array
            if (length === 0 && arguments.length === 1) {
                throw new TypeError('reduceRight of empty array with no initial value');
            }

            var result;
            var i = length - 1;
            if (arguments.length >= 2) {
                result = arguments[1];
            } else {
                do {
                    if (i in self) {
                        result = self[i--];
                        break;
                    }

                    // if array contains no values, no initial value to return
                    if (--i < 0) {
                        throw new TypeError('reduceRight of empty array with no initial value');
                    }
                } while (true);
            }

            if (i < 0) {
                return result;
            }

            do {
                if (i in self) {
                    result = callbackfn(result, self[i], i, object);
                }
            } while (i--);

            return result;
        }
    }, !reduceRightCoercesToObject);

    // ES5 15.4.4.14
    // http://es5.github.com/#x15.4.4.14
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/indexOf
    var hasFirefox2IndexOfBug = ArrayPrototype.indexOf && [0, 1].indexOf(1, 2) !== -1;
    defineProperties(ArrayPrototype, {
        indexOf: function indexOf(searchElement/*, fromIndex */) {
            var self = splitString && isString(this) ? strSplit(this, '') : ES.ToObject(this);
            var length = ES.ToUint32(self.length);

            if (length === 0) {
                return -1;
            }

            var i = 0;
            if (arguments.length > 1) {
                i = ES.ToInteger(arguments[1]);
            }

            // handle negative indices
            i = i >= 0 ? i : max(0, length + i);
            for (; i < length; i++) {
                if (i in self && self[i] === searchElement) {
                    return i;
                }
            }
            return -1;
        }
    }, hasFirefox2IndexOfBug);

    // ES5 15.4.4.15
    // http://es5.github.com/#x15.4.4.15
    // https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Array/lastIndexOf
    var hasFirefox2LastIndexOfBug = ArrayPrototype.lastIndexOf && [0, 1].lastIndexOf(0, -3) !== -1;
    defineProperties(ArrayPrototype, {
        lastIndexOf: function lastIndexOf(searchElement/*, fromIndex */) {
            var self = splitString && isString(this) ? strSplit(this, '') : ES.ToObject(this);
            var length = ES.ToUint32(self.length);

            if (length === 0) {
                return -1;
            }
            var i = length - 1;
            if (arguments.length > 1) {
                i = min(i, ES.ToInteger(arguments[1]));
            }
            // handle negative indices
            i = i >= 0 ? i : length - Math.abs(i);
            for (; i >= 0; i--) {
                if (i in self && searchElement === self[i]) {
                    return i;
                }
            }
            return -1;
        }
    }, hasFirefox2LastIndexOfBug);

    // ES5 15.4.4.12
    // http://es5.github.com/#x15.4.4.12
    var spliceNoopReturnsEmptyArray = (function () {
        var a = [1, 2];
        var result = a.splice();
        return a.length === 2 && isArray(result) && result.length === 0;
    }());
    defineProperties(ArrayPrototype, {
        // Safari 5.0 bug where .splice() returns undefined
        splice: function splice(start, deleteCount) {
            if (arguments.length === 0) {
                return [];
            } else {
                return array_splice.apply(this, arguments);
            }
        }
    }, !spliceNoopReturnsEmptyArray);

    var spliceWorksWithEmptyObject = (function () {
        var obj = {};
        ArrayPrototype.splice.call(obj, 0, 0, 1);
        return obj.length === 1;
    }());
    defineProperties(ArrayPrototype, {
        splice: function splice(start, deleteCount) {
            if (arguments.length === 0) {
                return [];
            }
            var args = arguments;
            this.length = max(ES.ToInteger(this.length), 0);
            if (arguments.length > 0 && typeof deleteCount !== 'number') {
                args = arraySlice(arguments);
                if (args.length < 2) {
                    pushCall(args, this.length - start);
                } else {
                    args[1] = ES.ToInteger(deleteCount);
                }
            }
            return array_splice.apply(this, args);
        }
    }, !spliceWorksWithEmptyObject);
    var spliceWorksWithLargeSparseArrays = (function () {
        // Per https://github.com/es-shims/es5-shim/issues/295
        // Safari 7/8 breaks with sparse arrays of size 1e5 or greater
        var arr = new $Array(1e5);
        // note: the index MUST be 8 or larger or the test will false pass
        arr[8] = 'x';
        arr.splice(1, 1);
        // note: this test must be defined *after* the indexOf shim
        // per https://github.com/es-shims/es5-shim/issues/313
        return arr.indexOf('x') === 7;
    }());
    var spliceWorksWithSmallSparseArrays = (function () {
        // Per https://github.com/es-shims/es5-shim/issues/295
        // Opera 12.15 breaks on this, no idea why.
        var n = 256;
        var arr = [];
        arr[n] = 'a';
        arr.splice(n + 1, 0, 'b');
        return arr[n] === 'a';
    }());
    defineProperties(ArrayPrototype, {
        splice: function splice(start, deleteCount) {
            var O = ES.ToObject(this);
            var A = [];
            var len = ES.ToUint32(O.length);
            var relativeStart = ES.ToInteger(start);
            var actualStart = relativeStart < 0 ? max((len + relativeStart), 0) : min(relativeStart, len);
            var actualDeleteCount = min(max(ES.ToInteger(deleteCount), 0), len - actualStart);

            var k = 0;
            var from;
            while (k < actualDeleteCount) {
                from = $String(actualStart + k);
                if (owns(O, from)) {
                    A[k] = O[from];
                }
                k += 1;
            }

            var items = arraySlice(arguments, 2);
            var itemCount = items.length;
            var to;
            if (itemCount < actualDeleteCount) {
                k = actualStart;
                var maxK = len - actualDeleteCount;
                while (k < maxK) {
                    from = $String(k + actualDeleteCount);
                    to = $String(k + itemCount);
                    if (owns(O, from)) {
                        O[to] = O[from];
                    } else {
                        delete O[to];
                    }
                    k += 1;
                }
                k = len;
                var minK = len - actualDeleteCount + itemCount;
                while (k > minK) {
                    delete O[k - 1];
                    k -= 1;
                }
            } else if (itemCount > actualDeleteCount) {
                k = len - actualDeleteCount;
                while (k > actualStart) {
                    from = $String(k + actualDeleteCount - 1);
                    to = $String(k + itemCount - 1);
                    if (owns(O, from)) {
                        O[to] = O[from];
                    } else {
                        delete O[to];
                    }
                    k -= 1;
                }
            }
            k = actualStart;
            for (var i = 0; i < items.length; ++i) {
                O[k] = items[i];
                k += 1;
            }
            O.length = len - actualDeleteCount + itemCount;

            return A;
        }
    }, !spliceWorksWithLargeSparseArrays || !spliceWorksWithSmallSparseArrays);

    var originalJoin = ArrayPrototype.join;
    var hasStringJoinBug;
    try {
        hasStringJoinBug = Array.prototype.join.call('123', ',') !== '1,2,3';
    } catch (e) {
        hasStringJoinBug = true;
    }
    if (hasStringJoinBug) {
        defineProperties(ArrayPrototype, {
            join: function join(separator) {
                var sep = typeof separator === 'undefined' ? ',' : separator;
                return originalJoin.call(isString(this) ? strSplit(this, '') : this, sep);
            }
        }, hasStringJoinBug);
    }

    var hasJoinUndefinedBug = [1, 2].join(undefined) !== '1,2';
    if (hasJoinUndefinedBug) {
        defineProperties(ArrayPrototype, {
            join: function join(separator) {
                var sep = typeof separator === 'undefined' ? ',' : separator;
                return originalJoin.call(this, sep);
            }
        }, hasJoinUndefinedBug);
    }

    var pushShim = function push(item) {
        var O = ES.ToObject(this);
        var n = ES.ToUint32(O.length);
        var i = 0;
        while (i < arguments.length) {
            O[n + i] = arguments[i];
            i += 1;
        }
        O.length = n + i;
        return n + i;
    };

    var pushIsNotGeneric = (function () {
        var obj = {};
        var result = Array.prototype.push.call(obj, undefined);
        return result !== 1 || obj.length !== 1 || typeof obj[0] !== 'undefined' || !owns(obj, 0);
    }());
    defineProperties(ArrayPrototype, {
        push: function push(item) {
            if (isArray(this)) {
                return array_push.apply(this, arguments);
            }
            return pushShim.apply(this, arguments);
        }
    }, pushIsNotGeneric);

    // This fixes a very weird bug in Opera 10.6 when pushing `undefined
    var pushUndefinedIsWeird = (function () {
        var arr = [];
        var result = arr.push(undefined);
        return result !== 1 || arr.length !== 1 || typeof arr[0] !== 'undefined' || !owns(arr, 0);
    }());
    defineProperties(ArrayPrototype, { push: pushShim }, pushUndefinedIsWeird);

    // ES5 15.2.3.14
    // http://es5.github.io/#x15.4.4.10
    // Fix boxed string bug
    defineProperties(ArrayPrototype, {
        slice: function (start, end) {
            var arr = isString(this) ? strSplit(this, '') : this;
            return arraySliceApply(arr, arguments);
        }
    }, splitString);

    var sortIgnoresNonFunctions = (function () {
        try {
            [1, 2].sort(null);
            [1, 2].sort({});
            return true;
        } catch (e) {}
        return false;
    }());
    var sortThrowsOnRegex = (function () {
        // this is a problem in Firefox 4, in which `typeof /a/ === 'function'`
        try {
            [1, 2].sort(/a/);
            return false;
        } catch (e) {}
        return true;
    }());
    var sortIgnoresUndefined = (function () {
        // applies in IE 8, for one.
        try {
            [1, 2].sort(undefined);
            return true;
        } catch (e) {}
        return false;
    }());
    defineProperties(ArrayPrototype, {
        sort: function sort(compareFn) {
            if (typeof compareFn === 'undefined') {
                return arraySort(this);
            }
            if (!isCallable(compareFn)) {
                throw new TypeError('Array.prototype.sort callback must be a function');
            }
            return arraySort(this, compareFn);
        }
    }, sortIgnoresNonFunctions || !sortIgnoresUndefined || !sortThrowsOnRegex);

    //
    // Object
    // ======
    //

    // ES5 15.2.3.14
    // http://es5.github.com/#x15.2.3.14

    // http://whattheheadsaid.com/2010/10/a-safer-object-keys-compatibility-implementation
    var hasDontEnumBug = !isEnum({ 'toString': null }, 'toString');
    var hasProtoEnumBug = isEnum(function () {}, 'prototype');
    var hasStringEnumBug = !owns('x', '0');
    var equalsConstructorPrototype = function (o) {
        var ctor = o.constructor;
        return ctor && ctor.prototype === o;
    };
    var blacklistedKeys = {
        $window: true,
        $console: true,
        $parent: true,
        $self: true,
        $frame: true,
        $frames: true,
        $frameElement: true,
        $webkitIndexedDB: true,
        $webkitStorageInfo: true,
        $external: true
    };
    var hasAutomationEqualityBug = (function () {
        /* globals window */
        if (typeof window === 'undefined') {
            return false;
        }
        for (var k in window) {
            try {
                if (!blacklistedKeys['$' + k] && owns(window, k) && window[k] !== null && typeof window[k] === 'object') {
                    equalsConstructorPrototype(window[k]);
                }
            } catch (e) {
                return true;
            }
        }
        return false;
    }());
    var equalsConstructorPrototypeIfNotBuggy = function (object) {
        if (typeof window === 'undefined' || !hasAutomationEqualityBug) {
            return equalsConstructorPrototype(object);
        }
        try {
            return equalsConstructorPrototype(object);
        } catch (e) {
            return false;
        }
    };
    var dontEnums = [
        'toString',
        'toLocaleString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'constructor'
    ];
    var dontEnumsLength = dontEnums.length;

    // taken directly from https://github.com/ljharb/is-arguments/blob/master/index.js
    // can be replaced with require('is-arguments') if we ever use a build process instead
    var isStandardArguments = function isArguments(value) {
        return toStr(value) === '[object Arguments]';
    };
    var isLegacyArguments = function isArguments(value) {
        return value !== null &&
            typeof value === 'object' &&
            typeof value.length === 'number' &&
            value.length >= 0 &&
            !isArray(value) &&
            isCallable(value.callee);
    };
    var isArguments = isStandardArguments(arguments) ? isStandardArguments : isLegacyArguments;

    defineProperties($Object, {
        keys: function keys(object) {
            var isFn = isCallable(object);
            var isArgs = isArguments(object);
            var isObject = object !== null && typeof object === 'object';
            var isStr = isObject && isString(object);

            if (!isObject && !isFn && !isArgs) {
                throw new TypeError('Object.keys called on a non-object');
            }

            var theKeys = [];
            var skipProto = hasProtoEnumBug && isFn;
            if ((isStr && hasStringEnumBug) || isArgs) {
                for (var i = 0; i < object.length; ++i) {
                    pushCall(theKeys, $String(i));
                }
            }

            if (!isArgs) {
                for (var name in object) {
                    if (!(skipProto && name === 'prototype') && owns(object, name)) {
                        pushCall(theKeys, $String(name));
                    }
                }
            }

            if (hasDontEnumBug) {
                var skipConstructor = equalsConstructorPrototypeIfNotBuggy(object);
                for (var j = 0; j < dontEnumsLength; j++) {
                    var dontEnum = dontEnums[j];
                    if (!(skipConstructor && dontEnum === 'constructor') && owns(object, dontEnum)) {
                        pushCall(theKeys, dontEnum);
                    }
                }
            }
            return theKeys;
        }
    });

    var keysWorksWithArguments = $Object.keys && (function () {
        // Safari 5.0 bug
        return $Object.keys(arguments).length === 2;
    }(1, 2));
    var keysHasArgumentsLengthBug = $Object.keys && (function () {
        var argKeys = $Object.keys(arguments);
        return arguments.length !== 1 || argKeys.length !== 1 || argKeys[0] !== 1;
    }(1));
    var originalKeys = $Object.keys;
    defineProperties($Object, {
        keys: function keys(object) {
            if (isArguments(object)) {
                return originalKeys(arraySlice(object));
            } else {
                return originalKeys(object);
            }
        }
    }, !keysWorksWithArguments || keysHasArgumentsLengthBug);

    //
    // Date
    // ====
    //

    var hasNegativeMonthYearBug = new Date(-3509827329600292).getUTCMonth() !== 0;
    var aNegativeTestDate = new Date(-1509842289600292);
    var aPositiveTestDate = new Date(1449662400000);
    var hasToUTCStringFormatBug = aNegativeTestDate.toUTCString() !== 'Mon, 01 Jan -45875 11:59:59 GMT';
    var hasToDateStringFormatBug;
    var hasToStringFormatBug;
    var timeZoneOffset = aNegativeTestDate.getTimezoneOffset();
    if (timeZoneOffset < -720) {
        hasToDateStringFormatBug = aNegativeTestDate.toDateString() !== 'Tue Jan 02 -45875';
        hasToStringFormatBug = !(/^Thu Dec 10 2015 \d\d:\d\d:\d\d GMT[-\+]\d\d\d\d(?: |$)/).test(aPositiveTestDate.toString());
    } else {
        hasToDateStringFormatBug = aNegativeTestDate.toDateString() !== 'Mon Jan 01 -45875';
        hasToStringFormatBug = !(/^Wed Dec 09 2015 \d\d:\d\d:\d\d GMT[-\+]\d\d\d\d(?: |$)/).test(aPositiveTestDate.toString());
    }

    var originalGetFullYear = call.bind(Date.prototype.getFullYear);
    var originalGetMonth = call.bind(Date.prototype.getMonth);
    var originalGetDate = call.bind(Date.prototype.getDate);
    var originalGetUTCFullYear = call.bind(Date.prototype.getUTCFullYear);
    var originalGetUTCMonth = call.bind(Date.prototype.getUTCMonth);
    var originalGetUTCDate = call.bind(Date.prototype.getUTCDate);
    var originalGetUTCDay = call.bind(Date.prototype.getUTCDay);
    var originalGetUTCHours = call.bind(Date.prototype.getUTCHours);
    var originalGetUTCMinutes = call.bind(Date.prototype.getUTCMinutes);
    var originalGetUTCSeconds = call.bind(Date.prototype.getUTCSeconds);
    var originalGetUTCMilliseconds = call.bind(Date.prototype.getUTCMilliseconds);
    var dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var daysInMonth = function daysInMonth(month, year) {
        return originalGetDate(new Date(year, month, 0));
    };

    defineProperties(Date.prototype, {
        getFullYear: function getFullYear() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var year = originalGetFullYear(this);
            if (year < 0 && originalGetMonth(this) > 11) {
                return year + 1;
            }
            return year;
        },
        getMonth: function getMonth() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var year = originalGetFullYear(this);
            var month = originalGetMonth(this);
            if (year < 0 && month > 11) {
                return 0;
            }
            return month;
        },
        getDate: function getDate() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var year = originalGetFullYear(this);
            var month = originalGetMonth(this);
            var date = originalGetDate(this);
            if (year < 0 && month > 11) {
                if (month === 12) {
                    return date;
                }
                var days = daysInMonth(0, year + 1);
                return (days - date) + 1;
            }
            return date;
        },
        getUTCFullYear: function getUTCFullYear() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var year = originalGetUTCFullYear(this);
            if (year < 0 && originalGetUTCMonth(this) > 11) {
                return year + 1;
            }
            return year;
        },
        getUTCMonth: function getUTCMonth() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var year = originalGetUTCFullYear(this);
            var month = originalGetUTCMonth(this);
            if (year < 0 && month > 11) {
                return 0;
            }
            return month;
        },
        getUTCDate: function getUTCDate() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var year = originalGetUTCFullYear(this);
            var month = originalGetUTCMonth(this);
            var date = originalGetUTCDate(this);
            if (year < 0 && month > 11) {
                if (month === 12) {
                    return date;
                }
                var days = daysInMonth(0, year + 1);
                return (days - date) + 1;
            }
            return date;
        }
    }, hasNegativeMonthYearBug);

    defineProperties(Date.prototype, {
        toUTCString: function toUTCString() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var day = originalGetUTCDay(this);
            var date = originalGetUTCDate(this);
            var month = originalGetUTCMonth(this);
            var year = originalGetUTCFullYear(this);
            var hour = originalGetUTCHours(this);
            var minute = originalGetUTCMinutes(this);
            var second = originalGetUTCSeconds(this);
            return dayName[day] + ', ' +
                (date < 10 ? '0' + date : date) + ' ' +
                monthName[month] + ' ' +
                year + ' ' +
                (hour < 10 ? '0' + hour : hour) + ':' +
                (minute < 10 ? '0' + minute : minute) + ':' +
                (second < 10 ? '0' + second : second) + ' GMT';
        }
    }, hasNegativeMonthYearBug || hasToUTCStringFormatBug);

    // Opera 12 has `,`
    defineProperties(Date.prototype, {
        toDateString: function toDateString() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var day = this.getDay();
            var date = this.getDate();
            var month = this.getMonth();
            var year = this.getFullYear();
            return dayName[day] + ' ' +
                monthName[month] + ' ' +
                (date < 10 ? '0' + date : date) + ' ' +
                year;
        }
    }, hasNegativeMonthYearBug || hasToDateStringFormatBug);

    // can't use defineProperties here because of toString enumeration issue in IE <= 8
    if (hasNegativeMonthYearBug || hasToStringFormatBug) {
        Date.prototype.toString = function toString() {
            if (!this || !(this instanceof Date)) {
                throw new TypeError('this is not a Date object.');
            }
            var day = this.getDay();
            var date = this.getDate();
            var month = this.getMonth();
            var year = this.getFullYear();
            var hour = this.getHours();
            var minute = this.getMinutes();
            var second = this.getSeconds();
            var timezoneOffset = this.getTimezoneOffset();
            var hoursOffset = Math.floor(Math.abs(timezoneOffset) / 60);
            var minutesOffset = Math.floor(Math.abs(timezoneOffset) % 60);
            return dayName[day] + ' ' +
                monthName[month] + ' ' +
                (date < 10 ? '0' + date : date) + ' ' +
                year + ' ' +
                (hour < 10 ? '0' + hour : hour) + ':' +
                (minute < 10 ? '0' + minute : minute) + ':' +
                (second < 10 ? '0' + second : second) + ' GMT' +
                (timezoneOffset > 0 ? '-' : '+') +
                (hoursOffset < 10 ? '0' + hoursOffset : hoursOffset) +
                (minutesOffset < 10 ? '0' + minutesOffset : minutesOffset);
        };
        if (supportsDescriptors) {
            $Object.defineProperty(Date.prototype, 'toString', {
                configurable: true,
                enumerable: false,
                writable: true
            });
        }
    }

    // ES5 15.9.5.43
    // http://es5.github.com/#x15.9.5.43
    // This function returns a String value represent the instance in time
    // represented by this Date object. The format of the String is the Date Time
    // string format defined in 15.9.1.15. All fields are present in the String.
    // The time zone is always UTC, denoted by the suffix Z. If the time value of
    // this object is not a finite Number a RangeError exception is thrown.
    var negativeDate = -62198755200000;
    var negativeYearString = '-000001';
    var hasNegativeDateBug = Date.prototype.toISOString && new Date(negativeDate).toISOString().indexOf(negativeYearString) === -1;
    var hasSafari51DateBug = Date.prototype.toISOString && new Date(-1).toISOString() !== '1969-12-31T23:59:59.999Z';

    var getTime = call.bind(Date.prototype.getTime);

    defineProperties(Date.prototype, {
        toISOString: function toISOString() {
            if (!isFinite(this) || !isFinite(getTime(this))) {
                // Adope Photoshop requires the second check.
                throw new RangeError('Date.prototype.toISOString called on non-finite value.');
            }

            var year = originalGetUTCFullYear(this);

            var month = originalGetUTCMonth(this);
            // see https://github.com/es-shims/es5-shim/issues/111
            year += Math.floor(month / 12);
            month = (month % 12 + 12) % 12;

            // the date time string format is specified in 15.9.1.15.
            var result = [month + 1, originalGetUTCDate(this), originalGetUTCHours(this), originalGetUTCMinutes(this), originalGetUTCSeconds(this)];
            year = (
                (year < 0 ? '-' : (year > 9999 ? '+' : '')) +
                strSlice('00000' + Math.abs(year), (0 <= year && year <= 9999) ? -4 : -6)
            );

            for (var i = 0; i < result.length; ++i) {
                // pad months, days, hours, minutes, and seconds to have two digits.
                result[i] = strSlice('00' + result[i], -2);
            }
            // pad milliseconds to have three digits.
            return (
                year + '-' + arraySlice(result, 0, 2).join('-') +
                'T' + arraySlice(result, 2).join(':') + '.' +
                strSlice('000' + originalGetUTCMilliseconds(this), -3) + 'Z'
            );
        }
    }, hasNegativeDateBug || hasSafari51DateBug);

    // ES5 15.9.5.44
    // http://es5.github.com/#x15.9.5.44
    // This function provides a String representation of a Date object for use by
    // JSON.stringify (15.12.3).
    var dateToJSONIsSupported = (function () {
        try {
            return Date.prototype.toJSON &&
                new Date(NaN).toJSON() === null &&
                new Date(negativeDate).toJSON().indexOf(negativeYearString) !== -1 &&
                Date.prototype.toJSON.call({ // generic
                    toISOString: function () { return true; }
                });
        } catch (e) {
            return false;
        }
    }());
    if (!dateToJSONIsSupported) {
        Date.prototype.toJSON = function toJSON(key) {
            // When the toJSON method is called with argument key, the following
            // steps are taken:

            // 1.  Let O be the result of calling ToObject, giving it the this
            // value as its argument.
            // 2. Let tv be ES.ToPrimitive(O, hint Number).
            var O = $Object(this);
            var tv = ES.ToPrimitive(O);
            // 3. If tv is a Number and is not finite, return null.
            if (typeof tv === 'number' && !isFinite(tv)) {
                return null;
            }
            // 4. Let toISO be the result of calling the [[Get]] internal method of
            // O with argument "toISOString".
            var toISO = O.toISOString;
            // 5. If IsCallable(toISO) is false, throw a TypeError exception.
            if (!isCallable(toISO)) {
                throw new TypeError('toISOString property is not callable');
            }
            // 6. Return the result of calling the [[Call]] internal method of
            //  toISO with O as the this value and an empty argument list.
            return toISO.call(O);

            // NOTE 1 The argument is ignored.

            // NOTE 2 The toJSON function is intentionally generic; it does not
            // require that its this value be a Date object. Therefore, it can be
            // transferred to other kinds of objects for use as a method. However,
            // it does require that any such object have a toISOString method. An
            // object is free to use the argument key to filter its
            // stringification.
        };
    }

    // ES5 15.9.4.2
    // http://es5.github.com/#x15.9.4.2
    // based on work shared by Daniel Friesen (dantman)
    // http://gist.github.com/303249
    var supportsExtendedYears = Date.parse('+033658-09-27T01:46:40.000Z') === 1e15;
    var acceptsInvalidDates = !isNaN(Date.parse('2012-04-04T24:00:00.500Z')) || !isNaN(Date.parse('2012-11-31T23:59:59.000Z')) || !isNaN(Date.parse('2012-12-31T23:59:60.000Z'));
    var doesNotParseY2KNewYear = isNaN(Date.parse('2000-01-01T00:00:00.000Z'));
    if (doesNotParseY2KNewYear || acceptsInvalidDates || !supportsExtendedYears) {
        // XXX global assignment won't work in embeddings that use
        // an alternate object for the context.
        /* global Date: true */
        /* eslint-disable no-undef */
        var maxSafeUnsigned32Bit = Math.pow(2, 31) - 1;
        var hasSafariSignedIntBug = isActualNaN(new Date(1970, 0, 1, 0, 0, 0, maxSafeUnsigned32Bit + 1).getTime());
        /* eslint-disable no-implicit-globals */
        Date = (function (NativeDate) {
        /* eslint-enable no-implicit-globals */
        /* eslint-enable no-undef */
            // Date.length === 7
            var DateShim = function Date(Y, M, D, h, m, s, ms) {
                var length = arguments.length;
                var date;
                if (this instanceof NativeDate) {
                    var seconds = s;
                    var millis = ms;
                    if (hasSafariSignedIntBug && length >= 7 && ms > maxSafeUnsigned32Bit) {
                        // work around a Safari 8/9 bug where it treats the seconds as signed
                        var msToShift = Math.floor(ms / maxSafeUnsigned32Bit) * maxSafeUnsigned32Bit;
                        var sToShift = Math.floor(msToShift / 1e3);
                        seconds += sToShift;
                        millis -= sToShift * 1e3;
                    }
                    date = length === 1 && $String(Y) === Y ? // isString(Y)
                        // We explicitly pass it through parse:
                        new NativeDate(DateShim.parse(Y)) :
                        // We have to manually make calls depending on argument
                        // length here
                        length >= 7 ? new NativeDate(Y, M, D, h, m, seconds, millis) :
                        length >= 6 ? new NativeDate(Y, M, D, h, m, seconds) :
                        length >= 5 ? new NativeDate(Y, M, D, h, m) :
                        length >= 4 ? new NativeDate(Y, M, D, h) :
                        length >= 3 ? new NativeDate(Y, M, D) :
                        length >= 2 ? new NativeDate(Y, M) :
                        length >= 1 ? new NativeDate(Y instanceof NativeDate ? +Y : Y) :
                                      new NativeDate();
                } else {
                    date = NativeDate.apply(this, arguments);
                }
                if (!isPrimitive(date)) {
                    // Prevent mixups with unfixed Date object
                    defineProperties(date, { constructor: DateShim }, true);
                }
                return date;
            };

            // 15.9.1.15 Date Time String Format.
            var isoDateExpression = new RegExp('^' +
                '(\\d{4}|[+-]\\d{6})' + // four-digit year capture or sign +
                                          // 6-digit extended year
                '(?:-(\\d{2})' + // optional month capture
                '(?:-(\\d{2})' + // optional day capture
                '(?:' + // capture hours:minutes:seconds.milliseconds
                    'T(\\d{2})' + // hours capture
                    ':(\\d{2})' + // minutes capture
                    '(?:' + // optional :seconds.milliseconds
                        ':(\\d{2})' + // seconds capture
                        '(?:(\\.\\d{1,}))?' + // milliseconds capture
                    ')?' +
                '(' + // capture UTC offset component
                    'Z|' + // UTC capture
                    '(?:' + // offset specifier +/-hours:minutes
                        '([-+])' + // sign capture
                        '(\\d{2})' + // hours offset capture
                        ':(\\d{2})' + // minutes offset capture
                    ')' +
                ')?)?)?)?' +
            '$');

            var months = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

            var dayFromMonth = function dayFromMonth(year, month) {
                var t = month > 1 ? 1 : 0;
                return (
                    months[month] +
                    Math.floor((year - 1969 + t) / 4) -
                    Math.floor((year - 1901 + t) / 100) +
                    Math.floor((year - 1601 + t) / 400) +
                    365 * (year - 1970)
                );
            };

            var toUTC = function toUTC(t) {
                var s = 0;
                var ms = t;
                if (hasSafariSignedIntBug && ms > maxSafeUnsigned32Bit) {
                    // work around a Safari 8/9 bug where it treats the seconds as signed
                    var msToShift = Math.floor(ms / maxSafeUnsigned32Bit) * maxSafeUnsigned32Bit;
                    var sToShift = Math.floor(msToShift / 1e3);
                    s += sToShift;
                    ms -= sToShift * 1e3;
                }
                return $Number(new NativeDate(1970, 0, 1, 0, 0, s, ms));
            };

            // Copy any custom methods a 3rd party library may have added
            for (var key in NativeDate) {
                if (owns(NativeDate, key)) {
                    DateShim[key] = NativeDate[key];
                }
            }

            // Copy "native" methods explicitly; they may be non-enumerable
            defineProperties(DateShim, {
                now: NativeDate.now,
                UTC: NativeDate.UTC
            }, true);
            DateShim.prototype = NativeDate.prototype;
            defineProperties(DateShim.prototype, {
                constructor: DateShim
            }, true);

            // Upgrade Date.parse to handle simplified ISO 8601 strings
            var parseShim = function parse(string) {
                var match = isoDateExpression.exec(string);
                if (match) {
                    // parse months, days, hours, minutes, seconds, and milliseconds
                    // provide default values if necessary
                    // parse the UTC offset component
                    var year = $Number(match[1]),
                        month = $Number(match[2] || 1) - 1,
                        day = $Number(match[3] || 1) - 1,
                        hour = $Number(match[4] || 0),
                        minute = $Number(match[5] || 0),
                        second = $Number(match[6] || 0),
                        millisecond = Math.floor($Number(match[7] || 0) * 1000),
                        // When time zone is missed, local offset should be used
                        // (ES 5.1 bug)
                        // see https://bugs.ecmascript.org/show_bug.cgi?id=112
                        isLocalTime = Boolean(match[4] && !match[8]),
                        signOffset = match[9] === '-' ? 1 : -1,
                        hourOffset = $Number(match[10] || 0),
                        minuteOffset = $Number(match[11] || 0),
                        result;
                    var hasMinutesOrSecondsOrMilliseconds = minute > 0 || second > 0 || millisecond > 0;
                    if (
                        hour < (hasMinutesOrSecondsOrMilliseconds ? 24 : 25) &&
                        minute < 60 && second < 60 && millisecond < 1000 &&
                        month > -1 && month < 12 && hourOffset < 24 &&
                        minuteOffset < 60 && // detect invalid offsets
                        day > -1 &&
                        day < (dayFromMonth(year, month + 1) - dayFromMonth(year, month))
                    ) {
                        result = (
                            (dayFromMonth(year, month) + day) * 24 +
                            hour +
                            hourOffset * signOffset
                        ) * 60;
                        result = (
                            (result + minute + minuteOffset * signOffset) * 60 +
                            second
                        ) * 1000 + millisecond;
                        if (isLocalTime) {
                            result = toUTC(result);
                        }
                        if (-8.64e15 <= result && result <= 8.64e15) {
                            return result;
                        }
                    }
                    return NaN;
                }
                return NativeDate.parse.apply(this, arguments);
            };
            defineProperties(DateShim, { parse: parseShim });

            return DateShim;
        }(Date));
        /* global Date: false */
    }

    // ES5 15.9.4.4
    // http://es5.github.com/#x15.9.4.4
    if (!Date.now) {
        Date.now = function now() {
            return new Date().getTime();
        };
    }

    //
    // Number
    // ======
    //

    // ES5.1 15.7.4.5
    // http://es5.github.com/#x15.7.4.5
    var hasToFixedBugs = NumberPrototype.toFixed && (
      (0.00008).toFixed(3) !== '0.000' ||
      (0.9).toFixed(0) !== '1' ||
      (1.255).toFixed(2) !== '1.25' ||
      (1000000000000000128).toFixed(0) !== '1000000000000000128'
    );

    var toFixedHelpers = {
        base: 1e7,
        size: 6,
        data: [0, 0, 0, 0, 0, 0],
        multiply: function multiply(n, c) {
            var i = -1;
            var c2 = c;
            while (++i < toFixedHelpers.size) {
                c2 += n * toFixedHelpers.data[i];
                toFixedHelpers.data[i] = c2 % toFixedHelpers.base;
                c2 = Math.floor(c2 / toFixedHelpers.base);
            }
        },
        divide: function divide(n) {
            var i = toFixedHelpers.size;
            var c = 0;
            while (--i >= 0) {
                c += toFixedHelpers.data[i];
                toFixedHelpers.data[i] = Math.floor(c / n);
                c = (c % n) * toFixedHelpers.base;
            }
        },
        numToString: function numToString() {
            var i = toFixedHelpers.size;
            var s = '';
            while (--i >= 0) {
                if (s !== '' || i === 0 || toFixedHelpers.data[i] !== 0) {
                    var t = $String(toFixedHelpers.data[i]);
                    if (s === '') {
                        s = t;
                    } else {
                        s += strSlice('0000000', 0, 7 - t.length) + t;
                    }
                }
            }
            return s;
        },
        pow: function pow(x, n, acc) {
            return (n === 0 ? acc : (n % 2 === 1 ? pow(x, n - 1, acc * x) : pow(x * x, n / 2, acc)));
        },
        log: function log(x) {
            var n = 0;
            var x2 = x;
            while (x2 >= 4096) {
                n += 12;
                x2 /= 4096;
            }
            while (x2 >= 2) {
                n += 1;
                x2 /= 2;
            }
            return n;
        }
    };

    var toFixedShim = function toFixed(fractionDigits) {
        var f, x, s, m, e, z, j, k;

        // Test for NaN and round fractionDigits down
        f = $Number(fractionDigits);
        f = isActualNaN(f) ? 0 : Math.floor(f);

        if (f < 0 || f > 20) {
            throw new RangeError('Number.toFixed called with invalid number of decimals');
        }

        x = $Number(this);

        if (isActualNaN(x)) {
            return 'NaN';
        }

        // If it is too big or small, return the string value of the number
        if (x <= -1e21 || x >= 1e21) {
            return $String(x);
        }

        s = '';

        if (x < 0) {
            s = '-';
            x = -x;
        }

        m = '0';

        if (x > 1e-21) {
            // 1e-21 < x < 1e21
            // -70 < log2(x) < 70
            e = toFixedHelpers.log(x * toFixedHelpers.pow(2, 69, 1)) - 69;
            z = (e < 0 ? x * toFixedHelpers.pow(2, -e, 1) : x / toFixedHelpers.pow(2, e, 1));
            z *= 0x10000000000000; // Math.pow(2, 52);
            e = 52 - e;

            // -18 < e < 122
            // x = z / 2 ^ e
            if (e > 0) {
                toFixedHelpers.multiply(0, z);
                j = f;

                while (j >= 7) {
                    toFixedHelpers.multiply(1e7, 0);
                    j -= 7;
                }

                toFixedHelpers.multiply(toFixedHelpers.pow(10, j, 1), 0);
                j = e - 1;

                while (j >= 23) {
                    toFixedHelpers.divide(1 << 23);
                    j -= 23;
                }

                toFixedHelpers.divide(1 << j);
                toFixedHelpers.multiply(1, 1);
                toFixedHelpers.divide(2);
                m = toFixedHelpers.numToString();
            } else {
                toFixedHelpers.multiply(0, z);
                toFixedHelpers.multiply(1 << (-e), 0);
                m = toFixedHelpers.numToString() + strSlice('0.00000000000000000000', 2, 2 + f);
            }
        }

        if (f > 0) {
            k = m.length;

            if (k <= f) {
                m = s + strSlice('0.0000000000000000000', 0, f - k + 2) + m;
            } else {
                m = s + strSlice(m, 0, k - f) + '.' + strSlice(m, k - f);
            }
        } else {
            m = s + m;
        }

        return m;
    };
    defineProperties(NumberPrototype, { toFixed: toFixedShim }, hasToFixedBugs);

    var hasToPrecisionUndefinedBug = (function () {
        try {
            return 1.0.toPrecision(undefined) === '1';
        } catch (e) {
            return true;
        }
    }());
    var originalToPrecision = NumberPrototype.toPrecision;
    defineProperties(NumberPrototype, {
        toPrecision: function toPrecision(precision) {
            return typeof precision === 'undefined' ? originalToPrecision.call(this) : originalToPrecision.call(this, precision);
        }
    }, hasToPrecisionUndefinedBug);

    //
    // String
    // ======
    //

    // ES5 15.5.4.14
    // http://es5.github.com/#x15.5.4.14

    // [bugfix, IE lt 9, firefox 4, Konqueror, Opera, obscure browsers]
    // Many browsers do not split properly with regular expressions or they
    // do not perform the split correctly under obscure conditions.
    // See http://blog.stevenlevithan.com/archives/cross-browser-split
    // I've tested in many browsers and this seems to cover the deviant ones:
    //    'ab'.split(/(?:ab)*/) should be ["", ""], not [""]
    //    '.'.split(/(.?)(.?)/) should be ["", ".", "", ""], not ["", ""]
    //    'tesst'.split(/(s)*/) should be ["t", undefined, "e", "s", "t"], not
    //       [undefined, "t", undefined, "e", ...]
    //    ''.split(/.?/) should be [], not [""]
    //    '.'.split(/()()/) should be ["."], not ["", "", "."]

    if (
        'ab'.split(/(?:ab)*/).length !== 2 ||
        '.'.split(/(.?)(.?)/).length !== 4 ||
        'tesst'.split(/(s)*/)[1] === 't' ||
        'test'.split(/(?:)/, -1).length !== 4 ||
        ''.split(/.?/).length ||
        '.'.split(/()()/).length > 1
    ) {
        (function () {
            var compliantExecNpcg = typeof (/()??/).exec('')[1] === 'undefined'; // NPCG: nonparticipating capturing group
            var maxSafe32BitInt = Math.pow(2, 32) - 1;

            StringPrototype.split = function (separator, limit) {
                var string = String(this);
                if (typeof separator === 'undefined' && limit === 0) {
                    return [];
                }

                // If `separator` is not a regex, use native split
                if (!isRegex(separator)) {
                    return strSplit(this, separator, limit);
                }

                var output = [];
                var flags = (separator.ignoreCase ? 'i' : '') +
                            (separator.multiline ? 'm' : '') +
                            (separator.unicode ? 'u' : '') + // in ES6
                            (separator.sticky ? 'y' : ''), // Firefox 3+ and ES6
                    lastLastIndex = 0,
                    // Make `global` and avoid `lastIndex` issues by working with a copy
                    separator2, match, lastIndex, lastLength;
                var separatorCopy = new RegExp(separator.source, flags + 'g');
                if (!compliantExecNpcg) {
                    // Doesn't need flags gy, but they don't hurt
                    separator2 = new RegExp('^' + separatorCopy.source + '$(?!\\s)', flags);
                }
                /* Values for `limit`, per the spec:
                 * If undefined: 4294967295 // maxSafe32BitInt
                 * If 0, Infinity, or NaN: 0
                 * If positive number: limit = Math.floor(limit); if (limit > 4294967295) limit -= 4294967296;
                 * If negative number: 4294967296 - Math.floor(Math.abs(limit))
                 * If other: Type-convert, then use the above rules
                 */
                var splitLimit = typeof limit === 'undefined' ? maxSafe32BitInt : ES.ToUint32(limit);
                match = separatorCopy.exec(string);
                while (match) {
                    // `separatorCopy.lastIndex` is not reliable cross-browser
                    lastIndex = match.index + match[0].length;
                    if (lastIndex > lastLastIndex) {
                        pushCall(output, strSlice(string, lastLastIndex, match.index));
                        // Fix browsers whose `exec` methods don't consistently return `undefined` for
                        // nonparticipating capturing groups
                        if (!compliantExecNpcg && match.length > 1) {
                            /* eslint-disable no-loop-func */
                            match[0].replace(separator2, function () {
                                for (var i = 1; i < arguments.length - 2; i++) {
                                    if (typeof arguments[i] === 'undefined') {
                                        match[i] = void 0;
                                    }
                                }
                            });
                            /* eslint-enable no-loop-func */
                        }
                        if (match.length > 1 && match.index < string.length) {
                            array_push.apply(output, arraySlice(match, 1));
                        }
                        lastLength = match[0].length;
                        lastLastIndex = lastIndex;
                        if (output.length >= splitLimit) {
                            break;
                        }
                    }
                    if (separatorCopy.lastIndex === match.index) {
                        separatorCopy.lastIndex++; // Avoid an infinite loop
                    }
                    match = separatorCopy.exec(string);
                }
                if (lastLastIndex === string.length) {
                    if (lastLength || !separatorCopy.test('')) {
                        pushCall(output, '');
                    }
                } else {
                    pushCall(output, strSlice(string, lastLastIndex));
                }
                return output.length > splitLimit ? arraySlice(output, 0, splitLimit) : output;
            };
        }());

    // [bugfix, chrome]
    // If separator is undefined, then the result array contains just one String,
    // which is the this value (converted to a String). If limit is not undefined,
    // then the output array is truncated so that it contains no more than limit
    // elements.
    // "0".split(undefined, 0) -> []
    } else if ('0'.split(void 0, 0).length) {
        StringPrototype.split = function split(separator, limit) {
            if (typeof separator === 'undefined' && limit === 0) {
                return [];
            }
            return strSplit(this, separator, limit);
        };
    }

    var str_replace = StringPrototype.replace;
    var replaceReportsGroupsCorrectly = (function () {
        var groups = [];
        'x'.replace(/x(.)?/g, function (match, group) {
            pushCall(groups, group);
        });
        return groups.length === 1 && typeof groups[0] === 'undefined';
    }());

    if (!replaceReportsGroupsCorrectly) {
        StringPrototype.replace = function replace(searchValue, replaceValue) {
            var isFn = isCallable(replaceValue);
            var hasCapturingGroups = isRegex(searchValue) && (/\)[*?]/).test(searchValue.source);
            if (!isFn || !hasCapturingGroups) {
                return str_replace.call(this, searchValue, replaceValue);
            } else {
                var wrappedReplaceValue = function (match) {
                    var length = arguments.length;
                    var originalLastIndex = searchValue.lastIndex;
                    searchValue.lastIndex = 0;
                    var args = searchValue.exec(match) || [];
                    searchValue.lastIndex = originalLastIndex;
                    pushCall(args, arguments[length - 2], arguments[length - 1]);
                    return replaceValue.apply(this, args);
                };
                return str_replace.call(this, searchValue, wrappedReplaceValue);
            }
        };
    }

    // ECMA-262, 3rd B.2.3
    // Not an ECMAScript standard, although ECMAScript 3rd Edition has a
    // non-normative section suggesting uniform semantics and it should be
    // normalized across all browsers
    // [bugfix, IE lt 9] IE < 9 substr() with negative value not working in IE
    var string_substr = StringPrototype.substr;
    var hasNegativeSubstrBug = ''.substr && '0b'.substr(-1) !== 'b';
    defineProperties(StringPrototype, {
        substr: function substr(start, length) {
            var normalizedStart = start;
            if (start < 0) {
                normalizedStart = max(this.length + start, 0);
            }
            return string_substr.call(this, normalizedStart, length);
        }
    }, hasNegativeSubstrBug);

    // ES5 15.5.4.20
    // whitespace from: http://es5.github.io/#x15.5.4.20
    var ws = '\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003' +
        '\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028' +
        '\u2029\uFEFF';
    var zeroWidth = '\u200b';
    var wsRegexChars = '[' + ws + ']';
    var trimBeginRegexp = new RegExp('^' + wsRegexChars + wsRegexChars + '*');
    var trimEndRegexp = new RegExp(wsRegexChars + wsRegexChars + '*$');
    var hasTrimWhitespaceBug = StringPrototype.trim && (ws.trim() || !zeroWidth.trim());
    defineProperties(StringPrototype, {
        // http://blog.stevenlevithan.com/archives/faster-trim-javascript
        // http://perfectionkills.com/whitespace-deviations/
        trim: function trim() {
            if (typeof this === 'undefined' || this === null) {
                throw new TypeError("can't convert " + this + ' to object');
            }
            return $String(this).replace(trimBeginRegexp, '').replace(trimEndRegexp, '');
        }
    }, hasTrimWhitespaceBug);
    var trim = call.bind(String.prototype.trim);

    var hasLastIndexBug = StringPrototype.lastIndexOf && 'abcあい'.lastIndexOf('あい', 2) !== -1;
    defineProperties(StringPrototype, {
        lastIndexOf: function lastIndexOf(searchString) {
            if (typeof this === 'undefined' || this === null) {
                throw new TypeError("can't convert " + this + ' to object');
            }
            var S = $String(this);
            var searchStr = $String(searchString);
            var numPos = arguments.length > 1 ? $Number(arguments[1]) : NaN;
            var pos = isActualNaN(numPos) ? Infinity : ES.ToInteger(numPos);
            var start = min(max(pos, 0), S.length);
            var searchLen = searchStr.length;
            var k = start + searchLen;
            while (k > 0) {
                k = max(0, k - searchLen);
                var index = strIndexOf(strSlice(S, k, start + searchLen), searchStr);
                if (index !== -1) {
                    return k + index;
                }
            }
            return -1;
        }
    }, hasLastIndexBug);

    var originalLastIndexOf = StringPrototype.lastIndexOf;
    defineProperties(StringPrototype, {
        lastIndexOf: function lastIndexOf(searchString) {
            return originalLastIndexOf.apply(this, arguments);
        }
    }, StringPrototype.lastIndexOf.length !== 1);

    // ES-5 15.1.2.2
    /* eslint-disable radix */
    if (parseInt(ws + '08') !== 8 || parseInt(ws + '0x16') !== 22) {
    /* eslint-enable radix */
        /* global parseInt: true */
        parseInt = (function (origParseInt) {
            var hexRegex = /^[\-+]?0[xX]/;
            return function parseInt(str, radix) {
                var string = trim(String(str));
                var defaultedRadix = $Number(radix) || (hexRegex.test(string) ? 16 : 10);
                return origParseInt(string, defaultedRadix);
            };
        }(parseInt));
    }

    // https://es5.github.io/#x15.1.2.3
    if (1 / parseFloat('-0') !== -Infinity) {
        /* global parseFloat: true */
        parseFloat = (function (origParseFloat) {
            return function parseFloat(string) {
                var inputString = trim(String(string));
                var result = origParseFloat(inputString);
                return result === 0 && strSlice(inputString, 0, 1) === '-' ? -0 : result;
            };
        }(parseFloat));
    }

    if (String(new RangeError('test')) !== 'RangeError: test') {
        var errorToStringShim = function toString() {
            if (typeof this === 'undefined' || this === null) {
                throw new TypeError("can't convert " + this + ' to object');
            }
            var name = this.name;
            if (typeof name === 'undefined') {
                name = 'Error';
            } else if (typeof name !== 'string') {
                name = $String(name);
            }
            var msg = this.message;
            if (typeof msg === 'undefined') {
                msg = '';
            } else if (typeof msg !== 'string') {
                msg = $String(msg);
            }
            if (!name) {
                return msg;
            }
            if (!msg) {
                return name;
            }
            return name + ': ' + msg;
        };
        // can't use defineProperties here because of toString enumeration issue in IE <= 8
        Error.prototype.toString = errorToStringShim;
    }

    if (supportsDescriptors) {
        var ensureNonEnumerable = function (obj, prop) {
            if (isEnum(obj, prop)) {
                var desc = Object.getOwnPropertyDescriptor(obj, prop);
                if (desc.configurable) {
                    desc.enumerable = false;
                    Object.defineProperty(obj, prop, desc);
                }
            }
        };
        ensureNonEnumerable(Error.prototype, 'message');
        if (Error.prototype.message !== '') {
            Error.prototype.message = '';
        }
        ensureNonEnumerable(Error.prototype, 'name');
    }

    if (String(/a/mig) !== '/a/gim') {
        var regexToString = function toString() {
            var str = '/' + this.source + '/';
            if (this.global) {
                str += 'g';
            }
            if (this.ignoreCase) {
                str += 'i';
            }
            if (this.multiline) {
                str += 'm';
            }
            return str;
        };
        // can't use defineProperties here because of toString enumeration issue in IE <= 8
        RegExp.prototype.toString = regexToString;
    }
}));

},{}],8:[function(require,module,exports){
(function (process,global){
/*!
 * @overview es6-promise - a tiny implementation of Promises/A+.
 * @copyright Copyright (c) 2014 Yehuda Katz, Tom Dale, Stefan Penner and contributors (Conversion to ES6 API by Jake Archibald)
 * @license   Licensed under MIT license
 *            See https://raw.githubusercontent.com/jakearchibald/es6-promise/master/LICENSE
 * @version   3.2.1
 */

(function() {
    "use strict";
    function lib$es6$promise$utils$$objectOrFunction(x) {
      return typeof x === 'function' || (typeof x === 'object' && x !== null);
    }

    function lib$es6$promise$utils$$isFunction(x) {
      return typeof x === 'function';
    }

    function lib$es6$promise$utils$$isMaybeThenable(x) {
      return typeof x === 'object' && x !== null;
    }

    var lib$es6$promise$utils$$_isArray;
    if (!Array.isArray) {
      lib$es6$promise$utils$$_isArray = function (x) {
        return Object.prototype.toString.call(x) === '[object Array]';
      };
    } else {
      lib$es6$promise$utils$$_isArray = Array.isArray;
    }

    var lib$es6$promise$utils$$isArray = lib$es6$promise$utils$$_isArray;
    var lib$es6$promise$asap$$len = 0;
    var lib$es6$promise$asap$$vertxNext;
    var lib$es6$promise$asap$$customSchedulerFn;

    var lib$es6$promise$asap$$asap = function asap(callback, arg) {
      lib$es6$promise$asap$$queue[lib$es6$promise$asap$$len] = callback;
      lib$es6$promise$asap$$queue[lib$es6$promise$asap$$len + 1] = arg;
      lib$es6$promise$asap$$len += 2;
      if (lib$es6$promise$asap$$len === 2) {
        // If len is 2, that means that we need to schedule an async flush.
        // If additional callbacks are queued before the queue is flushed, they
        // will be processed by this flush that we are scheduling.
        if (lib$es6$promise$asap$$customSchedulerFn) {
          lib$es6$promise$asap$$customSchedulerFn(lib$es6$promise$asap$$flush);
        } else {
          lib$es6$promise$asap$$scheduleFlush();
        }
      }
    }

    function lib$es6$promise$asap$$setScheduler(scheduleFn) {
      lib$es6$promise$asap$$customSchedulerFn = scheduleFn;
    }

    function lib$es6$promise$asap$$setAsap(asapFn) {
      lib$es6$promise$asap$$asap = asapFn;
    }

    var lib$es6$promise$asap$$browserWindow = (typeof window !== 'undefined') ? window : undefined;
    var lib$es6$promise$asap$$browserGlobal = lib$es6$promise$asap$$browserWindow || {};
    var lib$es6$promise$asap$$BrowserMutationObserver = lib$es6$promise$asap$$browserGlobal.MutationObserver || lib$es6$promise$asap$$browserGlobal.WebKitMutationObserver;
    var lib$es6$promise$asap$$isNode = typeof self === 'undefined' && typeof process !== 'undefined' && {}.toString.call(process) === '[object process]';

    // test for web worker but not in IE10
    var lib$es6$promise$asap$$isWorker = typeof Uint8ClampedArray !== 'undefined' &&
      typeof importScripts !== 'undefined' &&
      typeof MessageChannel !== 'undefined';

    // node
    function lib$es6$promise$asap$$useNextTick() {
      // node version 0.10.x displays a deprecation warning when nextTick is used recursively
      // see https://github.com/cujojs/when/issues/410 for details
      return function() {
        process.nextTick(lib$es6$promise$asap$$flush);
      };
    }

    // vertx
    function lib$es6$promise$asap$$useVertxTimer() {
      return function() {
        lib$es6$promise$asap$$vertxNext(lib$es6$promise$asap$$flush);
      };
    }

    function lib$es6$promise$asap$$useMutationObserver() {
      var iterations = 0;
      var observer = new lib$es6$promise$asap$$BrowserMutationObserver(lib$es6$promise$asap$$flush);
      var node = document.createTextNode('');
      observer.observe(node, { characterData: true });

      return function() {
        node.data = (iterations = ++iterations % 2);
      };
    }

    // web worker
    function lib$es6$promise$asap$$useMessageChannel() {
      var channel = new MessageChannel();
      channel.port1.onmessage = lib$es6$promise$asap$$flush;
      return function () {
        channel.port2.postMessage(0);
      };
    }

    function lib$es6$promise$asap$$useSetTimeout() {
      return function() {
        setTimeout(lib$es6$promise$asap$$flush, 1);
      };
    }

    var lib$es6$promise$asap$$queue = new Array(1000);
    function lib$es6$promise$asap$$flush() {
      for (var i = 0; i < lib$es6$promise$asap$$len; i+=2) {
        var callback = lib$es6$promise$asap$$queue[i];
        var arg = lib$es6$promise$asap$$queue[i+1];

        callback(arg);

        lib$es6$promise$asap$$queue[i] = undefined;
        lib$es6$promise$asap$$queue[i+1] = undefined;
      }

      lib$es6$promise$asap$$len = 0;
    }

    function lib$es6$promise$asap$$attemptVertx() {
      try {
        var r = require;
        var vertx = r('vertx');
        lib$es6$promise$asap$$vertxNext = vertx.runOnLoop || vertx.runOnContext;
        return lib$es6$promise$asap$$useVertxTimer();
      } catch(e) {
        return lib$es6$promise$asap$$useSetTimeout();
      }
    }

    var lib$es6$promise$asap$$scheduleFlush;
    // Decide what async method to use to triggering processing of queued callbacks:
    if (lib$es6$promise$asap$$isNode) {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useNextTick();
    } else if (lib$es6$promise$asap$$BrowserMutationObserver) {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useMutationObserver();
    } else if (lib$es6$promise$asap$$isWorker) {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useMessageChannel();
    } else if (lib$es6$promise$asap$$browserWindow === undefined && typeof require === 'function') {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$attemptVertx();
    } else {
      lib$es6$promise$asap$$scheduleFlush = lib$es6$promise$asap$$useSetTimeout();
    }
    function lib$es6$promise$then$$then(onFulfillment, onRejection) {
      var parent = this;

      var child = new this.constructor(lib$es6$promise$$internal$$noop);

      if (child[lib$es6$promise$$internal$$PROMISE_ID] === undefined) {
        lib$es6$promise$$internal$$makePromise(child);
      }

      var state = parent._state;

      if (state) {
        var callback = arguments[state - 1];
        lib$es6$promise$asap$$asap(function(){
          lib$es6$promise$$internal$$invokeCallback(state, child, callback, parent._result);
        });
      } else {
        lib$es6$promise$$internal$$subscribe(parent, child, onFulfillment, onRejection);
      }

      return child;
    }
    var lib$es6$promise$then$$default = lib$es6$promise$then$$then;
    function lib$es6$promise$promise$resolve$$resolve(object) {
      /*jshint validthis:true */
      var Constructor = this;

      if (object && typeof object === 'object' && object.constructor === Constructor) {
        return object;
      }

      var promise = new Constructor(lib$es6$promise$$internal$$noop);
      lib$es6$promise$$internal$$resolve(promise, object);
      return promise;
    }
    var lib$es6$promise$promise$resolve$$default = lib$es6$promise$promise$resolve$$resolve;
    var lib$es6$promise$$internal$$PROMISE_ID = Math.random().toString(36).substring(16);

    function lib$es6$promise$$internal$$noop() {}

    var lib$es6$promise$$internal$$PENDING   = void 0;
    var lib$es6$promise$$internal$$FULFILLED = 1;
    var lib$es6$promise$$internal$$REJECTED  = 2;

    var lib$es6$promise$$internal$$GET_THEN_ERROR = new lib$es6$promise$$internal$$ErrorObject();

    function lib$es6$promise$$internal$$selfFulfillment() {
      return new TypeError("You cannot resolve a promise with itself");
    }

    function lib$es6$promise$$internal$$cannotReturnOwn() {
      return new TypeError('A promises callback cannot return that same promise.');
    }

    function lib$es6$promise$$internal$$getThen(promise) {
      try {
        return promise.then;
      } catch(error) {
        lib$es6$promise$$internal$$GET_THEN_ERROR.error = error;
        return lib$es6$promise$$internal$$GET_THEN_ERROR;
      }
    }

    function lib$es6$promise$$internal$$tryThen(then, value, fulfillmentHandler, rejectionHandler) {
      try {
        then.call(value, fulfillmentHandler, rejectionHandler);
      } catch(e) {
        return e;
      }
    }

    function lib$es6$promise$$internal$$handleForeignThenable(promise, thenable, then) {
       lib$es6$promise$asap$$asap(function(promise) {
        var sealed = false;
        var error = lib$es6$promise$$internal$$tryThen(then, thenable, function(value) {
          if (sealed) { return; }
          sealed = true;
          if (thenable !== value) {
            lib$es6$promise$$internal$$resolve(promise, value);
          } else {
            lib$es6$promise$$internal$$fulfill(promise, value);
          }
        }, function(reason) {
          if (sealed) { return; }
          sealed = true;

          lib$es6$promise$$internal$$reject(promise, reason);
        }, 'Settle: ' + (promise._label || ' unknown promise'));

        if (!sealed && error) {
          sealed = true;
          lib$es6$promise$$internal$$reject(promise, error);
        }
      }, promise);
    }

    function lib$es6$promise$$internal$$handleOwnThenable(promise, thenable) {
      if (thenable._state === lib$es6$promise$$internal$$FULFILLED) {
        lib$es6$promise$$internal$$fulfill(promise, thenable._result);
      } else if (thenable._state === lib$es6$promise$$internal$$REJECTED) {
        lib$es6$promise$$internal$$reject(promise, thenable._result);
      } else {
        lib$es6$promise$$internal$$subscribe(thenable, undefined, function(value) {
          lib$es6$promise$$internal$$resolve(promise, value);
        }, function(reason) {
          lib$es6$promise$$internal$$reject(promise, reason);
        });
      }
    }

    function lib$es6$promise$$internal$$handleMaybeThenable(promise, maybeThenable, then) {
      if (maybeThenable.constructor === promise.constructor &&
          then === lib$es6$promise$then$$default &&
          constructor.resolve === lib$es6$promise$promise$resolve$$default) {
        lib$es6$promise$$internal$$handleOwnThenable(promise, maybeThenable);
      } else {
        if (then === lib$es6$promise$$internal$$GET_THEN_ERROR) {
          lib$es6$promise$$internal$$reject(promise, lib$es6$promise$$internal$$GET_THEN_ERROR.error);
        } else if (then === undefined) {
          lib$es6$promise$$internal$$fulfill(promise, maybeThenable);
        } else if (lib$es6$promise$utils$$isFunction(then)) {
          lib$es6$promise$$internal$$handleForeignThenable(promise, maybeThenable, then);
        } else {
          lib$es6$promise$$internal$$fulfill(promise, maybeThenable);
        }
      }
    }

    function lib$es6$promise$$internal$$resolve(promise, value) {
      if (promise === value) {
        lib$es6$promise$$internal$$reject(promise, lib$es6$promise$$internal$$selfFulfillment());
      } else if (lib$es6$promise$utils$$objectOrFunction(value)) {
        lib$es6$promise$$internal$$handleMaybeThenable(promise, value, lib$es6$promise$$internal$$getThen(value));
      } else {
        lib$es6$promise$$internal$$fulfill(promise, value);
      }
    }

    function lib$es6$promise$$internal$$publishRejection(promise) {
      if (promise._onerror) {
        promise._onerror(promise._result);
      }

      lib$es6$promise$$internal$$publish(promise);
    }

    function lib$es6$promise$$internal$$fulfill(promise, value) {
      if (promise._state !== lib$es6$promise$$internal$$PENDING) { return; }

      promise._result = value;
      promise._state = lib$es6$promise$$internal$$FULFILLED;

      if (promise._subscribers.length !== 0) {
        lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publish, promise);
      }
    }

    function lib$es6$promise$$internal$$reject(promise, reason) {
      if (promise._state !== lib$es6$promise$$internal$$PENDING) { return; }
      promise._state = lib$es6$promise$$internal$$REJECTED;
      promise._result = reason;

      lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publishRejection, promise);
    }

    function lib$es6$promise$$internal$$subscribe(parent, child, onFulfillment, onRejection) {
      var subscribers = parent._subscribers;
      var length = subscribers.length;

      parent._onerror = null;

      subscribers[length] = child;
      subscribers[length + lib$es6$promise$$internal$$FULFILLED] = onFulfillment;
      subscribers[length + lib$es6$promise$$internal$$REJECTED]  = onRejection;

      if (length === 0 && parent._state) {
        lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publish, parent);
      }
    }

    function lib$es6$promise$$internal$$publish(promise) {
      var subscribers = promise._subscribers;
      var settled = promise._state;

      if (subscribers.length === 0) { return; }

      var child, callback, detail = promise._result;

      for (var i = 0; i < subscribers.length; i += 3) {
        child = subscribers[i];
        callback = subscribers[i + settled];

        if (child) {
          lib$es6$promise$$internal$$invokeCallback(settled, child, callback, detail);
        } else {
          callback(detail);
        }
      }

      promise._subscribers.length = 0;
    }

    function lib$es6$promise$$internal$$ErrorObject() {
      this.error = null;
    }

    var lib$es6$promise$$internal$$TRY_CATCH_ERROR = new lib$es6$promise$$internal$$ErrorObject();

    function lib$es6$promise$$internal$$tryCatch(callback, detail) {
      try {
        return callback(detail);
      } catch(e) {
        lib$es6$promise$$internal$$TRY_CATCH_ERROR.error = e;
        return lib$es6$promise$$internal$$TRY_CATCH_ERROR;
      }
    }

    function lib$es6$promise$$internal$$invokeCallback(settled, promise, callback, detail) {
      var hasCallback = lib$es6$promise$utils$$isFunction(callback),
          value, error, succeeded, failed;

      if (hasCallback) {
        value = lib$es6$promise$$internal$$tryCatch(callback, detail);

        if (value === lib$es6$promise$$internal$$TRY_CATCH_ERROR) {
          failed = true;
          error = value.error;
          value = null;
        } else {
          succeeded = true;
        }

        if (promise === value) {
          lib$es6$promise$$internal$$reject(promise, lib$es6$promise$$internal$$cannotReturnOwn());
          return;
        }

      } else {
        value = detail;
        succeeded = true;
      }

      if (promise._state !== lib$es6$promise$$internal$$PENDING) {
        // noop
      } else if (hasCallback && succeeded) {
        lib$es6$promise$$internal$$resolve(promise, value);
      } else if (failed) {
        lib$es6$promise$$internal$$reject(promise, error);
      } else if (settled === lib$es6$promise$$internal$$FULFILLED) {
        lib$es6$promise$$internal$$fulfill(promise, value);
      } else if (settled === lib$es6$promise$$internal$$REJECTED) {
        lib$es6$promise$$internal$$reject(promise, value);
      }
    }

    function lib$es6$promise$$internal$$initializePromise(promise, resolver) {
      try {
        resolver(function resolvePromise(value){
          lib$es6$promise$$internal$$resolve(promise, value);
        }, function rejectPromise(reason) {
          lib$es6$promise$$internal$$reject(promise, reason);
        });
      } catch(e) {
        lib$es6$promise$$internal$$reject(promise, e);
      }
    }

    var lib$es6$promise$$internal$$id = 0;
    function lib$es6$promise$$internal$$nextId() {
      return lib$es6$promise$$internal$$id++;
    }

    function lib$es6$promise$$internal$$makePromise(promise) {
      promise[lib$es6$promise$$internal$$PROMISE_ID] = lib$es6$promise$$internal$$id++;
      promise._state = undefined;
      promise._result = undefined;
      promise._subscribers = [];
    }

    function lib$es6$promise$promise$all$$all(entries) {
      return new lib$es6$promise$enumerator$$default(this, entries).promise;
    }
    var lib$es6$promise$promise$all$$default = lib$es6$promise$promise$all$$all;
    function lib$es6$promise$promise$race$$race(entries) {
      /*jshint validthis:true */
      var Constructor = this;

      if (!lib$es6$promise$utils$$isArray(entries)) {
        return new Constructor(function(resolve, reject) {
          reject(new TypeError('You must pass an array to race.'));
        });
      } else {
        return new Constructor(function(resolve, reject) {
          var length = entries.length;
          for (var i = 0; i < length; i++) {
            Constructor.resolve(entries[i]).then(resolve, reject);
          }
        });
      }
    }
    var lib$es6$promise$promise$race$$default = lib$es6$promise$promise$race$$race;
    function lib$es6$promise$promise$reject$$reject(reason) {
      /*jshint validthis:true */
      var Constructor = this;
      var promise = new Constructor(lib$es6$promise$$internal$$noop);
      lib$es6$promise$$internal$$reject(promise, reason);
      return promise;
    }
    var lib$es6$promise$promise$reject$$default = lib$es6$promise$promise$reject$$reject;


    function lib$es6$promise$promise$$needsResolver() {
      throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
    }

    function lib$es6$promise$promise$$needsNew() {
      throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
    }

    var lib$es6$promise$promise$$default = lib$es6$promise$promise$$Promise;
    /**
      Promise objects represent the eventual result of an asynchronous operation. The
      primary way of interacting with a promise is through its `then` method, which
      registers callbacks to receive either a promise's eventual value or the reason
      why the promise cannot be fulfilled.

      Terminology
      -----------

      - `promise` is an object or function with a `then` method whose behavior conforms to this specification.
      - `thenable` is an object or function that defines a `then` method.
      - `value` is any legal JavaScript value (including undefined, a thenable, or a promise).
      - `exception` is a value that is thrown using the throw statement.
      - `reason` is a value that indicates why a promise was rejected.
      - `settled` the final resting state of a promise, fulfilled or rejected.

      A promise can be in one of three states: pending, fulfilled, or rejected.

      Promises that are fulfilled have a fulfillment value and are in the fulfilled
      state.  Promises that are rejected have a rejection reason and are in the
      rejected state.  A fulfillment value is never a thenable.

      Promises can also be said to *resolve* a value.  If this value is also a
      promise, then the original promise's settled state will match the value's
      settled state.  So a promise that *resolves* a promise that rejects will
      itself reject, and a promise that *resolves* a promise that fulfills will
      itself fulfill.


      Basic Usage:
      ------------

      ```js
      var promise = new Promise(function(resolve, reject) {
        // on success
        resolve(value);

        // on failure
        reject(reason);
      });

      promise.then(function(value) {
        // on fulfillment
      }, function(reason) {
        // on rejection
      });
      ```

      Advanced Usage:
      ---------------

      Promises shine when abstracting away asynchronous interactions such as
      `XMLHttpRequest`s.

      ```js
      function getJSON(url) {
        return new Promise(function(resolve, reject){
          var xhr = new XMLHttpRequest();

          xhr.open('GET', url);
          xhr.onreadystatechange = handler;
          xhr.responseType = 'json';
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.send();

          function handler() {
            if (this.readyState === this.DONE) {
              if (this.status === 200) {
                resolve(this.response);
              } else {
                reject(new Error('getJSON: `' + url + '` failed with status: [' + this.status + ']'));
              }
            }
          };
        });
      }

      getJSON('/posts.json').then(function(json) {
        // on fulfillment
      }, function(reason) {
        // on rejection
      });
      ```

      Unlike callbacks, promises are great composable primitives.

      ```js
      Promise.all([
        getJSON('/posts'),
        getJSON('/comments')
      ]).then(function(values){
        values[0] // => postsJSON
        values[1] // => commentsJSON

        return values;
      });
      ```

      @class Promise
      @param {function} resolver
      Useful for tooling.
      @constructor
    */
    function lib$es6$promise$promise$$Promise(resolver) {
      this[lib$es6$promise$$internal$$PROMISE_ID] = lib$es6$promise$$internal$$nextId();
      this._result = this._state = undefined;
      this._subscribers = [];

      if (lib$es6$promise$$internal$$noop !== resolver) {
        typeof resolver !== 'function' && lib$es6$promise$promise$$needsResolver();
        this instanceof lib$es6$promise$promise$$Promise ? lib$es6$promise$$internal$$initializePromise(this, resolver) : lib$es6$promise$promise$$needsNew();
      }
    }

    lib$es6$promise$promise$$Promise.all = lib$es6$promise$promise$all$$default;
    lib$es6$promise$promise$$Promise.race = lib$es6$promise$promise$race$$default;
    lib$es6$promise$promise$$Promise.resolve = lib$es6$promise$promise$resolve$$default;
    lib$es6$promise$promise$$Promise.reject = lib$es6$promise$promise$reject$$default;
    lib$es6$promise$promise$$Promise._setScheduler = lib$es6$promise$asap$$setScheduler;
    lib$es6$promise$promise$$Promise._setAsap = lib$es6$promise$asap$$setAsap;
    lib$es6$promise$promise$$Promise._asap = lib$es6$promise$asap$$asap;

    lib$es6$promise$promise$$Promise.prototype = {
      constructor: lib$es6$promise$promise$$Promise,

    /**
      The primary way of interacting with a promise is through its `then` method,
      which registers callbacks to receive either a promise's eventual value or the
      reason why the promise cannot be fulfilled.

      ```js
      findUser().then(function(user){
        // user is available
      }, function(reason){
        // user is unavailable, and you are given the reason why
      });
      ```

      Chaining
      --------

      The return value of `then` is itself a promise.  This second, 'downstream'
      promise is resolved with the return value of the first promise's fulfillment
      or rejection handler, or rejected if the handler throws an exception.

      ```js
      findUser().then(function (user) {
        return user.name;
      }, function (reason) {
        return 'default name';
      }).then(function (userName) {
        // If `findUser` fulfilled, `userName` will be the user's name, otherwise it
        // will be `'default name'`
      });

      findUser().then(function (user) {
        throw new Error('Found user, but still unhappy');
      }, function (reason) {
        throw new Error('`findUser` rejected and we're unhappy');
      }).then(function (value) {
        // never reached
      }, function (reason) {
        // if `findUser` fulfilled, `reason` will be 'Found user, but still unhappy'.
        // If `findUser` rejected, `reason` will be '`findUser` rejected and we're unhappy'.
      });
      ```
      If the downstream promise does not specify a rejection handler, rejection reasons will be propagated further downstream.

      ```js
      findUser().then(function (user) {
        throw new PedagogicalException('Upstream error');
      }).then(function (value) {
        // never reached
      }).then(function (value) {
        // never reached
      }, function (reason) {
        // The `PedgagocialException` is propagated all the way down to here
      });
      ```

      Assimilation
      ------------

      Sometimes the value you want to propagate to a downstream promise can only be
      retrieved asynchronously. This can be achieved by returning a promise in the
      fulfillment or rejection handler. The downstream promise will then be pending
      until the returned promise is settled. This is called *assimilation*.

      ```js
      findUser().then(function (user) {
        return findCommentsByAuthor(user);
      }).then(function (comments) {
        // The user's comments are now available
      });
      ```

      If the assimliated promise rejects, then the downstream promise will also reject.

      ```js
      findUser().then(function (user) {
        return findCommentsByAuthor(user);
      }).then(function (comments) {
        // If `findCommentsByAuthor` fulfills, we'll have the value here
      }, function (reason) {
        // If `findCommentsByAuthor` rejects, we'll have the reason here
      });
      ```

      Simple Example
      --------------

      Synchronous Example

      ```javascript
      var result;

      try {
        result = findResult();
        // success
      } catch(reason) {
        // failure
      }
      ```

      Errback Example

      ```js
      findResult(function(result, err){
        if (err) {
          // failure
        } else {
          // success
        }
      });
      ```

      Promise Example;

      ```javascript
      findResult().then(function(result){
        // success
      }, function(reason){
        // failure
      });
      ```

      Advanced Example
      --------------

      Synchronous Example

      ```javascript
      var author, books;

      try {
        author = findAuthor();
        books  = findBooksByAuthor(author);
        // success
      } catch(reason) {
        // failure
      }
      ```

      Errback Example

      ```js

      function foundBooks(books) {

      }

      function failure(reason) {

      }

      findAuthor(function(author, err){
        if (err) {
          failure(err);
          // failure
        } else {
          try {
            findBoooksByAuthor(author, function(books, err) {
              if (err) {
                failure(err);
              } else {
                try {
                  foundBooks(books);
                } catch(reason) {
                  failure(reason);
                }
              }
            });
          } catch(error) {
            failure(err);
          }
          // success
        }
      });
      ```

      Promise Example;

      ```javascript
      findAuthor().
        then(findBooksByAuthor).
        then(function(books){
          // found books
      })['catch'](function(reason){
        // something went wrong
      });
      ```

      @method then
      @param {Function} onFulfilled
      @param {Function} onRejected
      Useful for tooling.
      @return {Promise}
    */
      then: lib$es6$promise$then$$default,

    /**
      `catch` is simply sugar for `then(undefined, onRejection)` which makes it the same
      as the catch block of a try/catch statement.

      ```js
      function findAuthor(){
        throw new Error('couldn't find that author');
      }

      // synchronous
      try {
        findAuthor();
      } catch(reason) {
        // something went wrong
      }

      // async with promises
      findAuthor()['catch'](function(reason){
        // something went wrong
      });
      ```

      @method catch
      @param {Function} onRejection
      Useful for tooling.
      @return {Promise}
    */
      'catch': function(onRejection) {
        return this.then(null, onRejection);
      }
    };
    var lib$es6$promise$enumerator$$default = lib$es6$promise$enumerator$$Enumerator;
    function lib$es6$promise$enumerator$$Enumerator(Constructor, input) {
      this._instanceConstructor = Constructor;
      this.promise = new Constructor(lib$es6$promise$$internal$$noop);

      if (!this.promise[lib$es6$promise$$internal$$PROMISE_ID]) {
        lib$es6$promise$$internal$$makePromise(this.promise);
      }

      if (lib$es6$promise$utils$$isArray(input)) {
        this._input     = input;
        this.length     = input.length;
        this._remaining = input.length;

        this._result = new Array(this.length);

        if (this.length === 0) {
          lib$es6$promise$$internal$$fulfill(this.promise, this._result);
        } else {
          this.length = this.length || 0;
          this._enumerate();
          if (this._remaining === 0) {
            lib$es6$promise$$internal$$fulfill(this.promise, this._result);
          }
        }
      } else {
        lib$es6$promise$$internal$$reject(this.promise, lib$es6$promise$enumerator$$validationError());
      }
    }

    function lib$es6$promise$enumerator$$validationError() {
      return new Error('Array Methods must be provided an Array');
    }

    lib$es6$promise$enumerator$$Enumerator.prototype._enumerate = function() {
      var length  = this.length;
      var input   = this._input;

      for (var i = 0; this._state === lib$es6$promise$$internal$$PENDING && i < length; i++) {
        this._eachEntry(input[i], i);
      }
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._eachEntry = function(entry, i) {
      var c = this._instanceConstructor;
      var resolve = c.resolve;

      if (resolve === lib$es6$promise$promise$resolve$$default) {
        var then = lib$es6$promise$$internal$$getThen(entry);

        if (then === lib$es6$promise$then$$default &&
            entry._state !== lib$es6$promise$$internal$$PENDING) {
          this._settledAt(entry._state, i, entry._result);
        } else if (typeof then !== 'function') {
          this._remaining--;
          this._result[i] = entry;
        } else if (c === lib$es6$promise$promise$$default) {
          var promise = new c(lib$es6$promise$$internal$$noop);
          lib$es6$promise$$internal$$handleMaybeThenable(promise, entry, then);
          this._willSettleAt(promise, i);
        } else {
          this._willSettleAt(new c(function(resolve) { resolve(entry); }), i);
        }
      } else {
        this._willSettleAt(resolve(entry), i);
      }
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._settledAt = function(state, i, value) {
      var promise = this.promise;

      if (promise._state === lib$es6$promise$$internal$$PENDING) {
        this._remaining--;

        if (state === lib$es6$promise$$internal$$REJECTED) {
          lib$es6$promise$$internal$$reject(promise, value);
        } else {
          this._result[i] = value;
        }
      }

      if (this._remaining === 0) {
        lib$es6$promise$$internal$$fulfill(promise, this._result);
      }
    };

    lib$es6$promise$enumerator$$Enumerator.prototype._willSettleAt = function(promise, i) {
      var enumerator = this;

      lib$es6$promise$$internal$$subscribe(promise, undefined, function(value) {
        enumerator._settledAt(lib$es6$promise$$internal$$FULFILLED, i, value);
      }, function(reason) {
        enumerator._settledAt(lib$es6$promise$$internal$$REJECTED, i, reason);
      });
    };
    function lib$es6$promise$polyfill$$polyfill() {
      var local;

      if (typeof global !== 'undefined') {
          local = global;
      } else if (typeof self !== 'undefined') {
          local = self;
      } else {
          try {
              local = Function('return this')();
          } catch (e) {
              throw new Error('polyfill failed because global object is unavailable in this environment');
          }
      }

      var P = local.Promise;

      if (P && Object.prototype.toString.call(P.resolve()) === '[object Promise]' && !P.cast) {
        return;
      }

      local.Promise = lib$es6$promise$promise$$default;
    }
    var lib$es6$promise$polyfill$$default = lib$es6$promise$polyfill$$polyfill;

    var lib$es6$promise$umd$$ES6Promise = {
      'Promise': lib$es6$promise$promise$$default,
      'polyfill': lib$es6$promise$polyfill$$default
    };

    /* global define:true module:true window: true */
    if (typeof define === 'function' && define['amd']) {
      define(function() { return lib$es6$promise$umd$$ES6Promise; });
    } else if (typeof module !== 'undefined' && module['exports']) {
      module['exports'] = lib$es6$promise$umd$$ES6Promise;
    } else if (typeof this !== 'undefined') {
      this['ES6Promise'] = lib$es6$promise$umd$$ES6Promise;
    }

    lib$es6$promise$polyfill$$default();
}).call(this);


}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"_process":9}],9:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],10:[function(require,module,exports){
"use strict";
var promiseExtensions_1 = require("./../helpers/promiseExtensions");
var activityManagementAPI_1 = require("./activityManagementAPI");
var activityAGM_1 = require("../core/activityAGM");
var ActivityAPI = (function () {
    function ActivityAPI(manager, my) {
        this.version = "2.1.7";
        this._manager = manager;
        this._my = my;
        this.all = new activityManagementAPI_1.ActivityManagementAPI(manager, my);
    }
    ActivityAPI.prototype.ready = function (callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            _this._manager.ready()
                .then(function () {
                resolve(_this);
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    Object.defineProperty(ActivityAPI.prototype, "my", {
        get: function () {
            return this._my;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityAPI.prototype, "aware", {
        get: function () {
            return this._my.window !== undefined;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityAPI.prototype, "inActivity", {
        get: function () {
            return this.aware && this._my.activity !== undefined;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityAPI.prototype, "agm", {
        get: function () {
            if (!this.aware) {
                return undefined;
            }
            if (!this.inActivity) {
                return new activityAGM_1.ActivityAGM(null);
            }
            return this._my.activity.agm;
        },
        enumerable: true,
        configurable: true
    });
    return ActivityAPI;
}());
exports.ActivityAPI = ActivityAPI;

},{"../core/activityAGM":18,"./../helpers/promiseExtensions":29,"./activityManagementAPI":11}],11:[function(require,module,exports){
"use strict";
var util = require("./../helpers/util");
var ActivityManagementAPI = (function () {
    function ActivityManagementAPI(manager, my) {
        this._manager = manager;
        this._my = my;
        this.activityTypes = {
            get: this._getActivityTypesWrapper.bind(this),
            register: this._manager.registerActivityType.bind(this._manager),
            unregister: this._manager.unregisterActivityType.bind(this._manager),
            subscribe: this._manager.subscribeActivityTypeEvents.bind(this._manager),
            unsubscribe: undefined,
            initiate: this._manager.initiate.bind(this._manager)
        };
        this.windowTypes = {
            get: this._getWindowTypesWrapper.bind(this),
            registerFactory: this._manager.registerWindowFactory.bind(this._manager),
            unregisterFactory: this._manager.unregisterWindowFactory.bind(this._manager),
            subscribe: this._manager.subscribeWindowTypeEvents.bind(this._manager),
            unsubscribe: undefined
        };
        this.windows = {
            get: this._manager.getWindows.bind(this._manager),
            subscribe: this._manager.subscribeWindowEvents.bind(this._manager),
            announce: this._manager.announceWindow.bind(this._manager),
            unsubscribe: undefined,
            create: this._manager.createWindow.bind(this._manager)
        };
        this.instances = {
            get: this._manager.getActivities.bind(this._manager),
            subscribe: this._manager.subscribeActivityEvents.bind(this._manager),
            unsubscribe: undefined
        };
    }
    ActivityManagementAPI.prototype._getActivityTypesWrapper = function (name) {
        if (util.isUndefined(name)) {
            return this._manager.getActivityTypes();
        }
        return this._manager.getActivityType(name);
    };
    ActivityManagementAPI.prototype._getWindowTypesWrapper = function (name) {
        if (util.isUndefined(name)) {
            return this._manager.getWindowTypes();
        }
        return this._manager.getWindowType(name);
    };
    return ActivityManagementAPI;
}());
exports.ActivityManagementAPI = ActivityManagementAPI;

},{"./../helpers/util":31}],12:[function(require,module,exports){
"use strict";
var logger_1 = require("./../helpers/logger");
var util = require("./../helpers/util");
var ActivityMy = (function () {
    function ActivityMy(manager) {
        var _this = this;
        this._myActivityJoinedCallbacks = [];
        this._myActivityRemovedCallbacks = [];
        this._myContextUpdateCallbacks = [];
        this._logger = logger_1.Logger.Get(this);
        this._manager = manager;
        manager.ready()
            .then(function (am) {
            am.subscribeActivityContextChanged(_this._subscribeMyContextChanged.bind(_this));
            am.subscribeWindowEvents(_this._subscribeMyWindowEvent.bind(_this));
        });
    }
    Object.defineProperty(ActivityMy.prototype, "window", {
        get: function () {
            if (util.isUndefinedOrNull(this._window)) {
                var announcedWindows = this._manager.announcedWindows;
                if (announcedWindows.length > 0) {
                    this._window = announcedWindows[0];
                }
            }
            return this._window;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityMy.prototype, "activity", {
        get: function () {
            var myWin = this.window;
            if (util.isUndefinedOrNull(myWin)) {
                return undefined;
            }
            return myWin.activity;
        },
        enumerable: true,
        configurable: true
    });
    ActivityMy.prototype.createWindow = function (windowType) {
        return this._manager.createWindow(this.activity, windowType);
    };
    Object.defineProperty(ActivityMy.prototype, "context", {
        get: function () {
            var activity = this.activity;
            if (util.isUndefined(activity)) {
                return {};
            }
            return activity.context;
        },
        enumerable: true,
        configurable: true
    });
    ActivityMy.prototype.onActivityJoined = function (callback) {
        this._myActivityJoinedCallbacks.push(callback);
        var myWin = this.window;
        if (!util.isUndefinedOrNull(myWin) && !util.isUndefinedOrNull(myWin.activity)) {
            callback(myWin.activity);
        }
    };
    ActivityMy.prototype.onActivityLeft = function (callback) {
        this._myActivityRemovedCallbacks.push(callback);
    };
    ActivityMy.prototype.onContextChanged = function (callback) {
        this._myContextUpdateCallbacks.push(callback);
        var myWin = this.window;
        if (util.isUndefinedOrNull(myWin)) {
            return;
        }
        var activity = myWin.activity;
        if (util.isUndefinedOrNull(activity)) {
            return;
        }
        callback(activity.context, activity.context, [], activity);
    };
    ActivityMy.prototype._subscribeMyContextChanged = function (activity, context, delta, removed) {
        var myWin = this.window;
        if (util.isUndefinedOrNull(myWin)) {
            return;
        }
        var myActivity = myWin.activity;
        if (util.isUndefinedOrNull(myActivity)) {
            return;
        }
        if (activity.id !== myActivity.id) {
            return;
        }
        this._notifyMyContextChanged(activity, context, delta, removed);
    };
    ActivityMy.prototype._subscribeMyWindowEvent = function (activity, window, event) {
        if (util.isUndefinedOrNull(this.window)) {
            return;
        }
        if (this.window.id !== window.id) {
            return;
        }
        if (event === "joined") {
            this._notifyOnJoined(activity);
        }
        else {
            this._notifyMyWindowEvent(activity, this._myActivityRemovedCallbacks);
        }
    };
    ActivityMy.prototype._notifyMyWindowEvent = function (activity, callbackStore) {
        for (var index = 0; index < callbackStore.length; index++) {
            var element = callbackStore[index];
            try {
                element(activity, event);
            }
            catch (e) {
                this._logger.warn('error in user callback ' + e);
            }
        }
    };
    ActivityMy.prototype._notifyMyContextChanged = function (activity, context, delta, removed) {
        delta = delta || {};
        removed = removed || [];
        for (var index = 0; index < this._myContextUpdateCallbacks.length; index++) {
            var element = this._myContextUpdateCallbacks[index];
            try {
                element(context, delta, removed, activity);
            }
            catch (e) {
                this._logger.warn('error in user callback ' + e);
            }
        }
    };
    ActivityMy.prototype._notifyOnJoined = function (activity) {
        this._notifyMyWindowEvent(activity, this._myActivityJoinedCallbacks);
        this._notifyMyContextChanged(activity, activity.context);
    };
    return ActivityMy;
}());
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= ActivityMy;

},{"./../helpers/logger":28,"./../helpers/util":31}],13:[function(require,module,exports){
"use strict";
var ActivityConfig = (function () {
    function ActivityConfig() {
    }
    return ActivityConfig;
}());
exports.ActivityConfig = ActivityConfig;

},{}],14:[function(require,module,exports){
"use strict";
require("es6-promise");
var hcBridge_1 = require("./bridges/hcBridge");
var activityManager_1 = require("./core/activityManager");
var activityMyAPI_1 = require("./API/activityMyAPI");
var logger_1 = require("./helpers/logger");
var util = require("./helpers/util");
var activityConfig_1 = require("./activityConfig");
var activityAPI_1 = require("./API/activityAPI");
var activityAGM_1 = require("./core/activityAGM");
var activity = function (config) {
    config = config || new activityConfig_1.ActivityConfig;
    if (!util.isUndefined(config.logLevel)) {
        logger_1.Logger.Level = config.logLevel;
    }
    if (!util.isUndefinedOrNull(config.logger)) {
        logger_1.Logger.GlueLogger = config.logger;
    }
    var bridge;
    if (!util.isUndefined(window.htmlContainer)) {
        bridge = new hcBridge_1['default']();
    }
    else {
        throw new Error("Activity not supported in in browser");
    }
    if (!bridge) {
        throw new Error("A bridge to native activity is needed to create activity lib.");
    }
    activityAGM_1.ActivityAGM.AGM = config.agm;
    var activityManager = new activityManager_1['default'](bridge, !config.disableAutoAnnounce);
    var my = new activityMyAPI_1['default'](activityManager);
    return new activityAPI_1.ActivityAPI(activityManager, my);
};
module.exports = activity;

},{"./API/activityAPI":10,"./API/activityMyAPI":12,"./activityConfig":13,"./bridges/hcBridge":15,"./core/activityAGM":18,"./core/activityManager":19,"./helpers/logger":28,"./helpers/util":31,"es6-promise":8}],15:[function(require,module,exports){
"use strict";
var entityEvent_1 = require("../contracts/entityEvent");
var activityStatus_1 = require("../contracts/activityStatus");
var activityType_1 = require("../entities/activityType");
var windowType_1 = require("../entities/windowType");
var activity_1 = require("../entities/activity");
var activityWindow_1 = require("../entities/activityWindow");
var proxyWindowFactory_1 = require("../core/proxyWindowFactory");
var logger_1 = require("../helpers/logger");
var entityEvent_2 = require("../contracts/entityEvent");
var readyMarker_1 = require("../helpers/readyMarker");
var util = require("../helpers/util");
var entityEvent_3 = require("../contracts/entityEvent");
var HCBridge = (function () {
    function HCBridge(agm) {
        this._activityTypeEntityName = "activityType";
        this._windowTypeEntityName = "windowType";
        this._activityEntityName = "activity";
        this._windowEntityName = "activityWindow";
        this._logger = logger_1.Logger.Get(this);
        this._lastSeq = 0;
        this._eventQueue = [];
        this._activityTypeCallbacks = [];
        this._windowTypeCallbacks = [];
        this._activityCallbacks = [];
        this._windowCallbacks = [];
        this._agm = agm;
    }
    HCBridge.prototype.init = function () {
        var _this = this;
        this._readyMarker = new readyMarker_1.ReadyMarker("HC Bridge", 1);
        this._htmlContainer = window.htmlContainer.activityFacade;
        this._htmlContainer.init(this._agm ? this._agm.instance : undefined, this._hcEventHandler.bind(this), function () {
            _this._readyMarker.signal("Init done from HC");
        }, function (error) {
            _this._readyMarker.error(error);
        });
    };
    HCBridge.prototype.ready = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._readyMarker.setCallback(function (err) {
                if (!err) {
                    resolve(_this);
                }
                else {
                    _this._logger.error("Error initializing HC bridge - " + err);
                    reject(_this._readyMarker.getError());
                }
            });
        });
    };
    HCBridge.prototype._hcEventHandler = function (eventJson) {
        this._logger.trace(eventJson);
        var event = JSON.parse(eventJson);
        this._processEventBySeq(event);
    };
    HCBridge.prototype._processEventBySeq = function (event) {
        var seq = event.sequence;
        if (seq === this._lastSeq + 1) {
            this._processEvent(event);
            this._lastSeq++;
            var nextEvent = this._eventQueue[seq + 1];
            if (!util.isUndefined(nextEvent)) {
                this._logger.debug("replaying message number " + seq);
                this._processEventBySeq(nextEvent);
                delete this._eventQueue[seq + 1];
            }
        }
        else {
            this._eventQueue[seq] = event;
            this._logger.debug("Got out of order event with number " + seq + ". Will wait for previous event(s) before replaying.");
        }
    };
    HCBridge.prototype._processEvent = function (event) {
        var entityType = event.entityType;
        var eventContext = this._convertContext(event.context);
        var entity;
        switch (entityType) {
            case this._activityTypeEntityName:
                entity = HCBridge._hcToJsActivityType(event.entity);
                this._publishActivityTypeStatusChange(entity, eventContext);
                break;
            case this._windowTypeEntityName:
                entity = this._hcToJsWindowType(event.entity);
                this._publishWindowTypeStatusChange(entity, eventContext);
                break;
            case this._activityEntityName:
                entity = this._hcToJsActivity(event.entity);
                this._publishActivityStatusChange(entity, eventContext);
                break;
            case this._windowEntityName:
                entity = HCBridge._hcToJsWindow(event.entity);
                this._publishActivityWindowEvent(entity, eventContext);
                break;
        }
    };
    HCBridge.prototype._convertContext = function (hcContext) {
        if (hcContext.type === entityEvent_1.EntityEventType.StatusChange) {
            var oldStatus = new activityStatus_1.ActivityStatus(hcContext.oldStatus.state, hcContext.oldStatus.statusMessage, hcContext.oldStatus.statusTime);
            var newStatus = new activityStatus_1.ActivityStatus(hcContext.newStatus.state, hcContext.newStatus.statusMessage, hcContext.newStatus.statusTime);
            return new entityEvent_1.EntityStatusChangeEventContext(newStatus, oldStatus);
        }
        else if (hcContext.type === entityEvent_1.EntityEventType.ActivityWindowEvent) {
            var act = this._hcToJsActivity(hcContext.activity);
            return new entityEvent_1.EntityActivityWindowEventContext(act, hcContext.event);
        }
        else if (hcContext.type === entityEvent_1.EntityEventType.ActivityContextChange) {
            return new entityEvent_3.ActivityContextChangedContext(hcContext.newContext, hcContext.updated, hcContext.removed);
        }
        return new entityEvent_1.EntityEventContext(hcContext.type);
    };
    HCBridge._hcToJsWindow = function (hcWindow) {
        return new activityWindow_1['default'](hcWindow.id, hcWindow.name, hcWindow.type, hcWindow.activityId, hcWindow.instance, hcWindow.isIndependent);
    };
    HCBridge.prototype._hcToJsActivity = function (hcAct) {
        var window = hcAct.owner ? HCBridge._hcToJsWindow(hcAct.owner) : null;
        var status = new activityStatus_1.ActivityStatus(hcAct.status.state, hcAct.status.statusMessage, hcAct.status.statusTime);
        var helperWindows = hcAct.windows ? hcAct.windows.map(function (w) { return HCBridge._hcToJsWindow(w); }) : [];
        var context = JSON.parse(hcAct.context);
        return new activity_1['default'](hcAct.id, hcAct.type.name, status, context, window, helperWindows);
    };
    HCBridge._hcToJsActivityType = function (hcActType) {
        return new activityType_1['default'](hcActType.name, hcActType.ownerWindowType, hcActType.helperWindowTypes, hcActType.description);
    };
    HCBridge.prototype._hcToJsWindowType = function (hcWinType) {
        if (util.isUndefined(hcWinType.factories)) {
            hcWinType.factories = [];
        }
        var factories = hcWinType.factories.map(function (f) {
            return HCBridge._hcToJsWindowTypeFactory(f);
        });
        return new windowType_1['default'](hcWinType.name, factories);
    };
    HCBridge._hcToJsWindowTypeFactory = function (hcWinTypeFactory) {
        return new proxyWindowFactory_1.ProxyWindowFactory(hcWinTypeFactory.description);
    };
    HCBridge._getURLParameter = function (name) {
        return decodeURIComponent((new RegExp('[?|&]' + name + '=' + '([^&;]+?)(&|#|;|$)').exec(location.search) || [, ""])[1].replace(/\+/g, '%20')) || null;
    };
    HCBridge.prototype.getActivityTypes = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.getActivityTypes(function (infos) {
                var result = [];
                for (var index = 0; index < infos.length; index++) {
                    var info = infos[index];
                    var newActivityType = HCBridge._hcToJsActivityType(info);
                    result.push(newActivityType);
                }
                resolve(result);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.registerActivityType = function (activityTypeName, ownerWindow, helperWindows, layoutConfig, description) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (helperWindows === undefined) {
                helperWindows = [];
            }
            var config = {
                name: activityTypeName,
                ownerWindowType: ownerWindow,
                helperWindowTypes: helperWindows,
                description: description,
                layoutConfig: JSON.stringify(layoutConfig)
            };
            _this._htmlContainer.registerActivityType(JSON.stringify(config), function (info) {
                var newActivityType = HCBridge._hcToJsActivityType(info);
                resolve(newActivityType);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.unregisterActivityType = function (activityTypeName) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.unregisterActivityType(activityTypeName, function (info) {
                resolve(true);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.getWindowTypes = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.getWindowTypes(function (infos) {
                var result = [];
                for (var index = 0; index < infos.length; index++) {
                    var info = infos[index];
                    var newWindowType = _this._hcToJsWindowType(info);
                    result.push(newWindowType);
                }
                resolve(result);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.registerWindowFactory = function (windowTypeName, factory) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(windowTypeName)) {
                reject("windowTypeName should be provided");
                return;
            }
            _this._htmlContainer.registerWindowFactory(windowTypeName, factory.create.bind(factory), function (info) {
                resolve(true);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.initiateActivity = function (activityType, context, callback) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(activityType)) {
                reject("windowTypeName should be provided");
                return;
            }
            if (util.isUndefinedOrNull(context)) {
                context = {};
            }
            _this._htmlContainer.initiate(activityType, JSON.stringify(context), function (activityId) {
                resolve(activityId);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.getAnnouncementInfo = function () {
        var hc = window.htmlContainer;
        var context = hc.getContext();
        var result = { activityWindowId: "", activityWindowType: "", activityWindowIndependent: false, activityWindowName: "" };
        result.activityWindowType = context.activityWindowType;
        if (util.isUndefined(result.activityWindowType)) {
            result.activityWindowType = HCBridge._getURLParameter("activityWindowType");
        }
        result.activityWindowId = context.activityWindowId;
        if (util.isUndefined(result.activityWindowId)) {
            result.activityWindowId = HCBridge._getURLParameter("activityWindowId");
        }
        result.activityWindowIndependent = context.activityWindowIndependent;
        if (util.isUndefined(result.activityWindowIndependent)) {
        }
        result.activityWindowName = context.activityWindowName;
        if (util.isUndefined(result.activityWindowName)) {
            result.activityWindowName = HCBridge._getURLParameter("activityWindowName");
        }
        return result;
    };
    HCBridge.prototype.announceWindow = function (windowType, activityWindowId) {
        var _this = this;
        if (util.isUndefined(windowType)) {
            throw new Error("can not determine window type");
        }
        if (util.isUndefined(windowType)) {
            throw new Error("can not determine window activityWindowId");
        }
        this._htmlContainer.announceWindow(windowType, activityWindowId, function (error) {
            _this._logger.error("Error announcing activity window with id '" + activityWindowId + "'. " + error);
        });
    };
    HCBridge.prototype.getActivities = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._logger.trace("Executing getActivities()");
            _this._htmlContainer.getActivities(function (activitiesStr) {
                _this._logger.trace("Got getActivities() :" + activitiesStr);
                var activities = JSON.parse(activitiesStr);
                var result = activities.map(function (act) { return _this._hcToJsActivity(act); });
                resolve(result);
            }, function (error) {
                _this._logger.trace("Error in getActivities() :" + error);
                reject(error);
            });
        });
    };
    HCBridge.prototype.updateActivityContext = function (activity, context, fullReplace, removedKeys) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (util.isUndefined(removedKeys)) {
                removedKeys = [];
            }
            var options = {
                fullReplace: fullReplace,
                removedKeys: removedKeys
            };
            _this._htmlContainer.setActivityContext(activity.id, JSON.stringify(context), JSON.stringify(options), function (newContextString) {
                var newContext = JSON.parse(newContextString);
                resolve(newContext);
            }, function (error) { return reject(error); });
        });
    };
    HCBridge.prototype.getActivityWindows = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.getWindows(function (windows) {
                var result = windows.map(function (wind) { return HCBridge._hcToJsWindow(wind); });
                resolve(result);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.stopActivity = function (activity) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.stopActivity(activity.id, function (result) {
                resolve(result);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.unregisterWindowFactory = function (windowTypeName) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.registerWindowFactory(windowTypeName, function (info) {
                resolve(true);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.createWindow = function (id, windowDefinition) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.createWindow(id, JSON.stringify(windowDefinition), function (id) {
                resolve(id);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.onActivityTypeStatusChange = function (callback) {
        this._activityTypeCallbacks.push(callback);
    };
    HCBridge.prototype.onWindowTypeStatusChange = function (callback) {
        this._windowTypeCallbacks.push(callback);
    };
    HCBridge.prototype.onActivityStatusChange = function (callback) {
        this._activityCallbacks.push(callback);
    };
    HCBridge.prototype.onActivityWindowChange = function (callback) {
        this._windowCallbacks.push(callback);
    };
    HCBridge.prototype.getWindowBounds = function (id) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.getWindowBounds(id, function (bounds) {
                resolve(bounds);
            }, function (err) {
                reject(err);
            });
        });
    };
    HCBridge.prototype.setWindowBounds = function (id, bounds) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.setWindowBounds(id, JSON.stringify(bounds), function () {
                resolve();
            }, function (err) {
                reject(err);
            });
        });
    };
    HCBridge.prototype.registerWindow = function (type, name, independent) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.registerWindow(type, name, independent, function (id) {
                resolve(id);
            }, function (error) {
                reject(error);
            });
        });
    };
    HCBridge.prototype.closeWindow = function (id) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this._htmlContainer.closeWindow(id, function () {
                resolve();
            }, function (err) {
                reject(err);
            });
        });
    };
    HCBridge.prototype._publishStatusChange = function (entity, context, callbacks) {
        var entityEvent = new entityEvent_2.EntityEvent(entity, context);
        callbacks.forEach(function (callback) {
            callback(entityEvent);
        });
    };
    HCBridge.prototype._publishActivityTypeStatusChange = function (at, context) {
        this._publishStatusChange(at, context, this._activityTypeCallbacks);
    };
    HCBridge.prototype._publishWindowTypeStatusChange = function (wt, context) {
        this._publishStatusChange(wt, context, this._windowTypeCallbacks);
    };
    HCBridge.prototype._publishActivityStatusChange = function (act, context) {
        this._publishStatusChange(act, context, this._activityCallbacks);
    };
    HCBridge.prototype._publishActivityWindowEvent = function (w, context) {
        this._publishStatusChange(w, context, this._windowCallbacks);
    };
    return HCBridge;
}());
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= HCBridge;

},{"../contracts/activityStatus":16,"../contracts/entityEvent":17,"../core/proxyWindowFactory":21,"../entities/activity":22,"../entities/activityType":24,"../entities/activityWindow":25,"../entities/windowType":26,"../helpers/logger":28,"../helpers/readyMarker":30,"../helpers/util":31}],16:[function(require,module,exports){
"use strict";
var ActivityStatus = (function () {
    function ActivityStatus(state, message, time) {
        this.state = state;
        this.message = message;
        this.time = time;
    }
    ActivityStatus.prototype.getState = function () {
        return this.state;
    };
    ActivityStatus.prototype.getMessage = function () {
        return this.message;
    };
    ActivityStatus.prototype.getTime = function () {
        return this.time;
    };
    return ActivityStatus;
}());
exports.ActivityStatus = ActivityStatus;

},{}],17:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var EntityEvent = (function () {
    function EntityEvent(entitiy, context) {
        this.entity = entitiy;
        this.context = context;
    }
    return EntityEvent;
}());
exports.EntityEvent = EntityEvent;
var EntityEventContext = (function () {
    function EntityEventContext(eventType) {
        this.type = eventType;
    }
    return EntityEventContext;
}());
exports.EntityEventContext = EntityEventContext;
var EntityStatusChangeEventContext = (function (_super) {
    __extends(EntityStatusChangeEventContext, _super);
    function EntityStatusChangeEventContext(newStatus, oldStatus) {
        _super.call(this, EntityEventType.StatusChange);
        this.newStatus = newStatus;
        this.oldStatus = oldStatus;
    }
    return EntityStatusChangeEventContext;
}(EntityEventContext));
exports.EntityStatusChangeEventContext = EntityStatusChangeEventContext;
var EntityActivityWindowEventContext = (function (_super) {
    __extends(EntityActivityWindowEventContext, _super);
    function EntityActivityWindowEventContext(activity, event) {
        _super.call(this, EntityEventType.ActivityWindowEvent);
        this.activity = activity;
        this.event = event;
    }
    return EntityActivityWindowEventContext;
}(EntityEventContext));
exports.EntityActivityWindowEventContext = EntityActivityWindowEventContext;
var ActivityContextChangedContext = (function (_super) {
    __extends(ActivityContextChangedContext, _super);
    function ActivityContextChangedContext(context, updated, removed) {
        _super.call(this, EntityEventType.ActivityContextChange);
        this.updated = updated;
        this.removed = removed;
        this.context = JSON.parse(context);
    }
    return ActivityContextChangedContext;
}(EntityEventContext));
exports.ActivityContextChangedContext = ActivityContextChangedContext;
var EntityEventType = (function () {
    function EntityEventType() {
    }
    EntityEventType.Added = "added";
    EntityEventType.Removed = "removed";
    EntityEventType.Updated = "updated";
    EntityEventType.FactoryRegistered = "factoryRegistered";
    EntityEventType.FactoryUnregistered = "factoryUnregistered";
    EntityEventType.StatusChange = "statusChange";
    EntityEventType.ActivityContextChange = "activityContextUpdate";
    EntityEventType.ActivityWindowEvent = "activityWindowEvent";
    return EntityEventType;
}());
exports.EntityEventType = EntityEventType;

},{}],18:[function(require,module,exports){
"use strict";
var util = require("../helpers/util");
var ActivityAGM = (function () {
    function ActivityAGM(activity) {
        this._activity = activity;
    }
    ActivityAGM.prototype.register = function (definition, handler) {
        this._ensureHasAgm();
        ActivityAGM.AGM.register(definition, handler);
    };
    ActivityAGM.prototype.servers = function () {
        this._ensureHasAgm();
        if (util.isUndefinedOrNull(this._activity)) {
            return [];
        }
        return this._activity.windows.map(function (w) {
            return w.instance;
        });
    };
    ActivityAGM.prototype.methods = function () {
        this._ensureHasAgm();
        if (util.isUndefinedOrNull(this._activity)) {
            return [];
        }
        var windows = this._activity.windows;
        var methodNames = [];
        var methods = [];
        for (var index = 0; index < windows.length; index++) {
            var window_1 = windows[index];
            var windowMethods = this.methodsForWindow(window_1);
            for (var methodIndex = 0; methodIndex < windowMethods.length; methodIndex++) {
                var currentWindowMethod = windowMethods[methodIndex];
                if (methodNames.indexOf(currentWindowMethod.name) === -1) {
                    methodNames.push(currentWindowMethod.name);
                    methods.push(currentWindowMethod);
                }
            }
        }
        return methods;
    };
    ActivityAGM.prototype.methodsForWindow = function (window) {
        this._ensureHasAgm();
        if (!window.instance) {
            return [];
        }
        return ActivityAGM.AGM.methodsForInstance(window.instance);
    };
    ActivityAGM.prototype.invoke = function (methodName, arg, target, options, success, error) {
        this._ensureHasAgm();
        var activityServers = this.servers();
        var serversToInvokeAgainst = [];
        if (util.isUndefinedOrNull(target)) {
            target = "activity.all";
        }
        if (util.isString(target)) {
            if (target === "activity.all") {
                serversToInvokeAgainst = activityServers;
            }
            else if (target === "activity.best") {
                var potentialTargets = activityServers.filter(function (server) {
                    var methods = ActivityAGM.AGM.methodsForInstance(server);
                    return methods.filter(function (m) {
                        return m.name === methodName;
                    }).length > 0;
                });
                if (potentialTargets.length > 0) {
                    serversToInvokeAgainst = [potentialTargets[0]];
                }
            }
            else if (target === "all" || target === "best") {
                return ActivityAGM.AGM.invoke(methodName, arg, target, options, success, error);
            }
            else {
                throw new Error("Invalid invoke target " + target);
            }
        }
        else if (util.isArray(target)) {
            if (target.length >= 0) {
                var firstElem = target[0];
                if (this._isAgmInstance(firstElem)) {
                    serversToInvokeAgainst = target.map(function (instance) { return instance; });
                }
                else if (this._isActivityWindow(firstElem)) {
                    serversToInvokeAgainst = target.map(function (win) { return win.instance; });
                }
                else {
                    throw new Error("Unknown target object");
                }
            }
        }
        else {
            if (this._isAgmInstance(target)) {
                serversToInvokeAgainst = [target];
            }
            else if (this._isActivityWindow(target)) {
                serversToInvokeAgainst = [target.instance];
            }
            else {
                throw new Error("Unknown target object");
            }
        }
        return ActivityAGM.AGM.invoke(methodName, arg, serversToInvokeAgainst, options, success, error);
    };
    ActivityAGM.prototype.unregister = function (definition) {
        this._ensureHasAgm();
        return ActivityAGM.AGM.unregister(definition);
    };
    ActivityAGM.prototype.createStream = function (methodDefinition, subscriberAddedHandler, subscriberRemovedFunction) {
        this._ensureHasAgm();
        ActivityAGM.AGM.createStream(methodDefinition, subscriberAddedHandler, subscriberRemovedFunction);
    };
    ActivityAGM.prototype.subscribe = function (methodDefinition, parameters, target) {
        this._ensureHasAgm();
        var servers = this.servers();
        return ActivityAGM.AGM.subscribe(methodDefinition, parameters, servers);
    };
    ActivityAGM.prototype._ensureHasAgm = function () {
        if (util.isUndefinedOrNull(ActivityAGM.AGM)) {
            throw new Error("Agm should be configured to be used in activity");
        }
    };
    ActivityAGM.prototype._isAgmInstance = function (obj) {
        return obj.application != undefined;
    };
    ActivityAGM.prototype._isActivityWindow = function (obj) {
        return obj.instance !== undefined;
    };
    return ActivityAGM;
}());
exports.ActivityAGM = ActivityAGM;

},{"../helpers/util":31}],19:[function(require,module,exports){
"use strict";
var entityEvent_1 = require("../contracts/entityEvent");
var activityType_1 = require("../entities/activityType");
var promiseExtensions_1 = require("../helpers/promiseExtensions");
var readyMarker_1 = require("../helpers/readyMarker");
var entityObservableCollection_1 = require("../helpers/entityObservableCollection");
var logger_1 = require("../helpers/logger");
var util = require("../helpers/util");
var localWindowFactory_1 = require("./localWindowFactory");
var ActivityManager = (function () {
    function ActivityManager(bridge, autoAnnounce) {
        var _this = this;
        this._logger = logger_1.Logger.Get(this);
        this._announcedWindows = [];
        this._bridge = bridge;
        this._activityTypes = new entityObservableCollection_1.EntityObservableCollection(function (e) { return _this._grabEntity(e); });
        this._windowTypes = new entityObservableCollection_1.EntityObservableCollection(function (e) { return _this._grabEntity(e); });
        this._activities = new entityObservableCollection_1.EntityObservableCollection(function (e) { return _this._grabEntity(e); });
        this._windows = new entityObservableCollection_1.EntityObservableCollection(function (e) { return _this._grabEntity(e); });
        this._dataReadyMarker = new readyMarker_1.ReadyMarker("Activity Manager Data", ["GetActivityTypes", "GetWindowTypes", "GetActivities", "GetWindows"].length);
        if (autoAnnounce) {
            var announceMaker = new readyMarker_1.ReadyMarker("Activity Manager Announce", ["Announcement"].length);
            this._readyMarker = announceMaker;
            this._dataReadyMarker.setCallback(function (err) {
                if (err) {
                    _this._readyMarker.error(err);
                }
                _this._logger.debug("Auto announcing window");
                _this.announceWindow()
                    .then(function (w) {
                    _this._announcedWindows.push(w);
                    _this._readyMarker.signal("Successfully announced window with id '" + w.id + "'");
                })['catch'](function (err) {
                    _this._logger.debug("Will not announce window - " + err);
                    _this._readyMarker.signal();
                });
            });
        }
        else {
            this._readyMarker = this._dataReadyMarker;
        }
        this._bridge.init();
        this._bridge
            .ready()
            .then(function (aw) {
            _this._subscribeForData();
        })['catch'](function (error) {
            console.log(error);
        });
    }
    Object.defineProperty(ActivityManager.prototype, "announcedWindows", {
        get: function () {
            return this._announcedWindows;
        },
        set: function (v) {
            throw new Error("not allowed");
        },
        enumerable: true,
        configurable: true
    });
    ActivityManager.prototype.ready = function (callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            _this._readyMarker.setCallback(function (err) {
                if (!err) {
                    resolve(_this);
                }
                else {
                    reject(_this._readyMarker.getError());
                }
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.getActivityTypes = function () {
        return this._activityTypes.get();
    };
    ActivityManager.prototype.getActivityType = function (name) {
        return this._activityTypes.getByName(name);
    };
    ActivityManager.prototype.registerActivityType = function (activityTypeName, ownerWindowType, helperWindowTypes, layoutConfig, description, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(activityTypeName)) {
                reject("activityTypeName argument can not be undefined");
            }
            if (!util.isString(activityTypeName)) {
                reject("activityTypeName should be string");
            }
            var actType = _this.getActivityType(activityTypeName);
            if (!util.isUndefinedOrNull(actType)) {
                reject("Activity type '" + activityTypeName + "' already exists");
            }
            var ownerDefinition;
            if (util.isUndefined(ownerWindowType)) {
                reject("Owner window type can not be undefined");
            }
            if (util.isString(ownerWindowType)) {
                ownerDefinition = { type: ownerWindowType, name: "", isIndependent: false, arguments: {} };
            }
            else {
                ownerDefinition = ownerWindowType;
            }
            var helperDefinitions = [];
            if (!util.isUndefined(helperWindowTypes) && util.isArray(helperWindowTypes)) {
                for (var index in helperWindowTypes) {
                    var item = helperWindowTypes[index];
                    if (util.isString(item)) {
                        var definition = {
                            type: item,
                            name: "",
                            isIndependent: false,
                            arguments: {},
                            relativeTo: "",
                            relativeDirection: "",
                            windowStyleAttributes: {}
                        };
                        helperDefinitions.push(definition);
                    }
                    else {
                        helperDefinitions.push(item);
                    }
                }
            }
            _this._bridge
                .registerActivityType(activityTypeName, ownerDefinition, helperDefinitions, layoutConfig, description)
                .then(function (activityType) {
                _this._grabEntity(activityType);
                resolve(activityType);
            })['catch'](function (error) {
                reject(error);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.unregisterActivityType = function (type, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            var actType = _this.getActivityType(type);
            if (util.isUndefined(actType)) {
                reject("Activity type '" + type + "' does not exists");
            }
            return _this._bridge.unregisterActivityType(type);
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.initiate = function (activityType, context, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            var actType = _this.getActivityType(activityType);
            if (util.isUndefined(actType)) {
                reject("Activity type '" + activityType + "' does not exists");
            }
            _this._bridge
                .initiateActivity(activityType, context)
                .then(function (actId) {
                _this._activities
                    .getOrWait(actId)
                    .then(function (act) {
                    resolve(act);
                })['catch'](function (err) { return reject(err); });
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.subscribeActivityTypeEvents = function (handler) {
        this._activityTypes.subscribe(function (at, context) {
            handler(at, context.type);
        });
    };
    ActivityManager.prototype.getWindowTypes = function () {
        return this._windowTypes.get();
    };
    ActivityManager.prototype.getWindowType = function (name) {
        return this._windowTypes.getByName(name);
    };
    ActivityManager.prototype.registerWindowFactory = function (windowType, factoryMethod, description, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(windowType)) {
                reject("no windowType specified");
                return;
            }
            if (util.isObject(windowType)) {
                windowType = windowType.getName();
            }
            else if (!util.isString(windowType)) {
                reject("windowType should be string or object that has getName method");
                return;
            }
            var factory = new localWindowFactory_1.LocalWindowFactory(factoryMethod, description);
            _this._bridge
                .registerWindowFactory(windowType, factory)
                .then(function (v) {
                resolve(v);
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.unregisterWindowFactory = function (windowType, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(windowType)) {
                reject("no windowType specified");
                return;
            }
            if (!util.isString(windowType)) {
                reject("windowType should be a string");
                return;
            }
            _this._bridge
                .unregisterWindowFactory(windowType)
                .then(function (v) {
                resolve(v);
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.getActivities = function (activityType) {
        var act = this._activities.get();
        if (!activityType) {
            return act;
        }
        var types = activityType;
        if (util.isString(activityType)) {
            types = [activityType];
        }
        else if (activityType instanceof activityType_1['default']) {
            types = [activityType.name];
        }
        else if (activityType instanceof Array) {
        }
        else {
            throw new Error("Invalid input argument 'activityType' = " + activityType);
        }
        return act.filter(function (act) {
            var type = act.type;
            return util.some(types, function (t) {
                return type.id == t.id;
            });
        });
    };
    ActivityManager.prototype.getActivityById = function (id) {
        return this._activities.getByName(id);
    };
    ActivityManager.prototype.announceWindow = function (activityWindowId, windowType) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            var announcementInfo = _this._bridge.getAnnouncementInfo();
            if (util.isUndefined(activityWindowId)) {
                activityWindowId = announcementInfo.activityWindowId;
            }
            if (util.isUndefined(windowType)) {
                windowType = announcementInfo.activityWindowType;
            }
            if (util.isUndefinedOrNull(windowType)) {
                throw new Error("Can not announce - unknown windowType");
            }
            if (util.isUndefinedOrNull(activityWindowId)) {
                _this._logger.debug("Registering window with type:'" + windowType + "', name:'" + announcementInfo.activityWindowName + "', ind.:'" + announcementInfo.activityWindowIndependent + "'");
                _this._bridge.registerWindow(windowType, announcementInfo.activityWindowName, announcementInfo.activityWindowIndependent)
                    .then(_this._windows.getOrWait.bind(_this._windows))
                    .then(function (w) {
                    resolve(w);
                })['catch'](function (err) {
                    _this._logger.error(err);
                });
            }
            else {
                _this._logger.debug("Announcing window with id '" + activityWindowId + "' and type '" + windowType + "'");
                var currentWindow = _this._windows.getByName(activityWindowId);
                if (!util.isUndefinedOrNull(currentWindow)) {
                    _this._logger.debug("Window with id '" + activityWindowId + "' already announced - reusing the window");
                    resolve(currentWindow);
                    return;
                }
                var windowEventHandler = function (a, w, e) {
                    if (activityWindowId === w.id) {
                        if (e === "joined") {
                            var activity = w.activity;
                            if (util.isUndefined(activity)) {
                                reject("UNDEFINED ACTIVITY");
                            }
                            _this._logger.trace("Got joined event for id '" + activityWindowId + "'");
                            resolve(w);
                            _this.unsubscribeWindowEvents(windowEventHandler);
                        }
                    }
                };
                _this.subscribeWindowEvents(windowEventHandler);
                _this._logger.trace("Waiting for joined event for id '" + activityWindowId + "'");
                _this._bridge.announceWindow(windowType, activityWindowId);
            }
        });
        return promise;
    };
    ActivityManager.prototype.subscribeWindowTypeEvents = function (handler) {
        this._windowTypes.subscribe(function (wt, context) {
            handler(wt, context.type);
        });
    };
    ActivityManager.prototype.subscribeActivityEvents = function (handler) {
        this._activities.subscribe(function (act, context) {
            if (context.type === entityEvent_1.EntityEventType.StatusChange) {
                var p = context;
                handler(act, p.newStatus, p.oldStatus);
            }
        });
    };
    ActivityManager.prototype.subscribeWindowEvents = function (handler) {
        this._windows.subscribe(function (window, context) {
            if (context.type === entityEvent_1.EntityEventType.ActivityWindowEvent) {
                var p = context;
                handler(window.activity, window, p.event);
            }
        });
    };
    ActivityManager.prototype.unsubscribeWindowEvents = function (handler) {
    };
    ActivityManager.prototype.createWindow = function (activity, windowType, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(activity)) {
                reject("activity is undefined");
            }
            if (util.isUndefinedOrNull(windowType)) {
                reject("windowType is undefined");
            }
            var windowDefinition;
            if (util.isString(windowType)) {
                windowDefinition = { type: windowType, name: "", isIndependent: false, arguments: {} };
            }
            else {
                windowDefinition = windowType;
            }
            var relativeToWindow;
            if (!util.isUndefinedOrNull(windowDefinition.relativeTo)) {
                relativeToWindow = windowDefinition.relativeTo;
                if (util.isString(relativeToWindow)) {
                    var windows = _this.getWindows({ type: relativeToWindow });
                    if (!util.isUndefinedOrNull(windows) && windows.length > 0) {
                        windowDefinition.relativeTo = windows[0].id;
                    }
                }
                else if (!util.isUndefinedOrNull(relativeToWindow.type)) {
                    var windows = _this.getWindows({ type: relativeToWindow.type });
                    if (!util.isUndefinedOrNull(windows) && windows.length > 0) {
                        windowDefinition.relativeTo = windows[0].id;
                    }
                }
                else if (!util.isUndefinedOrNull(relativeToWindow.windowId)) {
                    windowDefinition.relativeTo = relativeToWindow.windowId;
                }
            }
            _this._bridge.createWindow(activity.id, windowDefinition)
                .then(function (wid) {
                _this._logger.debug("Window created, waiting for window entity with id " + wid);
                var handler = function (window, context) {
                    if (window.id === wid && window.activity) {
                        this._logger.debug("Got entity window with id " + wid);
                        resolve(window);
                        this._windows.unsubscribe(handler);
                    }
                }.bind(_this);
                _this._windows.subscribe(handler);
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.joinWindowToActivity = function (activity, window, callback) {
        return undefined;
    };
    ActivityManager.prototype.leaveWindowFromActivity = function (activity, window, callback) {
        return undefined;
    };
    ActivityManager.prototype.setActivityContext = function (activity, context, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(activity)) {
                reject("activity can not be null");
            }
            _this._bridge
                .updateActivityContext(activity, context, true)
                .then(function (obj) {
                resolve(obj);
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.updateActivityContext = function (activity, context, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            if (util.isUndefinedOrNull(activity)) {
                reject("activity can not be null");
            }
            var removedKeys = [];
            for (var key in context) {
                if (context.hasOwnProperty(key) && context[key] === null) {
                    removedKeys.push(key);
                }
            }
            _this._bridge
                .updateActivityContext(activity, context, false, removedKeys)
                .then(function (obj) {
                resolve(obj);
            })['catch'](function (err) {
                reject(err);
            });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.subscribeActivityContextChanged = function (handler) {
        this._activities.subscribe(function (act, context) {
            if (context.type === entityEvent_1.EntityEventType.ActivityContextChange) {
                var updateContext = context;
                handler(act, updateContext.context, updateContext.updated, updateContext.removed);
            }
        });
    };
    ActivityManager.prototype.stopActivity = function (activity, callback) {
        var promise = this._bridge.stopActivity(activity);
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.getWindows = function (filter) {
        if (util.isUndefined(filter)) {
            return this._windows.get();
        }
        if (!util.isUndefined(filter.id)) {
            return [this._windows.getByName(filter.id)];
        }
        var allWindows = this._windows.get();
        return allWindows.filter(function (w) {
            if (!util.isUndefined(filter.type) && w.type.id !== filter.type) {
                return false;
            }
            if (!util.isUndefined(filter.name) && w.name !== filter.name) {
                return false;
            }
            if (!util.isUndefined(filter.activityId)) {
                if (util.isUndefinedOrNull(w.activity)) {
                    return false;
                }
                if (w.activity.id !== filter.activityId) {
                    return false;
                }
            }
            return true;
        });
    };
    ActivityManager.prototype._grabEntity = function (entity) {
        entity.manager = this;
    };
    ActivityManager.prototype._subscribeForData = function () {
        var _this = this;
        this._logger.debug("Start getting initial data...");
        this._bridge.onActivityTypeStatusChange(function (event) {
            _this._activityTypes.process(event);
        });
        this._bridge.getActivityTypes()
            .then(function (at) {
            _this._activityTypes.add(at);
            _this._dataReadyMarker.signal("Got act types");
        })['catch'](function (error) {
            _this._logger.error(error);
            _this._dataReadyMarker.error("Can not initialize ActivityManager - error getting activity types -" + error);
        });
        this._bridge.onWindowTypeStatusChange(function (event) {
            _this._windowTypes.process(event);
        });
        this._bridge.getWindowTypes()
            .then(function (wt) {
            _this._windowTypes.add(wt);
            _this._dataReadyMarker.signal("Got window types");
        })['catch'](function (error) {
            _this._logger.error(error);
            _this._dataReadyMarker.error("Can not initialize ActivityManager - error getting window types  " + error);
        });
        this._bridge.onActivityStatusChange(function (event) {
            _this._activities.process(event);
        });
        this._bridge.getActivities()
            .then(function (ac) {
            _this._activities.add(ac);
            _this._dataReadyMarker.signal("Got activities");
        })['catch'](function (error) {
            _this._logger.error(error);
            _this._dataReadyMarker.error("Can not initialize ActivityManager - error getting activity instances -" + error);
        });
        this._bridge.onActivityWindowChange(function (event) {
            _this._windows.process(event);
        });
        this._bridge.getActivityWindows()
            .then(function (aw) {
            _this._windows.add(aw);
            _this._dataReadyMarker.signal("Got windows");
        })['catch'](function (error) {
            _this._logger.error(error);
            _this._dataReadyMarker.error("Can not initialize ActivityManager - error getting activity windows -" + error);
        });
    };
    ActivityManager.prototype.getWindowBounds = function (id) {
        return this._bridge.getWindowBounds(id);
    };
    ActivityManager.prototype.setWindowBounds = function (id, bounds, callback) {
        var _this = this;
        var promise = new Promise(function (resolve, reject) {
            _this._bridge.setWindowBounds(id, bounds)
                .then(function () { return resolve(); })['catch'](function (err) { return reject(err); });
        });
        return promiseExtensions_1.nodeify(promise, callback);
    };
    ActivityManager.prototype.closeWindow = function (id) {
        return this._bridge.closeWindow(id);
    };
    return ActivityManager;
}());
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= ActivityManager;

},{"../contracts/entityEvent":17,"../entities/activityType":24,"../helpers/entityObservableCollection":27,"../helpers/logger":28,"../helpers/promiseExtensions":29,"../helpers/readyMarker":30,"../helpers/util":31,"./localWindowFactory":20}],20:[function(require,module,exports){
"use strict";
var LocalWindowFactory = (function () {
    function LocalWindowFactory(createFunction, description) {
        this._createFunction = createFunction;
        this._description = description;
    }
    LocalWindowFactory.prototype.create = function (activityWindowId, context, layout) {
        return this._createFunction(activityWindowId, context, layout);
    };
    LocalWindowFactory.prototype.description = function () {
        return this._description;
    };
    return LocalWindowFactory;
}());
exports.LocalWindowFactory = LocalWindowFactory;

},{}],21:[function(require,module,exports){
"use strict";
var ProxyWindowFactory = (function () {
    function ProxyWindowFactory(description) {
        this._description = description;
    }
    ProxyWindowFactory.prototype.create = function (activityWindowId, context) {
        return undefined;
    };
    ProxyWindowFactory.prototype.description = function () {
        return this._description;
    };
    return ProxyWindowFactory;
}());
exports.ProxyWindowFactory = ProxyWindowFactory;

},{}],22:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var activityEntity_1 = require("./activityEntity");
var activityAGM_1 = require("../core/activityAGM");
var Activity = (function (_super) {
    __extends(Activity, _super);
    function Activity(id, actType, status, context, owner, helperWindows) {
        _super.call(this, id);
        this._id = id;
        this._actType = actType;
        this._status = status;
        this._context = context;
        this._owner = owner;
        this._helperWindows = helperWindows;
        this._agm = new activityAGM_1.ActivityAGM(this);
    }
    Object.defineProperty(Activity.prototype, "type", {
        get: function () {
            if (this.manager) {
                return this.manager.getActivityType(this._actType);
            }
            return undefined;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Activity.prototype, "context", {
        get: function () {
            return this._context;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Activity.prototype, "status", {
        get: function () {
            return this._status;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Activity.prototype, "owner", {
        get: function () {
            return this._owner;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Activity.prototype, "windows", {
        get: function () {
            return this.manager.getWindows({ activityId: this._id });
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Activity.prototype, "agm", {
        get: function () {
            return this._agm;
        },
        enumerable: true,
        configurable: true
    });
    Activity.prototype.join = function (window, callback) {
        return this.manager.joinWindowToActivity(this, window, callback);
    };
    Activity.prototype.createWindow = function (windowType, callback) {
        return this.manager.createWindow(this, windowType, callback);
    };
    Activity.prototype.leave = function (window, callback) {
        return this.manager.leaveWindowFromActivity(this, window, callback);
    };
    Activity.prototype.getWindowsByType = function (windowType) {
        var filter = { activityId: this._id, type: windowType };
        return this.manager.getWindows(filter);
    };
    Activity.prototype.setContext = function (context, callback) {
        return this.manager.setActivityContext(this, context, callback);
    };
    Activity.prototype.updateContext = function (context, callback) {
        return this.manager.updateActivityContext(this, context, callback);
    };
    Activity.prototype.onStatusChange = function (handler) {
        var _this = this;
        this.manager.subscribeActivityEvents(function (a, ns, os) {
            if (a.id === _this.id) {
                handler(a, ns, os);
            }
        });
    };
    Activity.prototype.onWindowEvent = function (handler) {
        var _this = this;
        this.manager.subscribeWindowEvents(function (a, w, e) {
            if (a.id === _this.id) {
                handler(a, w, e);
            }
        });
    };
    Activity.prototype.onContextChanged = function (handler) {
        var _this = this;
        this.manager.subscribeActivityContextChanged(function (act, context, delta, removed) {
            if (act.id === _this.id) {
                handler(context, delta, removed, act);
            }
        });
        try {
            handler(this.context, this.context, [], this);
        }
        catch (e) { }
    };
    Activity.prototype.stop = function () {
        this.manager.stopActivity(this);
    };
    Activity.prototype.updateCore = function (activity) {
        _super.prototype.updateCore.call(this, activity);
        this._actType = activity._actType;
        this._context = activity._context;
        this._status = activity._status;
        this._helperWindows = activity._helperWindows;
        this._owner = activity._owner;
    };
    return Activity;
}(activityEntity_1['default']));
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= Activity;

},{"../core/activityAGM":18,"./activityEntity":23}],23:[function(require,module,exports){
"use strict";
var ActivityEntity = (function () {
    function ActivityEntity(id) {
        this.listeners = [];
        this._id = id;
    }
    Object.defineProperty(ActivityEntity.prototype, "id", {
        get: function () {
            return this._id;
        },
        enumerable: true,
        configurable: true
    });
    ActivityEntity.prototype.onUpdated = function (handler) {
        this.listeners.push(handler);
    };
    ActivityEntity.prototype.update = function (other) {
        if (other._id != this._id) {
            throw Error("Can not update from entity with different id.");
        }
        this.updateCore(other);
        this.notify();
    };
    ActivityEntity.prototype.updateCore = function (other) {
    };
    ActivityEntity.prototype.notify = function () {
        for (var index = 0; index < this.listeners.length; index++) {
            var listener = this.listeners[index];
            listener(this);
        }
    };
    return ActivityEntity;
}());
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= ActivityEntity;

},{}],24:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var activityEntity_1 = require("./activityEntity");
var ActivityType = (function (_super) {
    __extends(ActivityType, _super);
    function ActivityType(name, ownerWindow, helperWindows, description) {
        _super.call(this, name);
        this._name = name;
        this._description = description;
        this._ownerWindow = ownerWindow;
        this._helperWindows = helperWindows || [];
    }
    Object.defineProperty(ActivityType.prototype, "name", {
        get: function () {
            return this._name;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityType.prototype, "description", {
        get: function () {
            return this._description;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityType.prototype, "helperWindows", {
        get: function () {
            return this._helperWindows;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityType.prototype, "ownerWindow", {
        get: function () {
            return this._ownerWindow;
        },
        enumerable: true,
        configurable: true
    });
    ActivityType.prototype.subscribeActivityStatusChange = function (handler) {
        return undefined;
    };
    ActivityType.prototype.initiate = function (context, callback) {
        return this.manager.initiate(this._name, context, callback);
    };
    ActivityType.prototype.updateCore = function (type) {
        _super.prototype.updateCore.call(this, type);
        this._description = type._description;
        this._ownerWindow = type._ownerWindow;
        this._helperWindows = type._helperWindows;
    };
    return ActivityType;
}(activityEntity_1['default']));
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= ActivityType;

},{"./activityEntity":23}],25:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var activityEntity_1 = require("./activityEntity");
var logger_1 = require("../helpers/logger");
var util = require("../helpers/util");
var ActivityWindow = (function (_super) {
    __extends(ActivityWindow, _super);
    function ActivityWindow(id, name, type, activityId, instance, isIndependent) {
        _super.call(this, id);
        this._logger = logger_1.Logger.Get(this);
        this._type = type;
        this._activityId = activityId;
        this._name = name;
        this._instance = instance;
        this._isIndependent = isIndependent;
    }
    ActivityWindow.prototype.getBounds = function () {
        return this.manager.getWindowBounds(this.id);
    };
    Object.defineProperty(ActivityWindow.prototype, "name", {
        get: function () {
            return this._name;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityWindow.prototype, "isIndependent", {
        get: function () {
            return this._isIndependent;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityWindow.prototype, "type", {
        get: function () {
            if (this.manager) {
                return this.manager.getWindowType(this._type);
            }
            return undefined;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityWindow.prototype, "activity", {
        get: function () {
            if (util.isUndefined(this._activityId)) {
                return undefined;
            }
            return this.manager.getActivityById(this._activityId);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(ActivityWindow.prototype, "isOwner", {
        get: function () {
            var act = this.activity;
            if (util.isUndefined(act)) {
                return false;
            }
            return act.owner.id === this.id;
        },
        enumerable: true,
        configurable: true
    });
    ActivityWindow.prototype.setVisible = function (isVisible, callback) {
        return undefined;
    };
    ActivityWindow.prototype.setTitle = function (title, callback) {
        return undefined;
    };
    ActivityWindow.prototype.setBounds = function (bounds, callback) {
        return this.manager.setWindowBounds(this.id, bounds, callback);
    };
    ActivityWindow.prototype.setState = function (state, callback) {
        return undefined;
    };
    ActivityWindow.prototype.close = function () {
        return this.manager.closeWindow(this.id);
    };
    Object.defineProperty(ActivityWindow.prototype, "instance", {
        get: function () {
            return this._instance;
        },
        enumerable: true,
        configurable: true
    });
    ActivityWindow.prototype.onActivityJoined = function (callback) {
        this._subscribeForActivityWindowEvent("joined", callback);
    };
    ActivityWindow.prototype.onActivityRemoved = function (callback) {
        this._subscribeForActivityWindowEvent("removed", callback);
    };
    ActivityWindow.prototype.updateCore = function (other) {
        this._activityId = other._activityId;
        this._isIndependent = other._isIndependent;
        if (!util.isUndefinedOrNull(other._instance)) {
            this._instance = other._instance;
        }
    };
    ActivityWindow.prototype._subscribeForActivityWindowEvent = function (eventName, callback) {
        var _this = this;
        this.manager.subscribeWindowEvents(function (activity, window, event) {
            if (window.id !== _this.id) {
                return;
            }
            if (event === eventName) {
                callback(activity);
            }
        });
    };
    return ActivityWindow;
}(activityEntity_1['default']));
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= ActivityWindow;

},{"../helpers/logger":28,"../helpers/util":31,"./activityEntity":23}],26:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var activityEntity_1 = require("./activityEntity");
var WindowType = (function (_super) {
    __extends(WindowType, _super);
    function WindowType(name, factories) {
        _super.call(this, name);
        this._name = name;
        this._factories = factories;
    }
    Object.defineProperty(WindowType.prototype, "name", {
        get: function () {
            return this._name;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(WindowType.prototype, "factories", {
        get: function () {
            return this._factories;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(WindowType.prototype, "windows", {
        get: function () {
            return this.manager.getWindows({ type: this._name });
        },
        enumerable: true,
        configurable: true
    });
    WindowType.prototype.registerFactory = function (factory, factoryMethod, description, callback) {
        return this.manager.registerWindowFactory(this, factoryMethod, description);
    };
    return WindowType;
}(activityEntity_1['default']));
Object.defineProperty(exports, "__esModule", { value: true });
exports['default']= WindowType;

},{"./activityEntity":23}],27:[function(require,module,exports){
"use strict";
var entityEvent_1 = require("../contracts/entityEvent");
var EntityObservableCollection = (function () {
    function EntityObservableCollection(processNew) {
        this._items = {};
        this._listeners = [];
        this._processNew = processNew;
    }
    EntityObservableCollection.prototype.addOne = function (item) {
        this.add([item]);
    };
    EntityObservableCollection.prototype.add = function (items) {
        for (var index = 0; index < items.length; index++) {
            var element = items[index];
            this.process(new entityEvent_1.EntityEvent(element, new entityEvent_1.EntityEventContext(entityEvent_1.EntityEventType.Added)));
        }
    };
    EntityObservableCollection.prototype.process = function (event) {
        var context = event.context;
        var type = context.type;
        var entity = event.entity;
        var internalEntity = this._updateInternalCollections(entity, type);
        this._notifyListeners(internalEntity, context);
    };
    EntityObservableCollection.prototype.get = function () {
        var result = [];
        for (var key in this._items) {
            if (this._items.hasOwnProperty(key)) {
                var element = this._items[key];
                result.push(element);
            }
        }
        return result;
    };
    EntityObservableCollection.prototype.getByName = function (name) {
        for (var key in this._items) {
            if (key === name) {
                return this._items[key];
            }
        }
        return undefined;
    };
    EntityObservableCollection.prototype.getOrWait = function (name) {
        var _this = this;
        return new Promise(function (resolve) {
            var entityAddedHandler = function (entity) {
                if (entity.id !== name) {
                    return;
                }
                resolve(entity);
                _this.unsubscribe(entityAddedHandler);
            };
            _this.subscribe(entityAddedHandler);
            var window = _this.getByName(name);
            if (window) {
                resolve(window);
                return;
            }
        });
    };
    EntityObservableCollection.prototype.subscribe = function (handler) {
        this._listeners.push(handler);
        for (var key in this._items) {
            var element = this._items[key];
            handler(element, new entityEvent_1.EntityEventContext(entityEvent_1.EntityEventType.Added.toString()));
        }
    };
    EntityObservableCollection.prototype.unsubscribe = function (handler) {
        var index = this._listeners.indexOf(handler);
        if (index != -1) {
            this._listeners.splice(index, 1);
        }
    };
    EntityObservableCollection.prototype._notifyListeners = function (entity, context) {
        for (var index = 0; index < this._listeners.length; index++) {
            var listener = this._listeners[index];
            try {
                listener(entity, context);
            }
            catch (e) { }
        }
    };
    EntityObservableCollection.prototype._updateInternalCollections = function (entity, type) {
        if (type === entityEvent_1.EntityEventType.Removed) {
            delete this._items[entity.id];
            return entity;
        }
        else {
            var key = entity.id;
            if (!this._items.hasOwnProperty(key)) {
                this._processNew(entity);
                this._items[entity.id] = entity;
            }
            else {
                this._items[entity.id].update(entity);
            }
        }
        return this._items[entity.id];
    };
    return EntityObservableCollection;
}());
exports.EntityObservableCollection = EntityObservableCollection;

},{"../contracts/entityEvent":17}],28:[function(require,module,exports){
"use strict";
var util = require("./util");
var LogLevel = (function () {
    function LogLevel() {
    }
    LogLevel.Trace = "trace";
    LogLevel.Debug = "debug";
    LogLevel.Info = "info";
    LogLevel.Warn = "warn";
    LogLevel.Error = "error";
    return LogLevel;
}());
exports.LogLevel = LogLevel;
var Logger = (function () {
    function Logger(name) {
        this._name = name;
        if (!util.isUndefinedOrNull(Logger.GlueLogger)) {
            this._glueLogger = Logger.GlueLogger.subLogger(name);
        }
    }
    Logger.GetNamed = function (name) {
        return new Logger(name);
    };
    Logger.Get = function (owner) {
        return new Logger(Logger.GetTypeName(owner));
    };
    Logger.prototype.trace = function (message) {
        if (!util.isUndefinedOrNull(this._glueLogger)) {
            this._glueLogger.trace(message);
        }
        else {
            if (Logger.Level === LogLevel.Trace) {
                console.info(this._getMessage(message, LogLevel.Trace));
            }
        }
    };
    Logger.prototype.debug = function (message) {
        if (!util.isUndefinedOrNull(this._glueLogger)) {
            this._glueLogger.debug(message);
        }
        else {
            if (Logger.Level === LogLevel.Debug ||
                Logger.Level === LogLevel.Trace) {
                console.info(this._getMessage(message, LogLevel.Debug));
            }
        }
    };
    Logger.prototype.info = function (message) {
        if (!util.isUndefinedOrNull(this._glueLogger)) {
            this._glueLogger.info(message);
        }
        else {
            if (Logger.Level === LogLevel.Debug ||
                Logger.Level === LogLevel.Trace ||
                Logger.Level === LogLevel.Info) {
                console.info(this._getMessage(message, LogLevel.Info));
            }
        }
    };
    Logger.prototype.warn = function (message) {
        if (!util.isUndefinedOrNull(this._glueLogger)) {
            this._glueLogger.warn(message);
        }
        else {
            if (Logger.Level === LogLevel.Debug ||
                Logger.Level === LogLevel.Trace ||
                Logger.Level === LogLevel.Info ||
                Logger.Level === LogLevel.Warn) {
                console.info(this._getMessage(message, LogLevel.Info));
            }
        }
    };
    Logger.prototype.error = function (message) {
        if (!util.isUndefinedOrNull(this._glueLogger)) {
            this._glueLogger.error(message);
        }
        else {
            console.error(this._getMessage(message, LogLevel.Error));
            console.trace();
        }
    };
    Logger.prototype._getMessage = function (message, level) {
        return "[" + level + "] " + this._name + " - " + message;
    };
    Logger.GetTypeName = function (object) {
        var funcNameRegex = /function (.{1,})\(/;
        var results = (funcNameRegex).exec(object.constructor.toString());
        return (results && results.length > 1) ? results[1] : "";
    };
    Logger.Level = LogLevel.Info;
    return Logger;
}());
exports.Logger = Logger;

},{"./util":31}],29:[function(require,module,exports){
"use strict";
var util = require("../helpers/util");
var nextTick = function (cb) { setTimeout(cb, 0); };
function nodeify(promise, callback) {
    if (!util.isFunction(callback)) {
        return promise;
    }
    promise.then(function (resp) {
        nextTick(function () {
            callback(null, resp);
        });
    }, function (err) {
        nextTick(function () {
            callback(err, null);
        });
    });
}
exports.nodeify = nodeify;
;

},{"../helpers/util":31}],30:[function(require,module,exports){
"use strict";
var logger_1 = require("./logger");
var util = require("../helpers/util");
var ReadyMarker = (function () {
    function ReadyMarker(name, signalsToWait) {
        this._logger = logger_1.Logger.GetNamed("ReadyMarker [" + name + "]");
        this._logger.debug("Initializing ready marker for '" + name + "' with " + signalsToWait + " signals to wait");
        if (signalsToWait <= 0) {
            throw new Error("Invalid signal number. Should be > 0");
        }
        this._signals = signalsToWait;
        this._callbacks = [];
        this._name = name;
    }
    ReadyMarker.prototype.setCallback = function (callback) {
        if (this.isSet()) {
            callback(undefined);
            return;
        }
        else if (this.isError()) {
            callback(this._error);
            return;
        }
        this._callbacks.push(callback);
    };
    ReadyMarker.prototype.signal = function (message) {
        this._logger.debug("Signaled - " + message + " - signals left " + (this._signals - 1));
        this._signals--;
        if (this._signals < 0) {
            throw new Error("Error in ready marker '" + this._name + " - signals are " + this._signals);
        }
        if (this.isSet()) {
            this._callbacks.forEach(function (callback) {
                callback(undefined);
            });
        }
    };
    ReadyMarker.prototype.error = function (error) {
        this._error = error;
        this._callbacks.forEach(function (errorCallback) {
            errorCallback(error);
        });
    };
    ReadyMarker.prototype.isSet = function () {
        if (this.isError()) {
            return false;
        }
        return this._signals === 0;
    };
    ReadyMarker.prototype.isError = function () {
        return !util.isUndefined(this._error);
    };
    ReadyMarker.prototype.getError = function () {
        return this._error;
    };
    return ReadyMarker;
}());
exports.ReadyMarker = ReadyMarker;

},{"../helpers/util":31,"./logger":28}],31:[function(require,module,exports){
"use strict";
function isNumber(arg) {
    return typeof arg === 'number';
}
exports.isNumber = isNumber;
function isString(arg) {
    return typeof arg === 'string';
}
exports.isString = isString;
function isObject(arg) {
    return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;
function isArray(arg) {
    if (Array.isArray) {
        return Array.isArray(arg);
    }
    return toString.call(arg) === '[object Array]';
}
exports.isArray = isArray;
function isUndefined(arg) {
    return typeof arg === 'undefined';
}
exports.isUndefined = isUndefined;
function isUndefinedOrNull(arg) {
    return !arg || typeof arg === 'undefined';
}
exports.isUndefinedOrNull = isUndefinedOrNull;
function isEmpty(arg) {
    for (var prop in arg) {
        if (arg.hasOwnProperty(prop))
            return false;
    }
    return true;
}
exports.isEmpty = isEmpty;
function isFunction(arg) {
    return !!(arg && arg.constructor && arg.call && arg.apply);
}
exports.isFunction = isFunction;
;
function some(array, predicate) {
    for (var index = 0; index < array.length; index++) {
        if (predicate(array[index], index)) {
            return true;
        }
    }
    return false;
}
exports.some = some;
function first(array, predicate) {
    for (var index = 0; index < array.length; index++) {
        if (predicate(array[index], index)) {
            return array[index];
        }
    }
    return undefined;
}
exports.first = first;

},{}],32:[function(require,module,exports){
(function (global){
var connection = require("tick42-gateway-connection");
var client = require("./agm_client");
var server = require("./agm_server");
var instance = require("./agm_instance");
var native_agm = require("./agm_native");
var deprecate = require('util-deprecate');
var pjson = require("../package.json");
//var add_sugar= require("./agm_sugar");
//Init namespace if not already there

//Add a global function that makes an AGM instance
agm = function (configuration) {
	"use strict";

	//We will store the library here
	var agm = {};

	agm.version = pjson.version;

	//Init debug
	if (typeof configuration !== "object") {
		configuration = {};
	}

	//Init child configuration if it is not already passed by user
	var child_configurations = ["connection", "client", "server"];
	child_configurations.forEach(function (conf) {
		if (typeof configuration[conf] !== "object") {
			configuration[conf] = {};
		}
		//Set debug if global debug is not set:
		if (configuration.debug) {
			configuration[conf].debug = true;
		}
	});

	//Init connection
	var c = configuration.connection;
	//Determine if we are given a connection object. If not, create it ourselves:
	agm.connection = (typeof c === "object" && typeof c.send === "function" && typeof c.on === "function") ? c : connection(configuration.connection);

	//Create a connection proxy which sets the product name automatically
	var product_name = "agm";
	var agm_enabled_connection = {
		send: function (type, message) {
			agm.connection.send(product_name, type, message);
		},
		on: function (type, handler) {
			agm.connection.on(product_name, type, handler);
		}

	};

	//Save a reference to the root system object that we are given
	var metrics_root = configuration.metrics;

	//Create subsystems for our modules and save them in their configuration.
	if (metrics_root !== undefined) {
		configuration.client.metrics = metrics_root.subSystem("Client");
		configuration.server.metrics = metrics_root.subSystem("Server");
	}

	//Initialize our modules
	agm.instance = instance(configuration.instance, agm_enabled_connection);
	agm.client = client(agm_enabled_connection, agm.instance, configuration.client);
	agm.server = server(agm_enabled_connection, agm.instance, configuration.server);

	//Add method aliases
	agm.invoke = agm.client.invoke;
	agm.register = agm.server.register;
	agm.registerAsync = agm.server.registerAsync;
	agm.unregister = agm.server.unregister;
	agm.createStream = agm.server.createStream;
	agm.subscribe = agm.client.subscribe;
	agm.servers = agm.client.servers;
	agm.methods = agm.client.methods;
	agm.methods_for_instance = deprecate(agm.client.methods_for_instance, 'glue.agm.client.methods_for_instance() is deprecated and might be removed from future versions of glue. Use glue.agm.client.methodsForInstance() instead') ;
	agm.methodsForInstance = agm.client.methods_for_instance;
	agm.method = agm.client.method;
	agm.method_added = deprecate(agm.client.method_added, 'glue.agm.method_added() is deprecated and might be removed from future versions of glue. Use glue.agm.methodAdded() instead');
	agm.methodAdded = agm.client.method_added;
	agm.method_removed = deprecate(agm.client.method_removed, 'glue.agm.method_removed() is deprecated and might be removed from future versions of glue. Use glue.agm.methodRemoved() instead');
	agm.methodRemoved = agm.client.method_removed;

	agm.server_method_added = deprecate(agm.client.server_method_added, 'glue.agm.server_method_added() is deprecated and might be removed from future versions of glue. Use glue.agm.serverMethodAdded() instead');
	agm.serverMethodAdded = agm.client.server_method_added;
	agm.server_method_removed = deprecate(agm.client.server_method_removed, 'glue.agm.server_method_removed() is deprecated and might be removed from future versions of glue. Use glue.agm.serverMethodRemoved() instead');
	agm.serverMethodRemoved = agm.client.server_method_removed;

	agm.server_added = deprecate(agm.client.server_added, 'glue.agm.server_added() is deprecated and might be removed from future versions of glue. Use glue.agm.serverAdded() instead');
	agm.serverAdded = agm.client.server_added;
	agm.server_removed = deprecate(agm.client.server_removed, 'glue.agm.server_removed() is deprecated and might be removed from future versions of glue. Use glue.agm.serverRemoved() instead');
	agm.serverRemoved = agm.client.server_removed;

	agm.start = agm.server.start;
	agm.stop = agm.server.stop;

	if (global.console !== undefined && agm.debug === true) {
		console.log("AGM started.");
	}

	return agm;
	//return add_sugar(agm);

};

agm = global.htmlContainer !== undefined ? native_agm : agm;

//Export for browsers
if (global.tick42 === undefined) {
	global.tick42 = {};
}
global.tick42.agm = agm;

module.exports = agm;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../package.json":43,"./agm_client":33,"./agm_instance":39,"./agm_native":40,"./agm_server":41,"tick42-gateway-connection":55,"util-deprecate":78}],33:[function(require,module,exports){
(function (global){
/*
 The AGM Client analyses server presences, collects information about their methods and allows users to invoke these methods.
 */
var client_serverstate = require('./agm_client_serverstate');
var client_invocationsstate = require('./agm_client_invocationsstate');
var client_subscriptionstate = require('./agm_client_subscriptionstate');
var helpers = require('./agm_helpers');
var Promise = require('es6-promise').Promise;

module.exports = function (connection, instance, configuration) {
	//Validate configuration
	if (typeof configuration !== 'object') {
		configuration = {};
		if (global.console !== undefined && configuration.debug === true) {
			console.log('Creating an AGM client with default configuration.');
		}
	}
	if (typeof configuration.remove_server_on_n_missing_heartbeats !== 'number') {
		configuration.remove_server_on_n_missing_heartbeats = 3;
	}
	if (typeof configuration.method_response_timeout !== 'number') {
		configuration.method_response_timeout = 3000;
	}
	if (typeof configuration.wait_for_method_timeout !== 'number') {
		configuration.wait_for_method_timeout = 3000;
	}
	//Instantiate the module which keeps track of all available servers and methods
	var servers = client_serverstate(configuration, instance);
	//..and when you receive a heartbeat/presence from a server, delegate its processing to the module:
	connection.on('ServerPresenceMessage', function (msg) {
		servers.process_presence(msg, true);
	});
	connection.on('ServerHeartbeatMessage', function (msg) {
		servers.process_presence(msg, false);
	});
	//Instantiate the module that handles method execution and responses
	var response = client_invocationsstate(
		configuration,
		instance,
		function (m) {
		connection.send('MethodInvocationRequestMessage', m);
	});
	//..and instantiate the module that handles subscription to Streaming methods
	var subState = client_subscriptionstate(
		configuration,
		instance,
		function (m) {
			connection.send('MethodInvocationRequestMessage', m);
		});
	//..and delegate responses to them.
	connection.on('MethodInvocationResultMessage', function(msg){
		if(msg && msg.EventStreamAction && msg.EventStreamAction !== 0){
			subState.processPublisherMsg(msg);
		} else {
			response.process_method_response(msg);
		}
	});


//   //Adds client callbacks which are executed when a new method is added or stops being available
//   function method_added(callback) {
//     if (typeof callback === 'function') {
//       //Add the callback
//       configuration.on_method_added = callback;
//       //Call the callback for all the method which were added before the callback was registered.
//       servers.get_methods().forEach(function (method) {
//         callback(method);
//       });
//     } else {
//       throw '\'method_added\' must be called with a function as an argument';
//     }
//   }
//   function method_removed(callback) {
//     if (typeof callback === 'function') {
//       //Add the callback
//       configuration.on_method_removed = callback;
//     } else {
//       throw '\'method_removed\' must be called with a function as an argument';
//     }
//   }

//   //Adds client callbacks which are executed when a new method is added or stops being available
//   function server_added(callback) {
//     if (typeof callback === 'function') {
//       //Add the callback
//       configuration.on_server_added = callback;
//       //Call the callback for all the method which were added before the callback was registered.
//       servers.get_servers().forEach(function (server) {
//         callback(server);
//       });
//     } else {
//       throw '\'server_added\' must be called with a function as an argument';
//     }
//   }
//   function server_removed(callback) {
//     if (typeof callback === 'function') {
//       //Add the callback
//       configuration.on_server_removed = callback;
//     } else {
//       throw '\'server_removed\' must be called with a function as an argument';
//     }
//   }

	function subscribe(name, options, successCallback, errorCallback) {
		//options can have arguments:{}, target: 'best'/'all'/{server_instance}, waitTimeoutMs:3000

		function callSubstateSubscribe(targetServers, name, options, successProxy, errorProxy){
			if (global.console !== undefined && configuration.debug === true) {
				console.log('>>> Subscribing to "' + name + '" on ' + targetServers.length + ' servers');
			}

			subState.subscribe(
				{ name: name },
				options.arguments,
				targetServers,
				{ method_response_timeout: options.waitTimeoutMs },
				successProxy,
				errorProxy
			);
		}

		var promise = new Promise(function (resolve, reject) {

			var successProxy = function (args) { resolve(args); };
			var errorProxy   = function (args) { reject(args); };

			if (options === undefined) {
				options = {};
			}
			var target = options.target;
			if (target === undefined) {
				target = 'best';
			}
			if (typeof target === "string" && target !== "all" && target !== "best") {
				reject({message: '"' + target + '" is not a valid target. Valid targets are "all", "best", or an instance.'});
			}
			if (typeof options.waitTimeoutMs !== 'number' || options.waitTimeoutMs !== options.waitTimeoutMs /*NaN*/) {
				options.waitTimeoutMs = configuration.wait_for_method_timeout;
			}

			var currentServers = servers_for_method_and_target(name, target);

			//...including the MethodRequestSubject for the streaming method
			//don't check if the method is streaming or not, subscribing to non-streaming method has to invoke it

			if (currentServers.length === 0) {
				setTimeout( function() {
					var lateServers = servers_for_method_and_target(name, target);
					//TODO: change to use the methodAdded handler
					//TODO: set agm.methodAdded and if(waitTimeout>=0){setTimeout}
					callSubstateSubscribe(lateServers, name, options, successProxy, errorProxy)

				}, options.waitTimeoutMs)

			} else {
				callSubstateSubscribe(currentServers, name, options, successProxy, errorProxy)
			}
		});

		return helpers.promisify(promise, successCallback, errorCallback);
	}

	//Abstract get_method and get_servers functions
	//They rely on  get_method and get_servers from the "servers" module
	//In those ones you don't need to specify all of the method's props to find it.
	function get_method(method_filter) {
		if (typeof method_filter === 'string') {
			method_filter = {name: method_filter};
		}
		//Do not execute for empty filter
		if (method_filter === undefined) {
			return;
		}
		var exact_match = servers.get_method(method_filter);
		//Try calling the original "get_method" function (it will work if all method properties are specified):
		if (exact_match !== undefined) {
			return exact_match  //Take all available methods and iterate them until we find a match
				;
		} else {
			return takeWhile(servers.get_methods(), function (method) {
				return method_match(method_filter, method);
			});
		}
	}

	function get_methods(method_filter) {
		if (method_filter === undefined) {
			return servers.get_methods();
		}
		if (typeof method_filter === 'string') {
			method_filter = {name: method_filter};
		}
		return servers.get_methods().filter(function (method) {
			return method_match(method_filter, method);
		});
	}

	//Retrieves all servers that support any of several methods, listed as an array
	function get_methods_for_instance(instance_filter) {
		var exact_match = servers.get_methods(instance_filter);
		//Try calling the original "get_methods" function (it will work if all instance properties are specified):
		if (exact_match.length !== 0) {
			return exact_match;
		} else {
			var method_ids = get_servers().filter(function (server) {
				return instance_match(instance_filter, server);
			}).reduce(function (methods, server) {
				servers.get_method_ids(server).forEach(function (method_id) {
					methods[method_id] = true;
				});
				return methods;
			}, {});
			return Object.keys(method_ids).map(function (method_id) {
				return servers.get_method(method_id);
			});
		}
	}

	//Retrieves all servers that support a given method
	function get_servers(method_filter) {
		//No method - get all servers
		if (method_filter === undefined) {
			return servers.get_servers();
		}
		//Non-existing method - return an empty array
		var method = get_method(method_filter);
		if (method === undefined) {
			return [];
		}
		//Else, return servers for method
		return servers.get_servers(method);
	}


	//Retrieves all servers that support any of several methods, listed as an array
	function servers_for_methods(methods) {
		return methods.reduce(function (so_far, method) {
			return so_far.concat(servers.get_servers(method, true));//(the second argument is there because we also need the request subject)
		}, []).sort(servers.compare_servers);
	}

	function servers_for_method_and_target(method_filter, target) {
		//Get the methods which match the filter
		var methods = get_methods(method_filter);
		//Determine where to execute the method(s) (the "target" argument)
		//Get all servers that support the method(s) and get the ones that match the target criteria
		return filter_by_target(target, servers_for_methods(methods));
	}


	//Invokes an AGM method (mostly it does input checking), the actual job is done by "request.invoke"
	function invoke(method_filter, argument_obj, target, additional_options, success, error) {
		var promise = new Promise(function (resolve, reject) {
			var successProxy, errorProxy;

			successProxy = function (args) {
				//var parsed = JSON.parse(args);
				resolve(args);
			};
			errorProxy = function (args) {
				//var parsed = JSON.parse(args);
				reject(args);
			};
			//Add default params
			if (argument_obj === undefined) {
				argument_obj = {};
			}
			if (target === undefined) {
				target = 'best';
			}
			if (typeof target === "string" && target !== "all" && target !== "best") {
				reject({message: '"' + target + '" is not a valid target. Valid targets are "all" and "best".'});
			}
			if (additional_options === undefined) {
				additional_options = {};
			}

			if (additional_options.method_response_timeout === undefined) {
				additional_options.method_response_timeout = configuration.method_response_timeout;
			}
			if (additional_options.wait_for_method_timeout === undefined) {
				additional_options.wait_for_method_timeout = configuration.wait_for_method_timeout;
			}


			//Check if the arguments are an object
			if (typeof argument_obj !== 'object') {
				reject({message: 'The method arguments must be an object.'});
			}

			if (typeof method_filter === 'string') {
				method_filter = {name: method_filter};
			}

			var servers = servers_for_method_and_target(method_filter, target);

			if (servers.length === 0) {

				invoke_unexisting(method_filter, argument_obj, target, additional_options, successProxy, errorProxy);

			} else if (servers.length === 1) {
				if (global.console !== undefined && configuration.debug === true) {
					console.log('>>> Invoking "' + method_filter.name + '" on 1 server');
				}

				response.invoke(method_filter, argument_obj, servers[0], additional_options, successProxy, errorProxy);

			} else {
				if (global.console !== undefined && configuration.debug === true) {
					console.log('>>> Invoking "' + method_filter.name + '" on ' + servers.length + ' servers');
				}

				invoke_on_all(method_filter, argument_obj, servers, additional_options, successProxy, errorProxy);
			}
		});

		return helpers.promisify(promise, success, error);
	}


	//Called when the user tries to invoke a method which does not exist
	function invoke_unexisting(method_filter, argument_obj, target, additional_options, success, error) {
		var server_found = false;

		if (additional_options.wait_for_method_timeout === 0) {
			call_error();
		} else {
			setTimeout(function () {
				configuration.server_method_added = configuration.server_method_added.filter(function (callback) {
					return callback !== new_server;
				});
				if (!server_found) {
					call_error();
				}
			}, additional_options.wait_for_method_timeout);

			register_callback("server_method_added", identity, new_server);
		}


		function new_server() {
			if (server_found) {
				return;
			}
			var server = servers_for_method_and_target(method_filter, target)[0];
			if (server !== undefined) {
				server_found = true;
				response.invoke(method_filter, argument_obj, server, additional_options, success, error);
			}
		}


		function call_error() {
			//Check if the method exists and if it doesnt', return an error
			if (get_methods(method_filter).length === 0) {
				error({
					method: method_filter,
					called_with: argument_obj,
					message: 'I could not find a method with those properties: ' + JSON.stringify(method_filter)
				});
			} else {
				error({
					method: method_filter,
					called_with: argument_obj,
					message: 'I could not find servers with these properties: ' + JSON.stringify(target)
				});
				return;
			}
		}

	}


	//Called when the invokes a method with multiple targets
	//Calls a method for all servers and unifies the results they return into one:
	function invoke_on_all(method, argument_obj, servers, additional_options, success, error) {
		//Here we will store the results that the servers return
		var successes = [];
		var errors = [];
		//These are the callbacks
		var success_callback = function (result) {
			successes.push(result);
			send_response(successes, errors);
		};
		var error_callback = function (result) {
			errors.push(result);
			send_response(successes, errors);
		};
		//Call the method for all targets
		servers.forEach(function (server) {
			response.invoke(method, argument_obj, server, additional_options, success_callback, error_callback);
		});


		//Calls the main success and error callbacks with the aggregated results
		function send_response() {
			//wait till everybody is finished
			if (successes.length + errors.length < servers.length) {
				return;
			}
			//Execute the "success" callback
			if (successes.length !== 0) {
				var result = successes.reduce(function (obj, success) {
					obj.method = success.method;
					obj.called_with = success.called_with;
					obj.returned = success.returned;
					obj.all_return_values.push({
						executed_by: success.executed_by,
						returned: success.returned
					});
					obj.executed_by = success.executed_by;
					return obj;
				}, {all_return_values: []});

				//If we get errors from one of the servers add them to the success object that will be resolved.
				if (errors.length !== 0) {
					result.all_errors = [];
					errors.forEach(function (obj) {
						result.all_errors.push({
							//executed_by : obj.executed_by, // we don't get executed_by object from the error response
							name: obj.method.name,
							message: obj.message
						});
					});
				}

				success(result);

			} else if (errors.length !== 0) { //Execute the "error" callback
				error(errors.reduce(function (obj, error) {
					obj.method = error.method;
					obj.called_with = error.called_with;
					obj.message = error.message;
					obj.all_errors.push({
						executed_by: error.executed_by,
						message: error.message
					});
					//obj.executed_by = success.executed_by;
					return obj;
				}, {all_errors: []}));
			}
		}
	}


	var register_callback = helpers.save_callback_in.bind(this, configuration);

	var apply_on_servers = apply_on.bind(null, servers.get_servers);
	var apply_on_methods = apply_on.bind(null, servers.get_methods);
	var identity = function (a) {
		return a;
	};

	return {
		subscribe: subscribe,
		invoke: invoke,
		method: get_method,
		servers: get_servers,
		methods: get_methods,
		methods_for_instance: get_methods_for_instance,
		method_added: register_callback.bind(null, "method_added", apply_on_methods),
		method_removed: register_callback.bind(null, "method_removed", identity),
		server_added: register_callback.bind(null, "server_added", apply_on_servers),
		server_removed: register_callback.bind(null, "server_removed", identity),
		server_method_added: register_callback.bind(null, "server_method_added", identity),
		server_method_removed: register_callback.bind(null, "server_method_removed", identity),
		parse_signature: helpers.signature_parse_friendly
	};
};


//in server_method_added we try to curry the following:
//	configuration, "server_method_added", functionwhichreturnsfirstarg

//Filters an array of servers and returns the ones which match the target criteria
function filter_by_target(target, servers) {
	//If the user specified target as string:
	if (typeof target === 'string') {
		if (target === 'all') {
			target = servers;
		} else if (target === 'best') {
			target = servers[0] !== undefined ? [servers[0]] : [];  //If the user specified the target as server filter
		}
	} else {
		if (!Array.isArray(target)) {
			target = [target];
		}
		var unexisting_servers = [];
		//Retrieve all servers that match the filters
		target = target.reduce(function (matches, filter) {
			//Add matches for each filter
			var my_matches = servers.filter(function (server) {
				return instance_match(filter, server);
			});
			return matches.concat(my_matches);
		}, []);
	}
	return target;
}


//Matches a server definition against a server filter
function instance_match(instance_filter, instance_definition) {
	return contains_props(instance_filter, instance_definition);
}


//Matches a method definition against a method filter
function method_match(method_filter, method_definition) {
	return contains_props(method_filter, method_definition);
}


//Helpers

function contains_props(filter, object) {
	return Object.keys(filter).reduce(function (match, prop) {
		if (filter[prop].constructor === RegExp) {
			if (!filter[prop].test(object[prop])) {
				return false;
			}
			else {
				return match;
			}
		} else {
			if (String(filter[prop]).toLowerCase() !== String(object[prop]).toLowerCase()) {
				return false;
			}
			else {
				return match;
			}
		}
	}, true);
}


function takeWhile(array, pred) {
	var sz = array.length;
	for (var index = 0; index < sz; index++) {
		if (pred(array[index]) === true) {
			break;
		}
	}
	return array[index];
}


function apply_on(objects, func) {
	return objects().map(func);
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_client_invocationsstate":34,"./agm_client_serverstate":36,"./agm_client_subscriptionstate":37,"./agm_helpers":38,"es6-promise":8}],34:[function(require,module,exports){
(function (global){
/*
 The Invcationsstate module handles AGM method invocations. via the 'invoke' method
 It sends and receives all invocation-related messages, via the "process_response" method
 that it exposes and via the "send_request" callback

 */

var helpers = require("./agm_helpers");

module.exports = function (configuration, instance, send_request) {
	"use strict";

	//Here we store all pending callbacks
	var pending_callbacks = {};


	//Invokes an AGM method to a single AGM server, given valid input.
	function invoke(method, argument_obj, target, stuff, success, error) {
		//Generate a unique invocation ID, for this invocation
		var invocation_id = Math.floor(Math.random() * 10000000000);

		//Register the user's callbacks
		register_invocation(invocation_id, {
			method: method,
			called_with: argument_obj
		}, success, error, stuff.method_response_timeout);

		//Get a response subject for this invocation
		instance.response_subject(method, function (response_subject) {

			//Construct a message
			var message = {
				MethodRequestSubject: target.request_subject,
				MethodResponseSubject: response_subject,
				Client: instance.info(),
				Context: {
					ArgumentsJson: argument_obj,
					InvocationId: invocation_id,
					ObjectType: stuff.object_type,
					DisplayContext: stuff.display_context,
					MethodName: method.name,
					ExecutionServer: target,
					Timeout: stuff.method_response_timeout
				}
			};
			//Send it

			send_request(message);
			if (global.console !== undefined && configuration.debug === true) {
				console.debug("%c>>> sending MethodInvocationRequestMessage", "background-color:hsla(198, 51%, 79%, 0.5)");
				console.debug("%c" + JSON.stringify(message), "background-color:hsla(198, 51%, 79%, 0.5)");
			}

		});
	}


	//Adds callbacks for a given invocation ID
	function register_invocation(invocation_id, response, success, error, timeout) {
		//Adds the callbacks
		pending_callbacks[invocation_id] = {response: response, success: success, error: error};
		//Schedules to throw a timeout if nobody answers
		setTimeout(function () {
			if (pending_callbacks[invocation_id] === undefined) {
				return;
			}
			error({
				method: response.method, called_with: response.argument_obj,
				message: "Timeout reached"
			});
			delete pending_callbacks[invocation_id];
		}, timeout);
	}

	function process_method_response(message) {
		//Finds the appropriate callback
		var callback = pending_callbacks[message.InvocationId];
		if (callback !== undefined) {
			if (global.console !== undefined && configuration.debug === true) {
				console.debug("%c<<< receiving MethodInvocationResultMessage", "background-color:hsla(118, 51%, 79%, 0.5)");
				console.debug("%c" + JSON.stringify(message), "background-color:hsla(118, 51%, 79%, 0.5)");
			}
			//If the server returned success, execute the success callback
			if (message.Status === 0 && typeof callback.success === "function") {
				//parse the result
				var result = message.ResultContextJson;
				//If the result is an empty object, there is no result
				if (result && Object.keys(result).length === 0) {
					result = undefined;
				}

				//Log that we received a result
				if (global.console !== undefined && configuration.debug === true) {
					console.log('<<<  "' + callback.response.method.name + '" was executed by ' + JSON.stringify(helpers.preprocess_server(message.Server)));
				}
				//Execute the success callback
				callback.success({
					method: callback.response.method,
					called_with: callback.response.called_with,
					executed_by: helpers.preprocess_server(message.Server),
					returned: result,
					message: message.ResultMessage,
					log_details: message.ResultLogDetails
				});
				//Else, return an error
			} else if (typeof callback.error === "function") {
				if (global.console !== undefined && configuration.debug === true) {
					console.log('<<<  "' + callback.response.method.name + '" was executed with error by ' + JSON.stringify(helpers.preprocess_server(message.Server)));
				}
				callback.error({
					method: callback.response.method,
					called_with: callback.response.called_with,
					message: message.ResultMessage,
					log_details: message.ResultLogDetails,
					status: message.status
				});
			}
			//Finally, remove the callbacks
			delete pending_callbacks[message.InvocationId];
		}
	}

	return {process_method_response: process_method_response, invoke: invoke};
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_helpers":38}],35:[function(require,module,exports){
(function (global){
/*
 The Methodstate module, keeps the state of available AGM methods in the network.
 */

var helpers = require("./agm_helpers");

module.exports = function (configuration) {
	//A list of all available AGM methods
	var methods = {};

	//Save the reference to the metric function if it exists
	var objectMetric = (configuration.metrics !== undefined) ? configuration.metrics.numberMetric.bind(configuration.metrics) : function () {
	};

	//Adds a new server to a method. Creates the method if it is not created previously.
	function add_server_to_method(method_info, server_id, server_info) {
		//Get the method ID
		var method_id = get_method_id(method_info);


		//One method can have several request subjects per server.
		//So the request subject is actually not a property of the method
		var request_subject = method_info.request_subject;
		delete  method_info.request_subject;


		//Copy the method and server objects to a format suitable for sending to users
		var method_info_friendly = helpers.clone_object(method_info);
		var server_info_friendly = helpers.clone_object(server_info);


		var method = methods[method_id];

		//If the method does not exist, create it
		if (method === undefined) {
			//Save the info
			method = methods[method_id] = {info: method_info, servers: {}};
			//Add request_subject
			method = add_request_subject(method, server_id, request_subject);

			//Execute user callbacks
			helpers.execute_all_with(configuration.method_added, method_info_friendly);
			//Log and publish metrics
			if (global.console !== undefined && console.table !== undefined && configuration.debug === true) {
				console.log(">>>>>> New method detected: " + JSON.stringify(method_info_friendly));
				console.table(get_methods());
			}
			objectMetric("Methods total count", Object.keys(methods).length);
		} else {
			//Else, just add the request subject
			method = add_request_subject(method, server_id, request_subject);
		}
		//Execute user callbacks
		helpers.execute_all_with(configuration.server_method_added, {
			method: method_info_friendly,
			server: server_info_friendly
		});
	}

	//Adds request subject for server and method
	function add_request_subject(method, server_id, request_subject) {
		method.servers[server_id] = request_subject;
		return method;
	}


	//Removes a server from a method. Deletes the method if there are no more servers left.
	function remove_server_from_method(method_id, server_id, server_info) {
		//Obtain info about the method before removing it.
		var method_info_friendly = get_method(method_id);
		var server_info_friendly = helpers.clone_object(server_info);


		//Remove the server from the list
		var servers = methods[method_id].servers;
		delete servers[server_id];
		//Remove the method if there aren't any servers left
		if (Object.keys(servers).length === 0) {
			var callback = configuration.on_method_removed;
			helpers.execute_all_with(configuration.method_removed, method_info_friendly);
			//remove method
			delete methods[method_id];
			//Log and metrics
			if (global.console !== undefined && console.table !== undefined && configuration.debug === true) {
				console.log("<<<<<< Method stopped being available: " + JSON.stringify(method_info_friendly));
				console.table(get_methods());
			}
			objectMetric("Methods total count", Object.keys(methods).length);
		}
		//Execute user callbacks
		helpers.execute_all_with(configuration.server_method_removed, {
			method: method_info_friendly,
			server: server_info_friendly
		});

	}

	//Generates a unique if for a method
	function get_method_id(m) {
		//Setting properies to defaults:
		var accepts = m.accepts !== undefined ? m.accepts : "";
		var returns = m.returns !== undefined ? m.returns : "";
		var version = m.version !== undefined ? m.version : 0;
		return (m.name + accepts + returns + version).toLowerCase();
	}


	//Retrieve all methods
	function get_methods() {
		return Object.keys(methods).map(function (method) {
			return helpers.clone_object(methods[method].info);
		});
	}

	//Retrieve an array of the ID's of the servers for a method
	function get_servers_for_method(method_info) {
		var method = methods[get_method_id(method_info)];
		if (method !== undefined) {
			return method.servers;
		}
		else {
			return {};
		}
	}

	//Retrieves a copy of the method, by its ID
	function get_method(method_id) {
		if (typeof method_id === "object") {
			method_id = get_method_id(method_id);
		}
		if (methods[method_id] !== undefined)
		//We clone the method definition so it can be mutated without affecting the original
			return helpers.clone_object(methods[method_id].info);
	}


	return {
		get_methods: get_methods,
		get_method: get_method,
		get_method_id: get_method_id,
		add_server_to_method: add_server_to_method,
		remove_server_from_method: remove_server_from_method,
		get_servers_for_method: get_servers_for_method
	};

};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_helpers":38}],36:[function(require,module,exports){
(function (global){
/*
 The Serverstate module processes server presences and keeps the state of available AGM servers in the network.
 */
var helpers = require("./agm_helpers");

var get_server_id = helpers.get_server_id;

var client_methodstate = require("./agm_client_methodstate");

module.exports = function (configuration, instance) {
	"use strict";

	//A list of all the servers in the network
	var servers = {};

	//Instantiates the "methodstate" module
	var methods = client_methodstate(configuration);


	//Processes a presence message from a server
	function process_presence(presence, is_presence) {
		//console.log(presence.Instance)
		//Get server info.
		var serverinfo = helpers.preprocess_server(presence.Instance);

		if (is_presence) {
			// Ignore messages for dead servers
			// If it is a new server, register it.
			if (!exists(serverinfo)) {
				add_server(serverinfo);
			}

			if (presence.PublishingInterval) {
				set_timeout(serverinfo, presence.PublishingInterval);
			}
		}

		//Finally, update the methods
		if (presence.MethodDefinitions !== undefined) {
			update_methods(serverinfo, presence.MethodDefinitions);
		}

	}

	//This function sets a timeout which removes the server unless
	//the function is called again before the timeout is over
	function set_timeout(serverinfo, duration) {

		if (duration === -1) return;
		//Retrieve the server
		var server_id = get_server_id(serverinfo);
		var server = servers[server_id];
		//Stop the previous timeout
		if (server.bomb !== undefined) {
			clearTimeout(server.bomb);
		}
		//Set a new one
		server.bomb = setTimeout(function () {
			remove_server(serverinfo);
		}, duration * configuration.remove_server_on_n_missing_heartbeats + 1);

	}

	//Checks if a servers exists
	function exists(serverinfo) {
		var server_id = get_server_id(serverinfo);
		return servers[server_id] !== undefined;
	}

	//Register a server
	function add_server(serverinfo) {
		//Obtain a server ID and store the new server
		var server_id = get_server_id(serverinfo);
		servers[server_id] = {info: serverinfo, methods: [], bomb: undefined};

		//Log in console
		if (global.console !== undefined && console.table !== undefined && configuration.debug === true) {
			console.log(">>>>>> New server detected: " + JSON.stringify(serverinfo));
			console.table(get_servers());
		}

		//Execute user callbacks
		helpers.execute_all_with(configuration.server_added, serverinfo);

		return server_id;
	}

	//Unregisters a server
	function remove_server(serverinfo) {
		//Obtain a server ID
		var server_id = get_server_id(serverinfo);
		//Remove the server's methods
		servers[server_id].methods.forEach(function (method_id) {
			methods.remove_server_from_method(method_id, server_id, serverinfo);
		});
		//Remove the server itself
		delete servers[server_id];
		//Log in console
		if (global.console !== undefined && console.table !== undefined && configuration.debug === true) {
			console.log("<<<<<< Server stopped being available:" + JSON.stringify(serverinfo));
			console.table(get_servers());
		}

		//Execute user callbacks
		helpers.execute_all_with(configuration.server_removed, serverinfo);
	}

	//Updates the methods of a server
	function update_methods(serverinfo, new_methods) {
		var server_id = get_server_id(serverinfo);
		//Get an array of the methods the server had before we started this
		var old_methods_ids = servers[server_id].methods;
		//Get an array of the methods that the server has now
		new_methods = new_methods.map(helpers.preprocess_method).reduce(function (obj, method) {
			obj[methods.get_method_id(method)] = method;
			return obj;
		}, {});
		//For each of the old methods
		old_methods_ids.forEach(function (method_id) {
			//Check if it is still there
			if (new_methods[method_id] === undefined) {
				//If it isn't, remove it
				methods.remove_server_from_method(method_id, server_id, serverinfo);
			} else {
				//If it is there in both the old array and the new one, we don't need to add it again
				new_methods[method_id] = undefined;
			}
		});
		//Now add the new methods
		var new_methods_ids = Object.keys(new_methods);
		new_methods_ids.forEach(function (id) {
			if (new_methods[id] !== undefined) {
				methods.add_server_to_method(new_methods[id], server_id, serverinfo);
			}
		});
		//Now all we have to do is replace the list of methods the server has
		servers[server_id].methods = new_methods_ids;

	}

	//Get all servers for a given method
	function get_servers(method, include_request_subject) {
		var server_ids;
		//If there isn't a method get the ID's of all servers
		if (method === undefined) {
			server_ids = Object.keys(servers);
			//Else, get a list of the servers that have the method
		} else {
			var ids_to_request_subjects = methods.get_servers_for_method(method);
			server_ids = Object.keys(ids_to_request_subjects);
		}
		//Format the list
		return server_ids.map(function (server_id) {
			var server = helpers.clone_object(servers[server_id].info);
			//Include the request subject for each server for each method:
			if (include_request_subject) {
				server.request_subject = ids_to_request_subjects[server_id];
			}
			return server;
		}).sort(compare_servers);
	}

	//A comparer function. Sorts the servers based on availability
	function compare_servers(server1, server2) {
		var s1 = 0;
		var s2 = 0;
		//+2 if the server is on the same machine
		if (server1.machine === instance.machine) {
			s1 = s1 + 2;
		}
		if (server2.machine === instance.machine) {
			s2 = s2 + 2;
		}
		//+1 if it runs under the same user
		if (server1.user === instance.user) {
			s1 = s1 + 1;
		}
		if (server2.user === instance.user) {
			s2 = s2 + 1;
		}
		return s2 - s1;
	}

	function get_method_ids(server) {
		return servers[get_server_id(server)].methods;
	}


	//Get all methods for a given server
	function get_methods(server) {
		//If there is no server specified, return all
		if (server === undefined) {
			return methods.get_methods();
			//Else, get the methods from the server object
		} else if (exists(server)) {
			return get_method_ids(server).map(function (method_id) {
				return methods.get_method(method_id);
			});
			//If the server is specified, but it does not exist, return an empty array
		} else {
			return [];
		}
	}

	return {
		process_presence: process_presence,
		get_methods: get_methods,
		get_method_ids: get_method_ids,
		get_servers: get_servers,
		get_method: methods.get_method,
		exists: exists,
		compare_servers: compare_servers
	};
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_client_methodstate":35,"./agm_helpers":38}],37:[function(require,module,exports){
(function (global){
/*
 The Subscription-state module handles AGM stream subscriptions via the 'subscribe' method
 It sends and receives all invocation-related messages, via the "process_response" method
 that it exposes and via the "SendRequest" callback

 */

var helpers = require("./agm_helpers");

module.exports = function (configuration, instance, SendRequest) {
	"use strict";

	var STATUS_AWAITING_ACCEPT = 'awaitingAccept'; // not even one server has accepted yet
	var STATUS_SUBSCRIBED = 'subscribed'; // at least one server has responded as 'Accepting'
	var ERR_MSG_SUB_FAILED = 'Subscription failed.';
	var ERR_MSG_SUB_REJECTED = 'Subscription rejected.';
	var ON_CLOSE_MSG_SERVER_INIT = 'ServerInitiated';
	var ON_CLOSE_MSG_CLIENT_INIT = 'ClientInitiated';

	var subscriptionsList = {};

	//Preps and sends a request to subscribe to a single AGM stream publisher.
	function subscribe(streamingMethod, argument_obj, targetServers, stuff, success, error) {

		if(targetServers.length === 0){
			error(ERR_MSG_SUB_FAILED);
			return;
		}

		//This same Id will be passed to all the servers (as 'InvocationId')
		// so they can respond back with it during the initial handshake
		var subscriptionId = 'subscriptionId_' + helpers.generateRandom();

		//Register the user's callbacks
		var pendingSub = registerSubscription(
			subscriptionId,
			{
				method: streamingMethod,
				called_with: argument_obj
			},
			success,
			error,
			stuff.method_response_timeout
		);

		if(typeof pendingSub !== 'object'){
			error(ERR_MSG_SUB_FAILED);
			return;
		}

		//Send a subscription request to each server
		targetServers.forEach(function(target){

			//Get a response subject for this invocation
			instance.response_subject(streamingMethod, function (responseSubject) {

				//Add server to the list of ones the client is expecting a response from
				pendingSub.trackedServers.push({
					server: undefined,
					streamId: undefined,
					streamSubjects: {
						global: undefined,
						private: undefined
					},
					methodRequestSubject: target.request_subject,
					methodResponseSubject: responseSubject
				});

				//Construct a message
				var message = {
					EventStreamAction: 1, //"Subscribe" = client wishes to subscribe
					MethodRequestSubject: target.request_subject,
					MethodResponseSubject: responseSubject,
					Client: instance.info(),
					Context: {
						ArgumentsJson: argument_obj,
						InvocationId: subscriptionId,
						ObjectType: stuff.object_type,
						DisplayContext: stuff.display_context,
						MethodName: streamingMethod.name,
						ExecutionServer: target,
						Timeout: stuff.method_response_timeout
					}
				};

				//Send it
				SendRequest(message);

				if (global.console !== undefined && configuration.debug === true) {
					console.debug("%c>>> sending MethodInvocationRequestMessage", "background-color:hsla(198, 51%, 79%, 0.5)");
					console.debug("%c" + JSON.stringify(message), "background-color:hsla(198, 51%, 79%, 0.5)");
				}
			});

		});

	}


	function registerSubscription(subscriptionId, response, success, error, timeout){

		subscriptionsList[subscriptionId] = {
			status:STATUS_AWAITING_ACCEPT,
			response: response,
			success: success,
			error: error,
			trackedServers: [],
			handlers: {
				onData: [],
				onClosed: []
				//onFailed: []
			},
			queued: {
				data: [],
				closers: []
			},
			timeoutId: undefined
		};


		subscriptionsList[subscriptionId].timeoutId = setTimeout(function () {
			if (subscriptionsList[subscriptionId] === undefined) {
				return; //no such subscription
			}

			var subscription = subscriptionsList[subscriptionId]


			if (subscription.status === STATUS_AWAITING_ACCEPT) {
				error({
					method: response.method, called_with: response.called_with,
					message: ERR_MSG_SUB_FAILED
				});

				//None of the target servers has answered the subscription attempt
				delete subscriptionsList[subscriptionId];

			} else if (
				subscription.status === STATUS_SUBSCRIBED
				&& subscription.trackedServers.length > 0
			){
				//clean the trackedServers
				subscription.trackedServers = subscription.trackedServers.filter(function(server){
					return (typeof server.streamId === 'string' && server.streamId !== 'string')
				});

				subscription.timeoutId = undefined;

				if(subscription.trackedServers.length === 0){
					//There are no open streams, some servers accepted then closed very quickly
					//	(that's why the status changed but there's no good server with a StreamId)

					//call the onClosed handlers
					var closersCount = subscription.queued.closers.length;
					var closingServer = (closersCount > 0) ? subscription.queued.closers[closersCount - 1] : null;

					subscription.handlers.onClosed.forEach(function(callback){
						if(typeof callback === 'function'){
							callback({
								message: ON_CLOSE_MSG_SERVER_INIT,
								requestArguments: subscription.response.called_with,
								server: closingServer,
								stream: subscription.response.method
							})
						}
					});

					delete subscriptionsList[subscriptionId];
				}
			}
		}, timeout);

		return subscriptionsList[subscriptionId]
	}

	function processPublisherMsg(msg){
		if( ! (msg && msg.EventStreamAction && msg.EventStreamAction !== 0) ){
			return;
		}

		if(msg.EventStreamAction === 2) {

			serverIsKickingASubscriber(msg);

		} else if(msg.EventStreamAction === 3) {

			serverAcknowledgesGoodSubscription(msg);

		} else if(msg.EventStreamAction === 5) {

			serverHasPushedSomeDataIntoTheStream(msg);
		}

	}

	/** msg 'Response' Actions */
	//action 2
	function serverIsKickingASubscriber(msg){

		//Note: this might be either the server rejecting a subscription request OR closing an existing subscription

		//Get ALL subscriptions
		var keys = Object.keys(subscriptionsList);

		//If it is a rejection there may be an InvocationId, it can narrow the search
		if(typeof msg.InvocationId === 'string' && msg.InvocationId !== ''){
			keys = keys.filter(function(k){
				return k === msg.InvocationId;
			})
		}

		var deletionsList = [];

		//Find the kicking/rejecting server and remove it from the subscription.trackedServers[]
		keys.forEach(function(key){
			if(typeof subscriptionsList[key] !== 'object'){
				return;
			}

			subscriptionsList[key].trackedServers = subscriptionsList[key].trackedServers.filter(function(server){
				var isRejecting = (
					server.methodRequestSubject === msg.MethodRequestSubject
					&& server.methodResponseSubject === msg.MethodResponseSubject
				);

				var isKicking = (
					server.streamId === msg.StreamId
					&& (
						server.streamSubjects.global === msg.EventStreamSubject
						|| server.streamSubjects.private === msg.EventStreamSubject
					)
				);

				var isRejectingOrKicking = isRejecting || isKicking;

				return ! isRejectingOrKicking;
			});

			if(subscriptionsList[key].trackedServers.length === 0){
				deletionsList.push(key);
			}
		});

		//Call onClosed OR error()
		// and remove the subscription
		deletionsList.forEach(function(key){
			if(typeof subscriptionsList[key] !== 'object'){
				return;
			}

			if (
				subscriptionsList[key].status === STATUS_AWAITING_ACCEPT
				&& typeof subscriptionsList[key].timeoutId === 'number'
			){

				subscriptionsList[key].error(ERR_MSG_SUB_REJECTED);
				clearTimeout(subscriptionsList[key].timeoutId);

			} else {

				//The timeout may or may not have expired yet,
				// but the status is 'subscribed' and trackedServers is now empty

				subscriptionsList[key].handlers.onClosed.forEach(function(callback){
					if(typeof callback === 'function'){
						callback({
							message: ON_CLOSE_MSG_SERVER_INIT,
							requestArguments: subscriptionsList[key].response.called_with,
							server: msg.Server,
							stream: subscriptionsList[key].response.method
						});
					}
				});

			}

			delete subscriptionsList[key];

		});
	}

	//action 3
	function serverAcknowledgesGoodSubscription(msg){

		var subscriptionId = msg.InvocationId;

		var subscription = subscriptionsList[subscriptionId];

		if(typeof subscription !== 'object'){
			return;
		}

		var acceptingServer = subscription.trackedServers.filter( function(server) {
			return (
				server.methodRequestSubject === msg.MethodRequestSubject
				&& server.methodResponseSubject === msg.MethodResponseSubject
			)
		})[0];

		if(typeof acceptingServer !== 'object'){
			return;
		}

		var isFirstResponse = ( subscription.status === STATUS_AWAITING_ACCEPT );

		subscription.status = STATUS_SUBSCRIBED;

		var privateStreamSubject = generatePrivateStreamSubject(subscription.response.method.name);

		if(typeof acceptingServer.streamId === 'string' && acceptingServer.streamId !== ''){
			return; //already accepted previously
		}

		acceptingServer.server = msg.Server;
		acceptingServer.streamId = msg.StreamId;
		acceptingServer.streamSubjects.global = msg.EventStreamSubject;
		acceptingServer.streamSubjects.private = privateStreamSubject;
		//acceptingServer.methodResponseSubject stays the same

		var confirmatoryRequest = {
			EventStreamAction: 3, //"Subscribed" = client confirms intention to subscribe
			EventStreamSubject: privateStreamSubject,
			StreamId: msg.StreamId,
			MethodRequestSubject: msg.MethodRequestSubject,
			MethodResponseSubject: acceptingServer.methodResponseSubject,
			Client: instance.info(),
			Context:{
				ArgumentsJson: subscription.response.called_with,
				MethodName: subscription.response.method.name
			}
		};

		SendRequest(confirmatoryRequest);

		if(isFirstResponse){
			//Pass in the subscription object
			subscription.success({
				onData: function(dataCallback){
					if(typeof dataCallback !== "function"){
						throw new TypeError('The data callback must be a function.')
					}

					this.handlers.onData.push(dataCallback)
					if(this.handlers.onData.length === 1 && this.queued.data.length > 0){
						this.queued.data.forEach(function(dataItem){
							dataCallback(dataItem)
						})
					}
				}.bind(subscription),
				onClosed: function(closedCallback){
					if(typeof closedCallback !== "function"){
						throw new TypeError('The callback must be a function.')
					}
					this.handlers.onClosed.push(closedCallback)
				}.bind(subscription),
				onFailed:function(failedCallback){},
				close: closeSubscription.bind(subscription, subscriptionId),
				requestArguments: subscription.response,
				serverInstance: msg.Server,
				stream: subscription.response.method
			});
		}
	}

	//action 5
	function serverHasPushedSomeDataIntoTheStream(msg){

		//Find the subscription of interest by trawling the dictionary
		for(var key in subscriptionsList){
			if(subscriptionsList.hasOwnProperty( key ) && typeof subscriptionsList[key] === 'object'){

				var isPrivateData = undefined;

				var trackedServersFound = subscriptionsList[key].trackedServers.filter(function(ls){
					return (
						ls.streamId === msg.StreamId
						&& ( ls.streamSubjects.global === msg.EventStreamSubject
								 || ls.streamSubjects.private === msg.EventStreamSubject )
					);
				});

				if(trackedServersFound.length === 0){
					isPrivateData = undefined
				} else if(trackedServersFound[0].streamSubjects.global === msg.EventStreamSubject) {
					isPrivateData = false
				} else if (trackedServersFound[0].streamSubjects.private === msg.EventStreamSubject) {
					isPrivateData = true
				}

				if(isPrivateData !== undefined){
					//create the arrivedData object
					var receivedStreamData = {
						data: msg.ResultContextJson,
						server:msg.Server,
						requestArguments: subscriptionsList[key].response.called_with ||  {},
						message: msg.ResultMessage,
						private: isPrivateData
					};

					var onDataHandlers = subscriptionsList[key].handlers.onData;
					var queuedData = subscriptionsList[key].queued.data;

					if( Array.isArray(onDataHandlers) ){
						if(onDataHandlers.length > 0){
							onDataHandlers.forEach(function(callback){
								if(typeof callback === "function"){
									callback(receivedStreamData)
								}
							})
						} else {
							queuedData.push(receivedStreamData)
						}
					}
				}
			}
		}//end for-in
	}

	/** (subscription) Methods */
	function closeSubscription(subId){

		instance.response_subject({}, function (responseSubject) {
			this.trackedServers.forEach(function(server){
				SendRequest({
					EventStreamAction: 2,
					Client: instance.info(),
					MethodRequestSubject: server.methodRequestSubject,
					MethodResponseSubject: responseSubject,
					StreamId: server.streamId,
					EventStreamSubject: server.streamSubjects.private
				});
			});
		}.bind(this));

		var sub = this;

		//Call the onClosed handlers
		this.handlers.onClosed.forEach(function(callback){
			if(typeof callback === 'function'){
				callback({
					message: ON_CLOSE_MSG_CLIENT_INIT,
					requestArguments: sub.response.called_with || {},
					server: sub.trackedServers[sub.trackedServers.length - 1].server,
					stream: sub.response.method
				})
			}
		});

		delete subscriptionsList[subId];
	}

	function generatePrivateStreamSubject(methodName){

		var appInfo = instance.info();

		var privateStreamSubject = 'ESSpriv-jsb_'
			+ appInfo.ApplicationName
			+ '_on_' + methodName + '_'
			+ helpers.generateRandom();

		return privateStreamSubject;
	}

	return { //an instance of the subState
		subscribe: subscribe,
		processPublisherMsg: processPublisherMsg
	};
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_helpers":38}],38:[function(require,module,exports){
(function (global){
//Converts server properties from camel to snake case
function preprocess_server(m) {
	return {
		machine: m.MachineName,
		pid: m.ProcessId,
		started: m.ProcessStartTime,
		user: m.UserName,
		application: m.ApplicationName,
		environment: m.Environment,
		region: m.Region,
		service_name: m.ServiceName,
		metrics_repository_id: m.MetricsRepositoryId,
		state: m.State
	};
}

function clone_object(method) {
	var new_method = {};
	for (var i in method) {
		//Remove undefined values from object before passing it to the user
		if (method[i] !== undefined && method[i] !== "" && method[i] !== 0) {
			new_method[i] = method[i];
		}
	}
	return new_method;
}

//Helper: preprocesses the method definition
function preprocess_method(method_info) {
	var method = method_info.Method;
	return {
		name: method.Name,
		accepts: method.InputSignature,
		returns: method.ResultSignature,
		request_subject: method_info.MethodRequestSubject,
		description: method.Description,
		display_name: method.DisplayName,
		version: method.Version,
		object_types: method.ObjectTypeRestrictions
	};
}


function save_callback_in(callback_obj, event, on_callback_add, callback) {
	if (typeof callback === 'function') {
		callback_obj[event] = callback_obj[event] || [];
		callback_obj[event].push(callback);
		on_callback_add(callback);
	} else {
		throw '"' + event + '" must be called with a function as an argument';
	}
}

function execute_all_with(callbacks, input) {
	if (typeof callbacks === "object") {
		callbacks.forEach(function (callback) {
			callback(input);
		});
	}
}

//Generates a unique ID for a server
function get_server_id(serverinfo) {
	if (serverinfo === undefined) {
		return undefined;
	}
	//The matching is case-insensitive
	return (serverinfo.application + serverinfo.user + serverinfo.started + serverinfo.pid).toLowerCase();
}

function promisify(promise, successCallback, errorCallback) {
	if (typeof successCallback !== 'function' && typeof errorCallback !== 'function') {
		return promise;
	}

	if (typeof successCallback !== 'function') {
		successCallback = function (args) {
			if (global.console !== undefined && agm.debug === true) {
				console.log("Success!");
			}
		};
	} else if (typeof errorCallback !== 'function') {
		errorCallback = function (args) {
			if (global.console !== undefined && agm.debug === true) {
				console.log("An error occurred.");
			}
		};
	}

	promise.then(successCallback, errorCallback);
}

function generateRandom(){
	return Math.floor(Math.random() * 10000000000);
}

function isJustPlainUserObject(input){

	if(typeof input !== 'object' || input === null){
		return false;
	}

	if(Object.prototype.toString.call(input) !== '[object Object]'){
		return false;
	}

	var proto;

	if ( typeof Object.getPrototypeOf !== 'function' ) {
		if ( typeof 'test'.__proto__ === 'object' ) {
			proto = input.__proto__;
		} else {
			if(input.constructor === undefined){
				return false;
			}
			// May fail if the constructor was mutated
			proto = input.constructor.prototype;
		}
	} else {
		proto = Object.getPrototypeOf(input);
	}

	if(proto === null || proto === undefined) {
		return true;
	}

	var consTor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;

	return (
		typeof consTor == 'function'
		&& consTor instanceof consTor //checks if at the end of the prototype chain
		&& funcToString.call(consTor) === funcToString.call(Object) //checks if the Object constructor is there
	);
}

module.exports = {
	get_server_id: get_server_id,
	execute_all_with: execute_all_with,
	save_callback_in: save_callback_in,
	preprocess_server: preprocess_server,
	preprocess_method: preprocess_method,
	clone_object: clone_object,
	promisify: promisify,
	generateRandom: generateRandom,
	isJustPlainUserObject: isJustPlainUserObject
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],39:[function(require,module,exports){
(function (global){
/*
 The AGM instance collects information about the machine we are in, 
 and interacts with the .NET gateway in other ways, 
 to deliver full AGM compatibility to AGM.JS.

 To do so, it relies on the default AGM client.
 */

var document = global.document || global.process;

module.exports = function (c, connection) {
	var instance = {};
	//Generate default instance properties
	instance.ApplicationName = document.title + Math.floor(Math.random() * 1000000000);
	instance.ProcessId = Math.floor(Math.random() * 1000000000);
	instance.ProcessStartTime = new Date().getTime();

	//Apply user-submitted instance properties 
	if (typeof c === "object") {
		if (c.application !== undefined) {
			instance.ApplicationName = c.application;
		}
		instance.MachineName = c.machine;
		instance.UserName = c.user;
		instance.Environment = c.environment;
		instance.Region = c.region;
		instance.ServiceName = c.service_name;
		instance.MetricsRepositoryId = c.metrics_repository_id;
		instance.State = 1;
	}
	var identity_updated = false;
	connection.on("Instance", function (i) {
		if (identity_updated) {
			return;
		}
		if (instance.MachineName === undefined) {
			instance.MachineName = i.MachineName;
		}
		if (instance.UserName === undefined) {
			instance.UserName = i.UserName;
		}
		if (instance.Environment === undefined) {
			instance.Environment = i.Environment;
		}
		if (instance.Region === undefined) {
			instance.Region = i.Region;
		}
		if (instance.ServiceName === undefined) {
			instance.ServiceName = i.ServiceName;
		}
		if (instance.MetricsRepositoryId === undefined) {
			instance.MetricsRepositoryId = i.MetricsRepositoryId;
		}
		if (instance.State === undefined) {
			instance.State = i.State;
		}
		if (global.console !== undefined && global.console.table !== undefined && agm.debug === true) {
			console.log("Received instance with info from Gateway.");
		}
		identity_updated = true;
	});
	//Create a method for accessing a property
	function create_getter(property) {
		return instance[property];
	}

	//Generates a request subject for a method
	//Delegates it to the .NET gateway if it is online, 
	//to create subjects which are valid in the scope of the transport that is being used.
	var req_subject = 0;

	function request_subject(method_identifier, callback) {
		callback("req" + (req_subject++) + instance.ProcessId);
	}

	//Generates a response subject subject for a method invocation
	//Delegates it to the .NET gateway if it is online, 
	//to create subjects which are valid in the scope of the transport that is being used.
	var resp_subject = 0;

	function response_subject(method_identifier, callback) {
		callback("resp" + (resp_subject++) + instance.ProcessId);
	}

	//Returns all instance properties
	function info() {
		return instance;
	}

	return {
		request_subject: request_subject,
		response_subject: response_subject,
		info: info,
		application: create_getter("ApplicationName"),
		pid: create_getter("ProcessId"),
		user: create_getter("UserName"),
		machine: create_getter("MachineName")

	};

};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],40:[function(require,module,exports){
(function (global){
var Promise = require('es6-promise').Promise;
var h = require("./agm_helpers");

module.exports = function (configuration) {
	function stringToObject(param, stringPropName) {
		if (typeof param == 'string') {
			var obj = {};
			obj[stringPropName] = param;
			return obj;
		}

		return param;
	}

	// helper function for parsing dates properly
	function agmParse(str) {
		return JSON.parse(str, function (k, v) {
			if (typeof v !== 'string') {
				return v;
			}

			// pre-seed - this should be a bit faster than indexOf
			if (v[0] !== dateTimeIdentifier[0]) {
				return v;
			}

			if (v.indexOf(dateTimeIdentifier) !== 0) {
				return v;
			}

			var unixTimestampMs = v.substr(lenOfIdentitifier);
			return new Date(parseFloat(unixTimestampMs));
		});
	}

	/**
	 * Converts a target argument to object ready to be passed to Agm facade
	 * @param target
	 */
	function targetArgToObject(target) {

		target = target || 'best';

		if (typeof target === "string") {
			if (target !== "all" && target !== "best") {
				throw new Error('"' + target + '" is not a valid target. Valid targets are "all" and "best".');
			}
			return {target: target};
		} else {
			if (!Array.isArray(target)) {
				target = [target];
			}

			target = target.map(function (e) {
				return convertInstanceToRegex(e);
			});

			return {serverFilter: target};
		}
	}

	function convertInstanceToRegex(instance) {
		var instance_converted = {};

		Object.keys(instance).forEach(function (key) {
			var propValue = instance[key];
			instance_converted[key] = propValue;

			if (typeof propValue === "undefined" || propValue === null) {
				return;
			}

			if (typeof propValue === "string") {
				// do exact matching if user passed a string
				instance_converted[key] = "^" + instance[key] + "$";
			}
			else if (instance[key].constructor === RegExp) {
				instance_converted[key] = instance[key].source;
			}
			else {
				instance_converted[key] = instance[key];
			}
		});
		return instance_converted;
	}

	var result = {

		// Registers a JavaScript function as an AGM method, thus making it available other AGM instances on the same transport.
		register: function (methodInfo, callback) {

			var pv = this.agmFacade.protocolVersion;

			if (pv && pv >= 3) {
				// for newer HC use the version where we don't pass arguments as JSON (because of different issues)
				this.agmFacade.register(JSON.stringify(stringToObject(methodInfo, "name")),
					callback,
					true); // return as objects
			} else {
				this.agmFacade.register(JSON.stringify(stringToObject(methodInfo, "name")),
					function (arg) {
						var result = callback(JSON.parse(arg), arguments[1]);
						return JSON.stringify(result);
					});
			}
		},

		registerAsync: function (methodInfo, callback) {
			if (!this.agmFacade.registerAsync) {
				throw new Error('not supported in that version of HtmlContainer');
			}

			this.agmFacade.registerAsync(stringToObject(methodInfo, 'name'),
				function(args, instance, tracker) {
					// execute the user callback
					callback(args,
						instance,
						function (successArgs) {
							tracker.success(successArgs);
						},
						function (error) {
							tracker.error(error)
						});
				});
		},

		unregister: function (methodFilter) {
			this.agmFacade.unregister(JSON.stringify(stringToObject(methodFilter, "name")));
		},

		// Invokes an AGM method asynchronously.
		invoke: function (methodFilter, args, target, options, successCallback, errorCallback) {

			var promise = new Promise(function (resolve, reject) {

				if (!args) {
					args = {};
				}

				if (typeof args !== 'object') {
					reject({message: 'The method arguments must be an object.'});
				}

				if (!options) {
					options = {};
				}

				target = targetArgToObject(target);

				if (this.agmFacade.invoke2) {
					// invoke ver2 - do not stringify arguments and result values
					this.agmFacade.invoke2(
						JSON.stringify(stringToObject(methodFilter, "name")),
						args,
						JSON.stringify(target),
						JSON.stringify(options),
						function (args) {
							resolve(args)
						},
						function (err) {
							reject(err)
						}
					);
				} else {
					var successProxy, errorProxy;

					successProxy = function (args) {
						var parsed = JSON.parse(args);
						resolve(parsed);
					};
					errorProxy = function (args) {
						var parsed = JSON.parse(args);
						reject(parsed);
					};
					this.agmFacade.invoke(
						JSON.stringify(stringToObject(methodFilter, "name")),
						JSON.stringify(args),
						JSON.stringify(target),
						JSON.stringify(options),
						successProxy,
						errorProxy
					);
				}

			}.bind(this));

			return h.promisify(promise, successCallback, errorCallback);
		},

		// Registers a handler which notifies you when a new AGM method is available.
		methodAdded: function (callback) {
			this.agmFacade.methodAdded(callback);
		},

		// Registers a handler which notifies you when an AGM method stops being available.
		methodRemoved: function (callback) {
			this.agmFacade.methodRemoved(callback);
		},

		serverAdded: function (callback) {
			this.agmFacade.serverAdded(callback);
		},

		serverRemoved: function (callback) {
			this.agmFacade.serverRemoved(callback);
		},

		serverMethodAdded: function (callback) {
			this.agmFacade.serverMethodAdded(callback);
		},

		serverMethodRemoved: function (callback) {
			this.agmFacade.serverMethodRemoved(callback);
		},

		// Retrieves a list of AGM servers (instances) optionally filtered by method.
		servers: function (methodFilter) {
			var jsonResult = this.agmFacade.servers(JSON.stringify(methodFilter));
			return agmParse(jsonResult);
		},

		// Retrieves a list of methods that matches a given filter. You can use this to check if a given method exists.
		methods: function (methodFilter) {
			var jsonResult = this.agmFacade.methods(JSON.stringify(methodFilter));
			return agmParse(jsonResult);
		},

		methodsForInstance: function (instanceFilter) {
			var jsonResult = this.agmFacade.methodsForInstance(JSON.stringify(instanceFilter));
			return agmParse(jsonResult);
		},

		// streaming support
		subscribe: function (name, options, successCallback, errorCallback) {
			var promise = new Promise(function (resolve, reject) {
				if (options === undefined) {
					options = {};
				}
				options.args = JSON.stringify(options.arguments || {});
				options.target = targetArgToObject(options.target);

				this.agmFacade.subscribe2(name,
					JSON.stringify(options),
					function (stream) {
						resolve(stream);
					},
					function (error) {
						reject(error);
					}
				);
			}.bind(this));

			return h.promisify(promise, successCallback, errorCallback);
		},

		createStream: function (streamDef, callbacks, successCallback, errorCallback) {
			var promise = new Promise(function (resolve, reject) {
				if (typeof streamDef === "string") {
					streamDef = {name: streamDef};
				}

				if (!callbacks) {
					callbacks = {};
				}

				this.agmFacade.createStream2(
					JSON.stringify(streamDef),
					// TODO - wrap to transform params
					callbacks.subscriptionRequestHandler,
					// TODO - wrap to transform params
					callbacks.subscriptionAddedHandler,
					// TODO - wrap to transform params
					callbacks.subscriptionRemovedHandler,
					// success handler
					function (stream) {
						resolve(stream);
					},
					// error handler
					function (error) {
						reject(error);
					}
				);
			}.bind(this));

			return h.promisify(promise, successCallback, errorCallback);
		}
	};

	result.version = "2.3.1";

	// add metrics
	if (configuration !== undefined && configuration.metrics !== undefined) {
		configuration.metrics.metricsIdentity = configuration.metrics.identity;


		// quick and dirty - we need to stringify the configuration so we need to replace the metrics object (which has circular references)
		// with an object that holds only the properties needed
		var metricsConfig = {
			metricsIdentity: configuration.metrics.metricsIdentity,
			path: configuration.metrics.path
		};
		configuration.metrics = metricsConfig;
	}
	
	//create new AGM façade for this instance
	var facade = global.htmlContainer.jsAgmFacade;
	var configAsString = JSON.stringify(configuration, function( key, value) {
		if( key == 'logger') {
			return '';
		} else {
			return value;
		}
	});
	result.instance = facade.init(configAsString);
	result.agmFacade = facade;

	// date parsing
	var dateTimeIdentifier = result.agmFacade.jsonValueDatePrefix;

	// deprecated API
	result.create_stream = result.createStream;
	result.methods_for_instance = result.methodsForInstance;
	result.method_added = result.methodAdded;
	result.method_removed = result.methodRemoved;
	result.server_added = result.serverAdded;
	result.server_removed = result.serverRemoved;
	result.server_method_added = result.serverMethodAdded;
	result.server_method_removed = result.serverMethodRemoved;

	return result;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_helpers":38,"es6-promise":8}],41:[function(require,module,exports){
(function (global){
/*
 The AGM Server allows users register AGM methods.
 It exposes these methods to AGM clients (using presence messages) and listens for their invocation
 */

var helpers = require("./agm_helpers");
var Promise = require('es6-promise').Promise;
var stream_publisher = require("./agm_stream_publisher");

module.exports = function (connection, instance, configuration) {

	//Validate configuration
	if (typeof configuration !== "object") {
		configuration = {};

		if (global.console !== undefined && configuration.debug === true) {
			console.log('Creating an AGM server with default configuration.');
		}
	}
	//Add defaults
	if (typeof configuration.heartbeat_interval !== "number") {
		configuration.heartbeat_interval = 5000;
	}

	if (typeof configuration.presence_interval !== "number") {
		configuration.presence_interval = 10000;
	}

	//Save the reference to the metric function if it exists
	var metric = (configuration.metrics !== undefined) ? configuration.metrics.numberMetric.bind(configuration.metrics) : function () {
	};
	//An array of the server's methods
	var methods = [];

	var presence_timer;

	var heartbeat_timer;

	if (heartbeat_timer === undefined) {
		heartbeat_timer = setInterval(send_heartbeat, configuration.heartbeat_interval);
	}

	//Initialise the stream publisher module
	var publisher = stream_publisher(connection, instance, configuration, methods);

	function announceNewMethod(newMethod){

		methods.push(newMethod);

		//Send presence so the clients know we have it
		send_presence();
		//Start sending presence regularly (if we aren't already doing it)
		if (presence_timer === undefined) {
			presence_timer = setInterval(send_presence, configuration.presence_interval);
		}
		metric("Registered methods", methods.length);
	}

	// registers a new agm method
	function register(methodDefinition, callback) {

		registerCore(methodDefinition, function(context, resultCallback){
			// get the result as direct invocation of the callback and return it using resultCallback
			try{
				var result = callback(context.args, context.instance);
				resultCallback(null, result);
			} catch (e) {
				resultCallback(e, null);
			}
		});

	}

	// registers a new asyn agm method (the result can be returned in async way)
	function registerAsync(methodDefinition, callback) {

		registerCore(methodDefinition, function(context, resultCallback){
			// invoke the callback passing success and error callbacks
			try{
				callback(context.args, context.instance,
					// success callback
					function(result){
						resultCallback(null, result);
					},
					// error callback
					function (e) {
						resultCallback(e, null);
					});
			} catch (e) {
				resultCallback(e, null);
			}
		});
	}

	// core method for registering agm method
	function registerCore(methodDefinition, the_function) {
		// transform the definition
		if (typeof methodDefinition === "string") {
			methodDefinition = {name: methodDefinition};
		}

		//Get a request subject for this method
		instance.request_subject(methodDefinition, function (requestSubject) {

			var method = convert_method(methodDefinition);
			method.MethodRequestSubject = requestSubject;

			//Add the method (store the unformatted definition in order to do checkups in the unregister method)
			announceNewMethod({
				method: method,
				definition: methodDefinition,
				the_function: the_function
			});

		});
	}

	function createStream(streamDef, callbacks, successCallback, errorCallback){
		// in callbacks we have subscriptionRequestHandler, subscriptionAddedHandler, subscriptionRemovedHandler

		var promise = new Promise(function (resolve, reject) {
			if (typeof streamDef === "string") {

				if(streamDef === '') {
					reject("Invalid stream name.");
				}

				streamDef = {name: streamDef};
			}

			if (!callbacks) {
				callbacks = {};
			}

			if(typeof callbacks.subscriptionRequestHandler !== "function"){
				callbacks.subscriptionRequestHandler = function(request){
					request.accept();
				}
			}

			//Get a request subject, set the streaming bit then push into methods[]
			instance.request_subject(streamDef, function (requestSubject) {
				var streamConverted = convert_method(streamDef);
				streamConverted.MethodRequestSubject = requestSubject;
				streamConverted.Method.Flags = 32; //100000 bitmask with the largest flag (streaming: true)

				var newStreamingMethod = {
					method: streamConverted,
					definition: {
						accepts: streamDef.accepts,
						description: streamDef.description,
						displayName: streamDef.displayName,
						name: streamDef.name,
						objectTypes: streamDef.objectTypes,
						returns: streamDef.returns,
						supportsStreaming: true
					},
					streamCallbacks: callbacks,
					globalEventStreamSubject: streamDef.name + '.jsStream.' + helpers.generateRandom(),
					subscriptions: [],
					branchKeyToStreamIdMap: [] //[ {branchKey: '', streamId: 'strj_nds786y2378yb'}, {...}, ...]
				};

				announceNewMethod(newStreamingMethod);

				resolve({
					branches: function(){
						return publisher.getBranchList(newStreamingMethod)
					},
					close: function(){
						publisher.closeAllSubscriptions(newStreamingMethod);
						unregister(newStreamingMethod.definition)
					},
					definition: {
						accepts: streamDef.accepts,
						description: streamDef.description,
						displayName: streamDef.displayName,
						name: streamDef.name,
						objectTypes: streamDef.objectTypes,
						returns: streamDef.returns,
						supportsStreaming: true
					},
					name: streamDef.name,
					push: function(data, branches){
						if(typeof branches !== 'string' && !Array.isArray(branches) && branches !== undefined){
							throw new Error('invalid branches should be string or string array');
						}
						//TODO validate if is plain object
						if(typeof data !== 'object'){
							throw new Error('Invalid arguments. Data must be an object.')
						}
						publisher.pushData(newStreamingMethod, data, branches)
					},
					subscriptions: function(){
						return publisher.getSubscriptionList(newStreamingMethod);
					}
				});
			});

		});

		return helpers.promisify(promise, successCallback, errorCallback);
	}

	var invocations = 0;

	//Listens for method invocations
	connection.on("MethodInvocationRequestMessage", function (message) {
		//Find the method
		var method = methods.filter(function(m){
			return m.method.MethodRequestSubject === message.MethodRequestSubject;
		})[0];

		//Stop if the message isn't for us
		if (method === undefined) {
			return;
		}

		// some logging if enabled
		if (global.console !== undefined && configuration.debug === true) {
			console.debug("%c<<< receiving MethodInvocationRequestMessage", "background-color:hsla(198, 51%, 79%, 0.5)");
			console.debug("%c" + JSON.stringify(message), "background-color:hsla(198, 51%, 79%, 0.5)");
		}
		metric("Invocations count", invocations++);

		//TODO see if have to move this earlier - i.e. if some messages from Client don't have MethodRequestSubject
		//Check if message is stream-related : defer publisher
		if (publisher.isStreamMsg(message, method)){
			publisher.processSubscriberMsg(message, method);
			return;
		}

		//Execute it and save the result
		method.the_function({args:message.Context.ArgumentsJson, instance:message.Client}, function(err, result) {
			if (err) {
				// handle error case
				if (typeof err.message == 'string') {
					err = err.message;
				} else if (typeof err !== 'string') {
					err = '';
				}
			}

			//Don't send result if the client does not require it
			if (message.MethodResponseSubject === "null") {
				return;
			}

			//The AGM library only transfers objects. If the result is not an object, put it in one
			if (result && (typeof result !== "object" || result.constructor === Array)) {
				result = {_result: result};
			}

			var resultMessage = {
				MethodRequestSubject: message.MethodRequestSubject,
				MethodResponseSubject: message.MethodResponseSubject,
				MethodName: method.method.Method.Name,
				InvocationId: message.Context.InvocationId,
				ResultContextJson: result,
				Server: instance.info(),
				ResultMessage: err,
				Status: err ? 1 : 0
			};
			//Send result
			connection.send("MethodInvocationResultMessage", resultMessage);

			if (global.console !== undefined && configuration.debug === true) {
				console.debug("%c>>> sending MethodInvocationResultMessage", "background-color:hsla(118, 51%, 79%, 0.5)");
				console.debug("%c" + JSON.stringify(resultMessage), "background-color:hsla(118, 51%, 79%, 0.5)");
			}
		});
	});

	//Constructs a heartbeat message
	function construct_heartbeat() {
		return {
			PublishingInterval: configuration.heartbeat_interval,
			Instance: instance.info()
		};
	}

	//Constructs a presence message
	function construct_presence() {
		var p = {
			PublishingInterval: configuration.presence_interval,
			Instance: instance.info()
		};
		p.MethodDefinitions = methods.map(function (method) {
			return method.method;
		});
		return p;
	}

	//True if we should be broadcasting presences and heartbeats, false otherwise
	var broadcasting = true;

	function start() {
		broadcasting = true;
	}

	function stop() {
		broadcasting = false;
	}

	//Sends a presence
	function send_presence() {
		if (broadcasting) {
			connection.send("ServerPresenceMessage", construct_presence());
		}
	}

	//Sends a heartbeat
	function send_heartbeat() {
		if (broadcasting) {
			connection.send("ServerHeartbeatMessage", construct_heartbeat());
		}
	}


	//Converts the method definition from camel case to snake case
	function convert_method(method_identifier) {
		//If we are given a string instead of an object, we presume that is the method's name:
		if (typeof method_identifier === "string") {
			method_identifier = {name: method_identifier};
		}

		//Set default values
		if (typeof method_identifier.version !== "number") {
			method_identifier.version = 0;
		}


		//Convert the method definition to the format that AGM requires
		return {
			Method: {
				Name: method_identifier.name,
				InputSignature: method_identifier.accepts,
				ResultSignature: method_identifier.returns,
				Description: method_identifier.description,
				DisplayName: method_identifier.display_name,
				Version: method_identifier.version,
				ObjectTypeRestrictions: method_identifier.object_types
			}
		};
	}

	function contains_props(filter, object) {
		var match = true;
		Object.keys(filter).forEach(function (prop) {
			if (filter[prop] !== object[prop]) {
				match = false;
			}
		});
		return match;
	}

	//Unregisters a previously registered AGM method
	function unregister(method_filter) {
		if (typeof method_filter === "string") {
			method_filter = {name: method_filter};
		}
		methods = methods.filter(function (method) {
			return !contains_props(method_filter, method.definition);
		});
		metric("Registered methods", methods.length);
	}

	return {register: register, registerAsync: registerAsync, unregister: unregister, start: start, stop: stop, createStream: createStream};
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./agm_helpers":38,"./agm_stream_publisher":42,"es6-promise":8}],42:[function(require,module,exports){
var Promise = require('es6-promise').Promise;
var helpers = require("./agm_helpers");

var publisher = module.exports = function(connection, instance, configuration, methods){

	function sendResult(message){
		if(typeof message !== 'object'){
			throw new Error('Invalid message.');
		}

		if(typeof message.Status !== 'number'){
			message.Status = 0;
		}

		connection.send("MethodInvocationResultMessage", message);
	}

	function isStreamMsgForStreamingMethod(msg, method){
		return (
			msg
			&& msg.EventStreamAction
			&& msg.EventStreamAction !== 0
			&& typeof method === 'object'
			&& method.definition.supportsStreaming === true
		);
	}

	function processSubscriberMsg(msg, streamingMethod){
		if( ! (msg && msg.EventStreamAction && msg.EventStreamAction !== 0) ){
			return;
		}

		if(msg.EventStreamAction === 1) {
			clientWishesToSubscribe(msg, streamingMethod);

		} else if(msg.EventStreamAction === 2) {
			clientWishesToUnsubscribe(msg, streamingMethod);

		} else if(msg.EventStreamAction === 3) {
			clientAcknowledgesItDidSubscribe(msg, streamingMethod);

		} else if(msg.EventStreamAction === 4) {
			clientPerSubHeartbeat(msg);
		}
	}

	/** msg 'Request' Actions */
	//action 1
	function clientWishesToSubscribe(msg, streamingMethod){

		if( ! (
			streamingMethod
			&& streamingMethod.streamCallbacks
			&& typeof streamingMethod.streamCallbacks.subscriptionRequestHandler === 'function') )
		{
			return;
		}

		//Pass-in the request object
		streamingMethod.streamCallbacks.subscriptionRequestHandler({
			accept: acceptRequestOnBranch.bind(null, msg, streamingMethod, ''),
			acceptOnBranch: acceptRequestOnBranch.bind(null, msg, streamingMethod),
			arguments: msg.Context.ArgumentsJson || {},
			instance: msg.Client,
			reject: rejectRequest.bind(null, msg, streamingMethod)
		});
	}

	//action 2
	function clientWishesToUnsubscribe(msg, streamingMethod){

		if( ! (
			streamingMethod
			&& Array.isArray(streamingMethod.subscriptions)
			&& streamingMethod.subscriptions.length > 0)
		){
			return;
		}

		closeIndividualSubscription(streamingMethod, msg.StreamId, msg.EventStreamSubject, false)
	}

	//action 3
	function clientAcknowledgesItDidSubscribe(msg, streamingMethod){
		//Client indicates it is listening to a specific StreamId

		if(typeof msg.StreamId !== 'string' || msg.StreamId === ''){
			return;
		}

		var branchKey = getBranchKey(streamingMethod, msg.StreamId);

		if( typeof branchKey !== 'string'){
			return;
		}

		if( ! Array.isArray(streamingMethod.subscriptions )){
			return;
		}

		var subscription = {
			branchKey: branchKey,
			instance: msg.Client,
			arguments: msg.Context.ArgumentsJson,
			streamId: msg.StreamId,
			privateEventStreamSubject: msg.EventStreamSubject,
			methodResponseSubject: msg.MethodResponseSubject
		};

		//Subscription back-obj is stored
		streamingMethod.subscriptions.push(subscription);

		var subFrontObj = conjureSubscriptionFrontObj(streamingMethod, subscription);
		var subAddedHandler = streamingMethod.streamCallbacks.subscriptionAddedHandler;
		if(typeof subAddedHandler === 'function'){
			//Pass-in the subscription object
			subAddedHandler(subFrontObj);
		}
	}

	//action 4
	function clientPerSubHeartbeat(){
		//A client may have multiple subscriptions, each one having its own heartbeat
		//Currently not implemented by the GW or the client
	}


	/** (request) Methods */
	function acceptRequestOnBranch(msg, streamingMethod, branch){
		if( typeof branch !== "string" ){
			branch = '';
		}

		var streamId = getStreamId(streamingMethod, branch);

		sendResult({
			EventStreamAction: 3,
			EventStreamSubject: streamingMethod.globalEventStreamSubject,
			InvocationId: msg.Context.InvocationId,
			MethodName:streamingMethod.method.Method.Name,
			MethodRequestSubject: streamingMethod.method.MethodRequestSubject,
			MethodResponseSubject: msg.MethodResponseSubject,
			MethodVersion: streamingMethod.method.Method.Version,
			ResultMessage: "Accepted",
			Server: instance.info(),
			StreamId: streamId
		});
	}

	function getBranchKey(streamingMethod, streamId){
		if(typeof streamId !== 'string' || typeof streamingMethod !== 'object'){
			return;
		}

		var needle = streamingMethod.branchKeyToStreamIdMap.filter(function(branch){
			return branch.streamId === streamId;
		})[0];

		if(typeof needle !== 'object' || typeof needle.key !== 'string'){
			return;
		}

		return needle.key;
	}

	function getStreamId(streamingMethod, branchKey){
		if(typeof branchKey !== 'string'){
			branchKey = '';
		}

		var needleBranch = streamingMethod.branchKeyToStreamIdMap.filter(function(branch){
			return branch.key === branchKey;
		})[0];

		var streamId = ( needleBranch ? needleBranch.streamId : undefined ) ;

		if(typeof	streamId !== 'string' || streamId === ''){
			streamId = generateNewStreamId(streamingMethod.method.Method.Name);
			streamingMethod.branchKeyToStreamIdMap.push({key: branchKey, streamId: streamId});
		}

		return streamId;
	}

	function generateNewStreamId(streamingMethodName){
		var appInfo = instance.info();

		var newStreamId = 'streamId-jsb'
			+ '_of_' + streamingMethodName + '_'
			+ '_by_' + appInfo.ApplicationName + '_'
			+ helpers.generateRandom();

		return newStreamId;
	}

	function rejectRequest(msg, streamingMethod, reason){
		if(typeof reason !== 'string'){
			reason = '';
		}

		sendResult({
			EventStreamAction: 2,
			EventStreamSubject: streamingMethod.globalEventStreamSubject,
			//InvocationId: msg.Context.InvocationId,
			MethodName:streamingMethod.method.Method.Name,
			MethodRequestSubject: streamingMethod.method.MethodRequestSubject,
			MethodResponseSubject: msg.MethodResponseSubject,
			MethodVersion: streamingMethod.method.Method.Version,
			ResultMessage: reason,
			Server: instance.info(),
			StreamId: 'default_rejection_streamId'
		});
	}

	/** (subscription) Methods */
	function conjureSubscriptionFrontObj(streamingMethod, subscription){
		//expose a subscription to the user
		return {
			arguments: subscription.arguments || {},
			branchKey: subscription.branchKey,
			close: closeIndividualSubscription.bind(
				null,
				streamingMethod,
				subscription.streamId,
				subscription.privateEventStreamSubject,
				true
			),
			instance: subscription.instance,
			push: pushDataToSingle.bind(null, streamingMethod, subscription),
			stream: streamingMethod.definition
		};
	}

	function conjureBranchFrontObj(streamingMethod, branchKey){
		//expose a branch to the user
		return {
			key: branchKey,
			subscriptions: getSubscriptionList.bind(null, streamingMethod, branchKey),
			close: closeMultipleSubscriptions.bind(null, streamingMethod, branchKey),
			push: function(data){ pushToBranch(streamingMethod, data, branchKey) }
		};
	}

	function closeIndividualSubscription(streamingMethod, streamId, privateEventStreamSubject, sendKickMessage){

		var subscription = streamingMethod.subscriptions.filter( function(subItem) {
			return (
				subItem.privateEventStreamSubject === privateEventStreamSubject
				&& subItem.streamId === streamId
			);
		})[0];

		if (typeof subscription !== 'object'){
			return; //unrecognised subscription
		}

		var initialLength = streamingMethod.subscriptions.length;

		streamingMethod.subscriptions = streamingMethod.subscriptions.filter( function(subItem) {
			return !(
				subItem.privateEventStreamSubject === subscription.privateEventStreamSubject
				&& subItem.streamId === subscription.streamId
			);
		});

		var filteredLength = streamingMethod.subscriptions.length;

		if( filteredLength !== (initialLength - 1) ){
			return; //the subscription wasn't removed
		}

		if(sendKickMessage === true){
			sendResult({
				EventStreamAction: 2,
				EventStreamSubject: privateEventStreamSubject,
				MethodName: streamingMethod.method.Method.Name,
				MethodRequestSubject: streamingMethod.method.MethodRequestSubject,
				MethodResponseSubject: subscription.methodResponseSubject,
				MethodVersion: streamingMethod.method.Method.Version,
				ResponseContextJson: {},
				Server: instance.info(),
				StreamId: subscription.streamId,
				Status:0
			});
		}

		var subRemovedHandler = streamingMethod.streamCallbacks.subscriptionRemovedHandler;
		if(typeof subRemovedHandler === 'function'){
			var subscriber = subscription.instance;
			subRemovedHandler(subscriber)
		}
	}

	function closeMultipleSubscriptions(streamingMethod, branchKey){
		if(typeof streamingMethod !== 'object' || !Array.isArray(streamingMethod.branchKeyToStreamIdMap)){
			return;
		}

		var streamList = streamingMethod.branchKeyToStreamIdMap;

		if(typeof branchKey === 'string'){
			streamList = streamingMethod.branchKeyToStreamIdMap.filter(function(br){
				return ( typeof br === 'object' && br.key === branchKey );
			});
		}

		//TODO: consider getting the unique branch keys from 'live subscribers'

		streamList.forEach(function(br){
			var streamId = br.streamId;

			sendResult({
				EventStreamAction: 2,
				EventStreamSubject: streamingMethod.globalEventStreamSubject,
				MethodName: streamingMethod.method.Method.Name,
				MethodRequestSubject: streamingMethod.method.MethodRequestSubject,
				Server: instance.info(),
				StreamId: streamId,
				Status: 0
			});
		});
	}

	function pushDataToSingle(streamingMethod, subscription, data){

		//TODO validate data is a plain object
		if(typeof data !== 'object'){
			throw new Error('Invalid arguments. Data must be an object.');
		}

		sendResult({
			EventStreamAction: 5,
			EventStreamSubject: subscription.privateEventStreamSubject,
			MethodName: streamingMethod.method.Method.Name,
			MethodRequestSubject: streamingMethod.method.MethodRequestSubject,
			ResultContextJson: data,
			Server: instance.info(),
			StreamId: subscription.streamId
		});
	}

	function pushToBranch(streamingMethod, data, branches){
		if(typeof streamingMethod !== 'object' || !Array.isArray(streamingMethod.branchKeyToStreamIdMap)){
			return;
		}

		//TODO validate data is a plain object
		if(typeof data !== 'object'){
			throw new Error('Invalid arguments. Data must be an object.');
		}

		if(typeof branches === 'string'){
			branches = [branches]; //user wants to push to single branch
		} else if(!Array.isArray(branches) || branches.length <= 0){
			branches = null;
		}

		//get the StreamId's from the method's branch map
		var streamIdList = streamingMethod.branchKeyToStreamIdMap
			.filter(function(br){
				return (
					branches === null
					|| ( !!br && typeof br.key === 'string' && branches.indexOf(br.key) >= 0 )
				);
			}).map(function(br){
				return br.streamId;
			});

		streamIdList.forEach(function (streamId) {

			sendResult({
				EventStreamAction: 5,
				EventStreamSubject: streamingMethod.globalEventStreamSubject,
				MethodName: streamingMethod.method.Method.Name,
				MethodRequestSubject: streamingMethod.method.MethodRequestSubject,
				ResultContextJson: data,
				Server: instance.info(),
				StreamId: streamId
			});

		});


	}

	function getSubscriptionList(streamingMethod, branchKey){
		if(typeof streamingMethod !== 'object'){
			return [];
		}

		var subscriptions = [];

		if(typeof branchKey !== 'string'){
			subscriptions = streamingMethod.subscriptions;
		} else {
			subscriptions = streamingMethod.subscriptions.filter(function(sub){
				return sub.branchKey === branchKey;
			});
		}

		return subscriptions.map(function(sub){
			return conjureSubscriptionFrontObj(streamingMethod, sub);
		});
	}

	function getBranchList(streamingMethod){
		if(typeof streamingMethod !== 'object'){
			return [];
		}

		var uniqueBranchNames = getUniqueBranchNames(streamingMethod);

		return uniqueBranchNames.map(function(branchKey){

			return conjureBranchFrontObj(streamingMethod, branchKey);

		});
	}

	function getUniqueBranchNames(streamingMethod){
		var keysWithDuplicates = streamingMethod.subscriptions.map(function(sub){
			var result = null;
			if(typeof sub === 'object' && typeof sub.branchKey === 'string'){
				result = sub.branchKey;
			}
			return result;
		});

		var seen = [];

		var branchArray = keysWithDuplicates.filter(function(bKey) {
			if(bKey === null || seen.indexOf(bKey) >= 0) {
				return false;
			}
			seen.push(bKey);
			return true;
		});

		return branchArray;
	}

	return { //an instance fo the publisher
		isStreamMsg: isStreamMsgForStreamingMethod,
		processSubscriberMsg: processSubscriberMsg,
		pushData: pushToBranch,
		closeAllSubscriptions: closeMultipleSubscriptions,
		getSubscriptionList:getSubscriptionList,
		getBranchList: getBranchList,
		generateNewStreamId: generateNewStreamId
	};
};

},{"./agm_helpers":38,"es6-promise":8}],43:[function(require,module,exports){
module.exports={
  "_args": [
    [
      "tick42-agm@2.3.1",
      "C:\\work\\stash\\GLUE-dev\\js-glue"
    ]
  ],
  "_from": "tick42-agm@2.3.1",
  "_id": "tick42-agm@2.3.1",
  "_inCache": true,
  "_installable": true,
  "_location": "/tick42-agm",
  "_nodeVersion": "6.3.0",
  "_npmUser": {},
  "_npmVersion": "3.8.5",
  "_phantomChildren": {},
  "_requested": {
    "name": "tick42-agm",
    "raw": "tick42-agm@2.3.1",
    "rawSpec": "2.3.1",
    "scope": null,
    "spec": "2.3.1",
    "type": "version"
  },
  "_requiredBy": [
    "/"
  ],
  "_shasum": "0f9a2ef417cda7684b73dd055abc77490b988646",
  "_shrinkwrap": null,
  "_spec": "tick42-agm@2.3.1",
  "_where": "C:\\work\\stash\\GLUE-dev\\js-glue",
  "author": {
    "name": "Tick42",
    "url": "http://www.tick42.com"
  },
  "bin": {
    "agm": "bin/agm"
  },
  "bugs": {
    "url": "https://jira.tick42.com/browse/APPCTRL"
  },
  "dependencies": {
    "es6-promise": "^3.0.2",
    "inquirer": "^0.8.5",
    "tick42-gateway-connection": "^1.1.2",
    "util-deprecate": "^1.0.2"
  },
  "description": "JavaScript AGM",
  "devDependencies": {
    "blanket": "^1.1.6",
    "bluebird": "^2.9.30",
    "browserify-versionify": "^1.0.6",
    "grunt": "^0.4.5",
    "grunt-browserify": "^3.3.0",
    "grunt-cli": "^0.1.0",
    "grunt-contrib-clean": "^0.6.0",
    "grunt-contrib-connect": "^0.9.0",
    "grunt-contrib-jshint": "^0.11.0",
    "grunt-contrib-qunit": "^0.5.2",
    "grunt-contrib-uglify": "^0.6.0",
    "grunt-contrib-watch": "^0.6.1",
    "grunt-exorcise": "^1.0.0",
    "phantomjs": "^1.9.12",
    "qunitjs": "^1.15.0",
    "uglifyify": "^3.0.1"
  },
  "dist": {
    "shasum": "0f9a2ef417cda7684b73dd055abc77490b988646",
    "tarball": "http://192.168.0.234:4873/tick42-agm/-/tick42-agm-2.3.1.tgz"
  },
  "gitHead": "f33fb8ed4a56832a7b0cdb9b67717571868d27cb",
  "keywords": [
    "agm",
    "javascript",
    "library"
  ],
  "main": "library/agm.js",
  "name": "tick42-agm",
  "optionalDependencies": {},
  "readme": "ERROR: No README data found!",
  "scripts": {
    "build": "npm install && grunt",
    "prepublish": "grunt",
    "start": "grunt watch",
    "test": "grunt qunit"
  },
  "title": "Tick42 AGM",
  "version": "2.3.1"
}

},{}],44:[function(require,module,exports){
(function (global){
var application = require("./application");
var instance = require("./instance");
var helpers = require("./helpers");

module.exports = global.app_manager = function app_manager(agm, windows) {

	var apps = application(agm, function () {
		return instances;
	});
	var instances = instance(agm, apps);
	var manager = {
		applications: apps.all,
		application: apps.get_by_id,
		on_app_added: helpers.add_callback("added").bind(apps),
		on_app_available: helpers.add_callback("available").bind(apps),
		on_app_removed: helpers.add_callback("removed").bind(apps),
		on_app_unavailable: helpers.add_callback("unavailable").bind(apps),

		instances: instances.all,
		on_instance_started: helpers.add_callback("started").bind(instances),
		on_instance_stopped: helpers.add_callback("stopped").bind(instances),
		on_instance_updated: helpers.add_callback("updated").bind(instances),

		get_branches: function (success, error) {
			agm.invoke("T42.ACS.GetBranches", {}, "best", {}, function (e) {
				if (success) {
					success(helpers.vals(e.returned.Branches));
				}
			}, error);
		},
		get_current_branch: function (success, error) {
			agm.invoke("T42.ACS.GetCurrentBranch", {}, "best", {}, function (e) {
				if (success) {
					success(e.returned.Branch);
				}
			}, error);
		},
		set_current_branch: function (branch, success, error) {
			agm.invoke("T42.ACS.SetCurrentBranch", {Branch: branch}, "best", {}, success, error);
		},
		current_user: function (success, error) {
			agm.invoke("T42.ACS.GetUser", {}, "best", {}, success, error);
		},
		get_functional_entitlement: function (fn, success, error) {
			agm.invoke("T42.ACS.GetFunctionalEntitlement", {Function: fn}, "best", {}, function (e) {
				if (success) {
					success(e.returned.Entitlement);
				}
			}, error);
		},
		get_functional_entitlement_branch: function (fn, br, success, error) {
			agm.invoke("T42.ACS.GetFunctionalEntitlement", {Function: fn, Branch: br}, "best", {}, function (e) {
				if (success) {
					success(e.returned.Entitlement);
				}
			}, error);
		},
		can_i: function (fn, success, error) {
			agm.invoke("T42.ACS.CanI", {Function: fn}, "best", {}, success, error);
		},

		can_i_branch: function(fn, branch, success, error) {
			agm.invoke("T42.ACS.CanI", {Function: fn, Branch: branch}, "best", {}, success, error);
		},

		exit: function () {
			agm.invoke("T42.ACS.Shutdown", {}, "all", {},
				function (a) {
					console.log(a);
				},
				function (e) {
					console.log(e);
				});
		},

		set_region: function (region, success, error){
			agm.invoke("T42.ACS.SetConfigurationRegion", {Region: region}, "best", {}, success, error);
		},

		get_region: function(success, error){
			agm.invoke("T42.ACS.GetConfigurationRegion", {}, "best", {}, function (e) {
				if (success) {
					success(e.returned.Region);
				}
			}, error);
		},

		_trigger_app_event: apps._trigger,
		_trigger_instance_event: instances._trigger

	};

	function call_with(prop, func) {
		return function (result) {
			func(result[prop]);
		};

	}
	//Create event bindings

	//Tell the app when its instances are added/removed

	manager.on_instance_started(function (instance) {
		if (instance.application) {
			//Trigger "instance_started" event on application
			manager._trigger_app_event("instance_started", instance, instance.application.name);

			//Trigger "window_opened" event on instance
			var container;
			if (windows) {
				var id = (instance.context && instance.context.guid) ? instance.context.guid : instance.id;
				container = instance.application.configuration.container;
				glue.agm.invoke("T42.Wnd.FindById", {windowId: instance.id}, {application: container}, {}, window_opened, function(e){console.log(e)});
			}
		}

		function window_opened(a) {
			//Wrap the window in a window object, using the glue windows lib
			var w = a.returned [Object.keys(a.returned)[0]];
			var win = glue.windows._from_event(w.windowName, container, w.url, w.windowId, w.windowStyleAttributes, w.windowTitle);

			//Trigger the window opened event
			manager._trigger_instance_event("window_added", win, id);
		}
	});

	manager.on_instance_stopped(function (instance) {
		if (instance.application) {
			manager._trigger_app_event("instance_stopped", instance, instance.application.name);

			var id = (instance.context && instance.context.guid) ? instance.context.guid : instance.id;
			manager._trigger_instance_event("window_removed", {}, id);

		}
	});

	manager.on_instance_updated(function (instance) {
		if (instance.application) {
		// manager._trigger_app_event("instance_stopped", instance, instance.application.name);

		// var id = (instance.context && instance.context.guid) ? instance.context.guid : instance.id;
		// manager._trigger_instance_event("title_changed", {}, id);
		}
	});
	//When an app is removed, remove also its instances

	manager.on_app_removed(function (app) {
		app.instances.forEach(function (instance) {
			var id = (instance.context && instance.context.guid) ? instance.context.guid : instance.id;
			manager._trigger_instance_event("stopped", {}, id);
		});
	});
	var branch_changed_callback;
	manager.on_branches_changed = function (callback) {
		branch_changed_callback = callback;
	};

	function on_branch_changed(e) {
		if (typeof branch_changed_callback === "function") {
			branch_changed_callback(helpers.vals(e));
		}
	}

	function handle_app_ready(app) {
		if (app.IsReady) {
			manager._trigger_app_event("available", app);
		} else {

			manager._trigger_app_event("unavailable", app);
		}
	}

	function app_failed(e) {
		manager._trigger_instance_event("error", e, e.Context.guid);
	}

	if (agm && agm.subscribe) {

		manager.agm = agm;
		var handlers = [
			{event: "OnApplicationAdded", trigger: "added", on: apps},
			{event: "OnApplicationRemoved", trigger: "removed", on: apps},
			{event: "OnApplicationChanged", trigger: "changed", on: apps},
			{event: "OnApplicationStarted", trigger: "started", on: instances},
			{event: "OnApplicationStopped", trigger: "stopped", on: instances},
			{event: "OnApplicationUpdated", trigger: "updated", on: instances},
			{event: "OnApplicationAgmServerReady", trigger: "agm_ready", on: instances},
			{event: "OnApplicationReady", func: handle_app_ready},
			{event: "OnBranchesModified", func: on_branch_changed},
			{event: "OnApplicationStartFailed", raw_func: app_failed}
		];

         agm.serverMethodAdded(function (resp) {
             if ((resp.server.application.indexOf('AppManager') !== -1 && resp.method.name.indexOf('T42.ACS.OnEvent') !== -1)) {
                agm.subscribe("T42.ACS.OnEvent", {target: "all"})
                    .then(function (subscription) {
                        subscription.onData(function (streamData) {
                            var events = streamData.data;
                            handlers.forEach(function (handler) {
                                var objects = events[handler.event];
                                if (objects) {

                                    if (handler.raw_func !== undefined) {
                                        handler.raw_func(objects);
                                        return;
                                    }

                                    helpers.vals(objects).forEach(function (object) {
                                        if (handler.on !== undefined) {
                                            handler.on._trigger(handler.trigger, object);
                                        } else {
                                            handler.func(object);
                                        }
                                    });
                                }
                            });
                        })
                    });
             }
         });
	}

	manager.version = "2.3.1";

	return manager;
};

global.tick42 = global.tick42 ||{};
global.tick42.app_manager = global.app_manager;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./application":45,"./helpers":47,"./instance":48}],45:[function(require,module,exports){
var event_manager = require("./event_manager");
var helpers = require("./helpers");

module.exports = function(agm, instances) {
	var app_proto = helpers.add_callbacks({

		start: function (params, success, error) {
			params = params || {};
			params.guid = params.guid || Math.floor(Math.random() * 10000000);
			if (agm) {
				agm.invoke("T42.ACS.StartApplication", {Name: this.name, Context: params}, "best", {}, function (e) {
				}, error);
			}
			return instances()._trigger("create", {Context: params});

		}

	}, ["added", "removed", "available", "unavailable", "instance_started", "instance_stopped", "changed"], "on_");

//constructor, init_event, id_field


	function update_app(props, obj) {
		obj.name = props.Name;
		obj.title = props.Title;
		obj.version = props.Version;
		obj.instances = [];
		obj.configuration = {};
		obj.configuration.auto_start = props.AutoStart;
		obj.configuration.caption = props.Caption;
		obj.configuration.hidden = props.IsHidden;
		obj.configuration.container = props.ApplicationName;
		//obj.disabled = props.IsDisabled;
		obj.configuration.allow_multiple = props.AllowMultiple;
		obj.available = props.IsReady || false;
		obj.icon = props.Icon;
		obj.sortOrder = props.SortOrder;
		obj.userProperties = props.UserProperties;
		return obj;
	}

	return event_manager({
		create: function create_app(props) {
			return update_app(props, Object.create(app_proto));
		},
		update: update_app,
		init_event: "added",
		exit_event: "removed",
		id_field: "Name",
		callbacks: {
			available: function () {
				this.available = true;
			},
			changed: function (props) {
				this.icon = props.Icon;
				this.title = props.Title;
				this.configuration.caption = props.Caption;
			},
			unavailable: function () {
				this.available = false;
			},
			instance_started: function (instance) {
				this.instances.push(instance);
			},
			instance_stopped: function (instance) {
				this.instances = this.instances.filter(function (my_instance) {
					return my_instance !== instance;
				});
			}
		}
	});

};

},{"./event_manager":46,"./helpers":47}],46:[function(require,module,exports){
var helpers = require("./helpers");

function exec_callbacks(obj, arr, val) {
	if (arr !== undefined) {
		arr.forEach(function (callback) {
			callback.call(obj, val);
		});
	}
}

module.exports = function create_environment(settings) {
	var objects = {};
	var global_callbacks = {};
	return {
		all: function () {
			return helpers.vals(objects);
		},
		get_by_id: function (id) {
			return objects[id];
		},
		_trigger: function (type, props, id) {
			id = id || ( typeof settings.id_field === "function" ? settings.id_field(props) : props[settings.id_field]);

			//Quit if we receive an event for an object before initiating it.
			if (objects[id] === undefined && ( type !== settings.init_event && type !== settings.create_event)) {
				//console.log ("Received '"+type+"' event before '"+settings.init_event+"'");
				return;
			}


			//Create or retrieve an object, representing the entity
			var obj = objects[id] = objects[id] || init_object(settings.create(props));

			if (type === settings.init_event) {
				//Quit if we receive a init event for an object that is already active
				if (obj.active) {
					//console.log ("Received second '"+settings.init_event+"' for app "+id);
					return;
					//Else, make it active
				} else {
					obj.active = true;
					settings.update(props, obj);
				}
				//When the entity is removed, set it to non-active
			} else if (type === settings.exit_event) {
				obj.active = false;

				//When a create event is received, just return the object without doing anything else
			} else if (type === settings.create_event) {
				return obj;

			} else if (type === settings.update_event) {
				settings.update(props, obj);
			}

			//Execute system callbacks
			if (settings.callbacks[type] !== undefined) {
				settings.callbacks[type].call(obj, props);
			}

			// make sure that errors in user specified callbacks does not
			// break our library
			try {
				//Execute global callbacks
				exec_callbacks(undefined, global_callbacks[type], obj);

				//Execute user-defined callbacks that are attached to the object
				exec_callbacks(obj, obj.callbacks[type], props);
			}
			catch (e){
				console.error(e);
			}
			//When the entity is removed, remove all callbacks (after you execute them)
			if (type === settings.exit_event) {
				obj.callbacks = {};
			}
			return obj;

		},
		//Expose the global callbacks object so that user can register some
		callbacks: global_callbacks
	};
};

function init_object(object) {
	object.callbacks = {};
	object.active = false;
	return object;
}

},{"./helpers":47}],47:[function(require,module,exports){
function noop(){}

function exec_if(condition) {
	return function (app, callback) {
		if (condition(app)) {
			callback.call(app);
		}
	};
}

exports.add_callbacks = function add_callbacks(object, events, prefix) {
	events.forEach(function (event) {
		if (typeof event === "string") {
			event = {name: event, trigger_when: noop};
		}

		object[prefix + event.name] = exports.add_callback(event.name, exec_if(event.trigger_when));
	});
	return object;

};

exports.add_callback = function add_callback( key, on_add ){
	return function(callback){
		var obj = this.callbacks;
		if(obj[key]===undefined){obj[key] = [callback];}
		else {obj[key].push(callback);}
		if(typeof on_add === "function"){on_add(this, callback);}
		return this;
	};
};

exports.vals = function vals(obj) {
	return Object.keys(obj).reduce(function (arr, key) {
		arr.push(obj[key]);
		return arr;
	}, []);
};

},{}],48:[function(require,module,exports){
var event_manager = require("./event_manager");
var helpers = require("./helpers");

module.exports = function(agm, apps) {
	var instance_proto = helpers.add_callbacks({
		stop: function (params, success, error) {
			agm.invoke("T42.ACS.StopApplication", {Name: this.application.name, Id: this.id}, "best", {}, function (e) {
				console.log(e);
			}, error);
		},
		activate: function (params, success, error) {
			agm.invoke("T42.ACS.ActivateApplication", {Name: this.application.name, Id: this.id}, "best", {}, function (e) {
				console.log(e);
			}, error);
		}
	}, [
		{
			name: "window_added", trigger_when: function (app)  	{
			return app.active && app.main_window !== undefined;
		}
		},
		{
			name: "window_removed", trigger_when: function (app) {
			return app.main_window === undefined;
		}
		},
		{
			name: "started", trigger_when: function (app) {
			return app.id !== undefined && app.active;
		}
		},
		{
			name: "stopped", trigger_when: function (app) {
			return app.id !== undefined && !app.active;
		}
		},
		{
			name: "agm_ready", trigger_when: function (app) {
			return app.active && app.agm !== undefined;
		}
		},
    {
      name: "error", trigger_when: function (app) {
      return app.error !== undefined;
    }
		},
	], "on_");

	function update_instance(props, obj) {
		obj.id = props.Id;
		obj.application = apps.get_by_id(props.Name);
		obj.context = props.Context;
		obj.title = props.Title;
		return obj;
	}

	return event_manager({
		create: function (props) {
			return update_instance(props, Object.create(instance_proto));
		},
		update: update_instance,
		create_event: "create",
		init_event: "started",
		exit_event: "stopped",
    update_event: "updated",
		id_field: function (e) {
			return e.Context !== undefined && e.Context.guid !== undefined ? e.Context.guid : e.Id;
		},
		callbacks: {
			agm_ready: function (e) {
				//get the first AGM
				var server_name = Object.keys(e.AgmServers)[0];
				//Attach it to the object
				this.agm = convert_agm_instance(e.AgmServers[server_name]);
			},
			error: function (e) {
				this.error = e;
			},
			window_added: function (win) {
				this.main_window = win;
				this.windows = this.windows || [];
				this.windows.push(win);
			},
			window_removed: function () {
				this.main_window = undefined;
				this.windows = [];
			}
		}
	});
};

function convert_agm_instance(agm) {
	return {
		machine: agm.machineName,
		user: agm.userName,
		environment: agm.environment,
		application: agm.applicationName

	};
}

},{"./event_manager":46,"./helpers":47}],49:[function(require,module,exports){
/**
 * @module appconfig
 */
'use strict';

var _ = require('./util');
var Model = require('./model');
var helpers = require('./helpers');

var events = {
  connect: 'connect',
  disconnect: 'disconnect',
  update: 'update',
  status: 'status'
};

var EventBus = function () {
  var subscriptionsByType;
  var on = function (type, once, callback, scope) {
    if (!_.isFunction(callback)) {
      return;
    }

    var subscription = {
      type: type,
      once: once,
      callback: callback,
      scope: scope
    };

    var subscriptions = subscriptionsByType[type];
    if (typeof subscriptions === 'undefined') {
      subscriptions = subscriptionsByType[type] = [];
    }
    subscription.id = subscriptions.push(subscription) - 1;
    return subscription;
  };

  var emit = function () {
    var args = [].slice.call(arguments);
    var type = args.splice(0, 1)[0];
    var subscriptions = subscriptionsByType[type];
    if (typeof subscriptions === 'undefined') {
      subscriptions = subscriptionsByType[type] = [];
    }
    subscriptions.forEach(function (subscription) {
      if (!subscription) {
        return;
      }

      try {
        subscription.callback.apply(subscription.scope, args);
      } catch (x) {
        _.warn('Exception during execution of callback', subscription, args, x);
      }
      if (subscription.once) {
        off(subscription);
      }
    });
  };
  var off = function (subscription) {
    var subscriptions = subscriptionsByType[subscription.type];
    if (typeof subscriptions !== 'undefined') {
      delete subscriptions[subscription.id];
    }
  };

  var resume = function (subscription) {
    if (typeof subscription.id === 'undefined') {
      return on(subscription.type, subscription.once, subscription.callback, subscription.scope);
    } else {
      var subscriptions = subscriptionsByType[subscription.type];
      if (typeof subscriptions === 'undefined') {
        subscriptions = subscriptionsByType[subscription.type] = [];
      }
      subscriptions[subscription.id] = subscription;
      return subscription;
    }
  };

  var reset = function () {
    if (typeof subscriptionsByType !== 'undefined') {
      Object.keys(subscriptionsByType).forEach(function (type) {
        var subscriptions = subscriptionsByType[type];
        if (typeof subscriptions !== 'undefined') {
          subscriptions.forEach(function (subscription) {
            delete subscription.id;
          });
        }
      });
    }
    subscriptionsByType = {};
  };
  reset();
  return {
    on: on,
    emit: emit,
    off: off,
    resume: resume,
    reset: reset

  };
};

var AppConfig = function () {

  var defaultListen  = true;
  var gateway;
  var initGateway;
  var bus = new EventBus();
  var model = new Model(bus);

  var root = require('./props')(model.root);
  var self = this;

  var gatewayConnection;
  var pollingIntervalId;
  var clearPollingInterval = function () {
    if (typeof pollingIntervalId !== 'undefined') {
      clearInterval(pollingIntervalId);
    }
  };

  // Public API
  self.init = function (settings) {
    settings = settings || {};
    var isIdentityValid = typeof settings.identity === 'object' &&
      Object.keys(settings.identity).length > 0;

    if (isIdentityValid) {
      self.identity = settings.identity;
    }
    defaultListen = settings.defaultListen || defaultListen;
    if (!self.identity) {
      throw new TypeError('identity must be non empty object.');
    }

    model.separator = settings.defaultSeparator || model.separator;

    self.schema = settings.schema || self.schema || 'ApplicationConfiguration';

    initGateway = _.isFunction(settings.gateway) ?
      settings.gateway :
      function () {
        if (typeof settings.gateway === 'undefined') {
          settings.gateway = {};
        }
        if (typeof settings.gateway.instance === 'undefined') {
          settings.gateway.instance = _.uuid();
        }
        return require('./gateway')(settings.gateway);
      };
  };

  self.connect = function (listen, callback, scope) {
    clearPollingInterval();
    var subscription;
    if (arguments.length > 0) {
      if (_.isFunction(listen)) {
        callback = listen;
        scope = callback;
        listen = defaultListen;
      }
      subscription = bus.on(events.connect, true, callback, scope);
    }

    var error;
    if (!self.identity) {
      error = 'identity is not specified. did you forget to call init()?';
    } else {
      if (!gateway) {
        gateway = initGateway();
      }
      if (!listen) {
        gatewayConnection =
          gateway.connect(
            self.schema,
            self.identity,
            false,
            function (error, snapshot, updates) {
              if (typeof error === 'undefined') {
                model.applySnapshot(snapshot);
              }
              bus.emit(events.connect, error);
            },
            function (error, status) {
              bus.emit(events.status, error, status);
            });
      } else {
        var connectEmitted = false;
        gatewayConnection = gateway.connect(
          self.schema,
          self.identity,
          true,
          function (error, snapshot, updates) {
            if (typeof snapshot !== 'undefined') {
              model.applySnapshot(snapshot);
            }
            if (typeof updates !== 'undefined') {
              model.applyUpdates(updates);
            }
            if (!connectEmitted) {
              connectEmitted = true;
              bus.emit(events.connect, error);
            }
          },
          function (error, status) {
            var LISTEN_NOT_SUPPORTED = 8;
            if (status.code === LISTEN_NOT_SUPPORTED) {
              pollingIntervalId = setInterval(function () {
                gateway.disconnect(gatewayConnection);
                gatewayConnection = gateway.connect(self.schema, self.identity, false, function (error, snapshot) {
                  model.applySnapshot(snapshot, false);
                });
              }, 2000);
            }
          });
      }
    }

    if (error) {
      setTimeout(bus.emit, 0, events.connect, error);
      throw new Error(error);
    }

    return subscription;

  };

  self.props = function (section, separator) {
    return root.props(section, separator);
  };

  self.modify = function (modifications, callback, scope) {
    if (typeof modifications === 'object') {
      modifications = [modifications];
    }
    var subscription = bus.on(events.update, true, callback, scope);

    return subscription;
  };

  self.onConnect = function (callback, scope) {
    return bus.on(events.connect, false, callback, scope);

  };

  self.onDisconnect = function (callback, scope) {
    return bus.on(events.disconnect, false, callback, scope);
  };

  self.off = function (subscription) {
    if (subscription) {
      bus.off(subscription);
    }
  };

  self.on = function (subscription) {
    if (subscription) {
      bus.resume(subscription);
    }
  };

  self.disconnect = function (callback, scope) {
    if (_.isFunction(callback)) {
      bus.on(events.disconnect, true, callback, scope);
    }
    clearPollingInterval();
    if (typeof gateway !== 'undefined') {
      gateway.disconnect(gatewayConnection, function (error) {
        bus.emit(events.disconnect, error);
      });
      gateway = undefined;
    } else {
      bus.emit(events.disconnect, 'not connected');
    }
  };
};

AppConfig.prototype.identityEqual = helpers.identityEqual;
AppConfig.prototype.identityToString = helpers.identityToString;

module.exports = function () {
  return new AppConfig();
};

},{"./gateway":50,"./helpers":51,"./model":52,"./props":53,"./util":54}],50:[function(require,module,exports){
'use strict';

var gatewayConnection = require('tick42-gateway-connection');
var helpers = require('./helpers');
var identityToString = helpers.identityToString;
var PRODUCT = 'appconfig';

var GatewayTransport = function (options) {
  var connection;
  var dataHandlers = {};
  var statusHandlers = {};
  options = options || {};

  function handleStatusMessage(msg) {
    var handler = statusHandlers[msg.instance];
    if (handler) {
      handler(msg.error, msg.status);
    }
  }
  function handleDataMessage(msg) {
    var schema = msg.schema;
    var schemaHandlers = dataHandlers[schema];
    if (typeof schemaHandlers === 'undefined') {
      return;
    }
    var identityKey = identityToString(msg.identity, true);
    var identityHandlers = schemaHandlers[identityKey];
    if (typeof identityHandlers === 'undefined') {
      return;
    }
    identityHandlers.forEach(function (handler) {
      if (handler) {
        handler(msg.error, msg.snapshot, msg.updates);
      }
    });
  }
  function ensureConnection() {
    if (typeof(connection) === 'undefined') {
      if (typeof options.connection !== 'undefined')
      {
        connection = options.connection;
      }
      else {
        connection = gatewayConnection(options.settings, options.custom_connection);
      }
    }
  }
  var dataSubscription;
  var statusSubscription;
  var connect = function (schema, identity, listen, handler, statusHandler) {
    ensureConnection();
    var schemaHandlers = dataHandlers[schema];
    if (typeof schemaHandlers === 'undefined') {
      schemaHandlers = dataHandlers[schema] = {};
    }
    var identityKey = identityToString(identity, true);
    var identityHandlers = schemaHandlers[identityKey];
    if (typeof identityHandlers === 'undefined') {
      identityHandlers = schemaHandlers[identityKey] = [];
    }
    var handlerToRegister;
    var index;
    if (listen) {
      handlerToRegister = handler;
    } else {
      handlerToRegister = function (error, snapshot, updates) {
        handler(error, snapshot, updates);
        delete identityHandlers[index];
      };
    }

    index = identityHandlers.push(handlerToRegister) - 1;

    if (typeof (dataSubscription) === 'undefined') {
      dataSubscription = connection.on(PRODUCT, GatewayTransport.MessageType.DATA, function (msg) {
        handleDataMessage(msg);
      });
    }
    var instance = options.instance;
    statusHandlers[instance] = statusHandler;
    if (typeof (statusSubscription) === 'undefined') {
      statusSubscription = connection.on(PRODUCT, GatewayTransport.MessageType.STATUS, function (msg) {
        handleStatusMessage(msg);
      });
    }

    var msg = {
      schema: schema,
      identity: identity,
      instance: instance,
      listen: listen
    };
    connection.send(PRODUCT, GatewayTransport.MessageType.CONNECT, msg);
    return {
      schema: schema,
      identity: identity,
      listen: listen,
      handler: handler,
      index : index
    };
  };

  var modify = function (schema, identity, modifications) {
    ensureConnection();
    connection.send(PRODUCT, GatewayTransport.MessageType.MODIFY, modifications);
  };
  var disconnect = function (descriptor) {
    var schemaHandlers = dataHandlers[descriptor.schema];
    if (typeof schemaHandlers !== 'undefined') {
      var identityKey = identityToString(descriptor.identity, true);
      var identityHandlers = schemaHandlers[identityKey];
      if (typeof identityHandlers !== 'undefined') {
        var handler = identityHandlers[descriptor.index];
        if (typeof handler !== 'undefined') {
          var msg = {
            schema: descriptor.schema,
            identity: descriptor.identity,
            instance: options.instance
          };
          connection.send(GatewayTransport.MessageType.DISCONNECT, msg);
          delete identityHandlers[descriptor.index];
        }
        if (identityHandlers.length === 0) {
          delete schemaHandlers[identityKey];
        }
      }
      if (Object.keys(schemaHandlers).length === 0) {
        delete dataHandlers[descriptor.schema];
      }
    }
    if (Object.keys(dataHandlers).length === 0) {
      if (typeof (dataSubscription) !== 'undefined') {
        connection.off(dataSubscription);
      }
    }
    delete statusHandlers[descriptor.instance];
    if (Object.keys(statusHandlers).length === 0) {
      if (typeof statusSubscription !== 'undefined') {
        connection.off(statusSubscription);
      }
    }
  };
  return {
    connect: connect,
    modify: modify,
    disconnect: disconnect
  };
};

GatewayTransport.MessageType = {
  // { schema: 'ApplicationConfiguration', identity: {}, listen: true, instance: '' }
  CONNECT: 'connect',
  // { schema: 'ApplicationConfiguration', identity: {}, instance: '' }
  DISCONNECT: 'disconnect',
  // { schema: 'ApplicationConfiguration', identity: {}, updates: [], instance: '' }
  MODIFY: 'modify',
  // { schema: 'ApplicationConfiguration', identity: {}, error: '', snapshot: {defaultKeyValue: '', keys: [], props: {}}, updates: [] }
  DATA: 'data',
  // { schema: 'ApplicationConfiguration', identity: {}, instance: '', status: '', error: '' }
  STATUS: 'status'
};

module.exports = GatewayTransport;

},{"./helpers":51,"tick42-gateway-connection":55}],51:[function(require,module,exports){
'use strict';

function escapeIdentityText(text) {
  if (typeof text === 'string') {
    return text.replace(/[\\]/g, '\\\\').replace(/[:]/g, '\\:');
  } else {
    return text;
  }
}

function identityToString(identity, includeKeys, separator, order) {
  if (typeof(identity) === 'undefined') {
    return null;
  }
  separator = separator || '/';
  var keys = Object.keys(identity);
  if (typeof(order) === 'function') {
    keys.sort(order);
  } else {
    keys.sort();
  }
  return keys.map(function (key) {
    return includeKeys ? (escapeIdentityText(key) + ':' + escapeIdentityText(identity[key])) : identity[key];
  }).join(separator);
}

function identityEqual(identity1, identity2) {
  return identityToString(identity1, true) === identityToString(identity2, true);
}

function flatten(props, separator, name) {
  separator = separator || '.';
  var prefix = name ? name + separator : '';
  var val = {};
  Object.keys(props).forEach(function (key) {
    if (key.indexOf(prefix) !== 0) {
      return;
    }
    var path = key.substring(prefix.length);
    var target = val;
    var parts = path.split(separator);
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]]) {
        target[parts[i]] = {};
      }
      target = target[parts[i]];
    }
    target[parts[i]] = props[key].value;
  });
  return val;
}

function propEqual(lhs, rhs) {
  if (lhs.value !== rhs.value) {
    return false;
  }
  for (var i = 0; i < lhs.underlying.length; i++) {
    var lhsUnderlying = lhs.underlying[i];
    var rhsUnderlying = rhs.underlying[i] || {};
    if (lhsUnderlying.value !== rhsUnderlying.value || !identityEqual(lhsUnderlying.parent, rhsUnderlying.parent)) {
      return false;
    }
  }
  return true;
}

module.exports = {
  flatten: flatten,
  propEqual: propEqual,
  identityToString: identityToString,
  identityEqual: identityEqual
};

},{}],52:[function(require,module,exports){
'use strict';

var propEqual = require('./helpers').propEqual;

var UpdateType = {
  Added: 'Added',
  Changed: 'Changed',
  Removed: 'Removed'
};

var Model = function (bus, separator) {
  this.bus = bus;
  this.root = new ViewModel(this, '', separator || '.');
  this.views = {};
};

var ViewModel = function (model, path, separator) {
  var self = this;
  self.model = model;
  self.props = {};
  self.separator = separator || model.separator;
  self.path = path;
};

ViewModel.prototype.getViewModel = function (name, separator) {
  var path = this.path + name + (separator ? separator : '.');
  var model = this.model;
  if (path === '') {
    return model.root;
  }
  if (!model.views[path]) {
    var bestParent = '';
    // fill subview references and choose best parent props to copy from.
    Object.keys(model.views).forEach(function (key) {
      if (path.indexOf(key) === 0) {
        if (bestParent.length < key.length) {
          bestParent = key;
        }
        // keep subviews sorted.
        var subviews = model.views[key].subviews;
        for (var i = 0; i < subviews.length; i++) {
          if (subviews[i].indexOf(path)) {
            subviews.splice(i, 0, path);
            return;
          }
        }
        subviews.push(path);
      }
    });
    var viewModel = new ViewModel(model, path, separator);

    var parentProps = bestParent === '' ? model.root.props : model.views[bestParent].model.props;
    Object.keys(parentProps).forEach(function (key) {
      var prop = parentProps[key];
      if (prop.name.indexOf(path) === 0) {
        var name = prop.name.substring(path.length);
        viewModel.props[name] = prop;
      }
    });

    model.views[path] = {
      subviews: [],
      model: viewModel
    };
  }
  return model.views[path].model;
};

ViewModel.prototype.on = function (callback, scope) {
  return this.model.on(this.path, callback, scope);
};

Model.prototype.on = function (path, callback, scope) {
  var type = updateTypeForPath(path);
  return this.bus.on(type, false, callback, scope);
};

Model.prototype.applySnapshot = function (snapshot, isSnapshot) {
  isSnapshot = typeof isSnapshot === 'undefined' ? true : isSnapshot;

  var updates = toUpdates(isSnapshot ? {} : this.root.props, snapshot.props);
  applyUpdatesAndEmitEvents(this, updates, isSnapshot);
};

function updateTypeForPath(path) {
  var type = 'update';
  if (path !== '') {
    type = type + '|' + path;
  }
  return type;
}

// shallow copy
function cloneUpdateForPath(update, path) {
  var clone = {
    type: update.type,
    name: update.name.substring(path.length)
  };

  switch (update.type) {
    case UpdateType.Changed:
      clone.oldValue = update.oldValue;
      /* falls through */
    case UpdateType.Added:
      clone.value = update.value;
      break;
    case UpdateType.Removed:
      /* falls through */
    default:
      break;
  }
  return clone;
}

function applyUpdatesAndEmitEvents(model, updates, isSnapshot) {
  var views = Object.keys(model.views);
  var effectiveUpdates = {
    '': updates
  };
  if (views.length > 0) {
    // sort views for prefix search
    if (views.length > 1) {
      views.sort();
    }
    updates.forEach(function (update) {
      for (var i = 0; i < views.length; views++) {
        if (update.name.indexOf(views[i]) === 0) {
          break;
        }
      }
      var view = views[i];
      if (typeof view === 'undefined') {
        return;
      }
      effectiveUpdates[view].push(cloneUpdateForPath(update, view));
    });
  }

  var affectedPaths = Object.keys(effectiveUpdates);
  if (affectedPaths.length > 1) {
    affectedPaths.sort();
  }
  affectedPaths.forEach(function (path) {
    var viewModel = path === '' ? model.root : model.views[path].model;
    if (isSnapshot) {
      viewModel.props = {};
    }
    effectiveUpdates[path].forEach(function (update) {
      switch (update.type) {
        case UpdateType.Added:
          // fall-through
        case UpdateType.Changed:
          // changed works even for missing properties
          viewModel.props[update.name] = update.value;
          break;
        case UpdateType.Removed:
          delete viewModel.props[update.name];
          break;
        default:
          // do nothing
          break;
      }
    });
  });
  affectedPaths.forEach(function (path) {
    var type = updateTypeForPath(path);
    model.bus.emit(type, isSnapshot, updates);
  });
}
Model.prototype.applyUpdates = function (updates) {
  applyUpdatesAndEmitEvents(this, updates, false);
};

function toUpdates(image, snapshot) {
  snapshot = snapshot || {};
  var updates = [];
  var toDelete = Object.keys(image);
  Object.keys(snapshot).forEach(function (key) {
    var update = {};
    if (typeof image[key] === 'undefined') {
      update.type = UpdateType.Added;
    } else {
      if (!propEqual(image[key], snapshot[key])) {
        update.type = UpdateType.Changed;
        update.oldValue = image[key];
      }
      for (var i = 0; i < toDelete.length; toDelete++) {
        if (toDelete[i] === key) {
          break;
        }
      }
      if (typeof toDelete[i] !== 'undefined') {
        toDelete.splice(i, 1);
      }
    }
    if (update.type) {
      update.value = snapshot[key];
      update.name = key;
      updates.push(update);
    }
  });
  toDelete.forEach(function (key) {
    updates.push({
      type: UpdateType.Removed,
      name: key
    });
  });
  return updates;
}

module.exports = Model;

},{"./helpers":51}],53:[function(require,module,exports){
'use strict';
var flatten = require('./helpers').flatten;

var Props = function (model) {
  var prop = function (name) {
    return model.props[name];
  };
  var val = function val(name) {
    if (typeof name === 'undefined' || typeof model.props[name] === 'undefined') {
      return flatten(model.props, model.separator, name);
    }
    return model.props[name].value;
  };

  var props = function (section, separator) {
    section = section || '';
    if (section === '') {
      // TODO: support separator change for '' (same) section.
      return self;
    }
    separator = separator || model.separator;
    return new Props(model.getViewModel(section, separator));
  };
  var forEach = function (callback, scope) {
    Object.keys(model.props).forEach(function (key) {
      callback.call(scope, model.props[key]);
    });
  };
  var onUpdate = function (callback, scope) {
    model.on(callback, scope);
  };
  var self = {
    prop: prop,
    val: val,
    props: props,
    forEach: forEach,
    onUpdate: onUpdate
  };
  return self;
};

module.exports = Props;

},{"./helpers":51}],54:[function(require,module,exports){
'use strict';

var uuid = function () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};
var isFunction = function (value) {
  if (value === undefined || value === null) {
    return false;
  }
  return typeof value === 'function';
};

var isString = function (value) {
  return typeof value === 'string';
};

var levels = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
};
var log = function (level, args) {
  if (console) {
    var logger = console[level];
    if (isFunction(logger)) {
      var now = new Date();
      [].splice.call(args, 0, 0, now.getHours() + ':' + now.getMinutes() + ':' + now.getSeconds());
      logger.apply(console, args);
    }
  }
};
var info = function () {
  log(levels.info, arguments);
};

var warn = function () {
  log(levels.warn, arguments);
};

var debug = function () {
  log(levels.debug, arguments);
};

module.exports = {
  uuid: uuid,
  isFunction: isFunction,
  isString: isString,
  log: log,
  warn: warn,
  info: info,
  debug: debug
};

},{}],55:[function(require,module,exports){
(function (global){
var connection = function (settings, custom_connection){
	settings = settings||{};
	//The message handlers that have to be executed for each received message
	var message_handlers = {};
	
	var ids = 0;
	
	var connection = {
		//Executes appropriate message handlers for the message type.
		_handle_message: function (message){
			 //Retrieve handlers for the message type
			 var handlers = message_handlers[message.type];
			 if(handlers !==undefined){
				 //Execute them
				 Object.keys(handlers).forEach(function(handler_id){
					var handler = handlers[handler_id];
					if(handler!==undefined){handler(message.message);}
				 });
			 }
		},
		//Attaches a handler
		on: function(product, type, message_handler){
		   if(message_handlers[type] === undefined){message_handlers[type] = {};}
		   var id = ids++;
		   message_handlers[type][id]= message_handler;
		   return {type:type, id:id};
		},
		
		//Remove a handler 
		off: function(info){
			delete message_handlers[info.type][info.id];
		},
		//Dummy functions for transports that are always connected
		connected:function(a){a();},
		disconnected:function(){},
		version: "1.3.1"
	};

	function create_custom_connection(connection){
		connection.send = function(product, type, message){
			custom_connection.publish({type:type, message:message});
		};
		custom_connection.subscribe(connection._handle_message);
		return connection;
	}

	if(settings.websocket_url!==undefined){
		return require("./ws")(connection, settings);
  }else if(settings.http_url !== undefined){
    return require("./http")(connection, settings);
  }else if(global.fin !==undefined){
		return require("./fin")(connection, settings);
	}else if(custom_connection!==undefined){
		return create_custom_connection(connection, settings);
	//Connect via HTML Container facade
	}else if (global.htmlContainer!==undefined){
		return require("./cont")(connection, settings);
	}else {
		throw "No connection. Make sure you are running the application from OpenFin, or Tick42 HTML Container or fill the 'connection.websocket_url' property.";
	}
};

if(global.tick42===undefined){global.tick42 = {};}
global.tick42.connection = connection;

module.exports = connection;


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./cont":56,"./fin":57,"./http":58,"./ws":59}],56:[function(require,module,exports){
(function (global){
module.exports = function(connection){
	var connection_id =  Math.floor(1e10 * Math.random()).toString();
	//Route messages to facade(s)
	connection.send = function (product, type, message){
		if(product ==="metrics"){
			global.htmlContainer.metricsFacade.send(type, JSON.stringify(message));
		}else if(product ==="log"){
			global.htmlContainer.loggingFacade.send(type, JSON.stringify(message));
		}else if (product == "appconfig") {
            global.htmlContainer.appConfigFacade.send(type, JSON.stringify(message), connection_id);
        }
	};
	if (global.htmlContainer.appConfigFacade !== undefined) {
        global.htmlContainer.appConfigFacade.initConnection(
            connection_id,
            function (messageAsJson) {
                return connection._handle_message(JSON.parse(messageAsJson));
            });
    }
	global.connections = global.connections||{}; 
	//Expose function for sending messages:
	global.connections['connection'+connection_id] = connection._handle_message;

	return connection;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],57:[function(require,module,exports){
(function (global){
module.exports = function(connection, settings){
	if(global.console!==undefined&& settings.debug===true){
		console.log("Attemping to connect to Gateway via OpenFin Inter Application Bus.");
	}

	//A function for sending a message 
	connection.send = function(product, type, message){
		fin.desktop.InterApplicationBus.publish("AGM", {type:type, message:message});
	};
	//A function that receives messages
	fin.desktop.InterApplicationBus.subscribe('*','AGM', connection._handle_message);
	if(global.console!==undefined&& settings.debug===true){
		console.log("Connected to OpenFin transport.");
	}
	
	return connection;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],58:[function(require,module,exports){
(function (global){
module.exports = function (connection, settings) {
  var url = settings.http_url;
  // polling interval in ms, default is 1 second
  var interval = settings.http_interval_ms;
  if (!interval) interval = 1000;

  function log_debug(message) {
    if (global.console !== undefined && (settings.debug === true || settings.trace === true)) {
      console.log(message);
    }
  }

  function log_trace(message) {
    if (global.console !== undefined && settings.trace === true) {
      console.log(message);
    }
  }

  log_debug("Attemping to connect to Gateway via HTTP with url '" + url + "' and polling interval " + interval + " ms");

  poll(url, interval, 0, function (items) {
    for (var index = 0; index < items.length; index++) {
      connection._handle_message(items[index]);
    }
  });

  connection.send = function (product, type, message, id) {
    var msg = JSON.stringify({ type: type, message: message, id: id });
    http_post(url, msg);
  };

  /**
   * Polls data from a given url on some interval
   * @param url       Base server url. A sequence url param may be added based on the seq param
   * @param interval  Interval (in ms) between polling requestts
   * @param seq       Next sequence number we should ask for (if 0 the server will return the last known message)
   * @param ondata    Data callback    
   */
  function poll(url, interval, seq, ondata) {
    // construct the get Url - if seq != 0 add as url param to get 
    // only messages after this sequence
    var getUrl = url;

    if (seq !== 0) {
      getUrl = url + "?sequence=" + seq + "&no-cache=" + new Date().getTime();
    }    
        
    // create a request    
    var xmlhttp = createCORSRequest("GET", getUrl, function () {
      if (seq === 0){
        log_debug("Connected to Gateway on " + url);
      }
      log_trace("Response from '" + getUrl + "' is " + xmlhttp.responseText);
      var message = JSON.parse(xmlhttp.responseText);
      // the server returns the number of the next sequence that we must query for
      var nextSeq = message.nextSequence;
      // call user callbacke    
      ondata(message.data);
      // re-schedule
      setTimeout(function () {
        poll(url, interval, nextSeq, ondata);
      }, interval);
    });

    xmlhttp.onerror = function (ev) {
      console.log("Error polling data from http server '" + getUrl + "' - " + ev);
      // re-schedule
      setTimeout(function () {
        poll(url, interval, seq, ondata);
      }, interval);
    };

    log_trace("Sending GET to '" + getUrl + "'");
    xmlhttp.send();
  }

  /** 
   * POSTs a message to a given url 
   */
  function http_post(url, message) {
    // create a request    
    var xmlhttp = createCORSRequest("POST", url);
    log_trace("Sending POST to '" + url + "' : " + message);
    xmlhttp.send(message);
  }

  /** 
   * Creates CORS request (cross domain requests) for different browsers - XMLHttpRequest withCredentials
   * for Chrome and FF and XDomainRequest for IE
   */
  function createCORSRequest(method, url, result_callback) {
    var xhr = new XMLHttpRequest();    
    
    if ("withCredentials" in xhr) {
      // Check if the XMLHttpRequest object has a "withCredentials" property.
      // "withCredentials" only exists on XMLHTTPRequest2 objects.
      xhr.open(method, url, true);
      if (typeof result_callback !== "undefined"){
        xhr.onreadystatechange = function () {
          if (xhr.readyState == 4 && xhr.status == 200) {
            result_callback();
          }
        };
      }
    } else if (typeof XDomainRequest != "undefined") {
      // Otherwise, check if XDomainRequest.
      // XDomainRequest only exists in IE, and is IE's way of making CORS requests.
      xhr = new XDomainRequest();
      xhr.open(method, url);
      if (typeof result_callback !== "undefined"){
        xhr.onload = result_callback;
      }
    } else {
      // Otherwise, CORS is not supported by the browser.
      xhr = null;
    }
    return xhr;
  }
 
  return connection;
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],59:[function(require,module,exports){
(function (global){
module.exports = function(connection, settings){
	var connected = false;
	
	//Load the 'ws' library, but only if we are running under node js
	var WebSocket = require("detect-node")?require("ws"):global.WebSocket;
	
	function initiate_socket(){
		if(global.console!==undefined&& settings.debug===true){
			console.log("Attemping to connect to Gateway via WebSocket.");
		}

		var ws = new WebSocket(settings.websocket_url);
		//Add user callbacks
		ws.onclose = function(event){
			if(typeof settings.disconnected==="function"){settings.disconnected(settings.websocket_url, event);}
			connected = false;
		};
		//Log on connection
		ws.onopen = function(){
			if(typeof settings.connected==="function"){settings.connected(settings.websocket_url);}
			if(global.console!==undefined && settings.debug===true){
				console.log("Connected to WS URL "+settings.websocket_url);
			}
			connected = true;
		};
		//Attach handler
		ws.onmessage = function(message){
			connection._handle_message(JSON.parse(message.data));
		};
		return ws;
	}
	
	//Initiate a new socket (this gets re-executed on reconnect)
	var socket = initiate_socket();
	
	//Create a function for sending a message
	connection.send = function(product, type, message, id){
		//If we are connected send the message
		if(socket.readyState ===1){
			socket.send(JSON.stringify({type:type, message:message, id:id}));
		//If we are not connected and we are not attempting to connect right now, attempt to connect
		}else if (socket.readyState !==0){
			socket = initiate_socket();
		}
	};
	connection.websocket_url = function(a){
		settings.websocket_url = a;
		socket.close();
		socket = initiate_socket();
	};
	
	connection.connected = function(a){
		if(connected){a(settings.websocket_url);}
		settings.connected = a;
	};
	connection.disconnected = function(a){
		settings.disconnected = a;
	};
	
	return connection;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"detect-node":5,"ws":79}],60:[function(require,module,exports){
var asciiTable = require("ascii-table");
var tick42Connection = require("tick42-gateway-connection");

var levels = [ 'trace', 'debug', 'info', 'warn', 'error', 'off' ];

function serializePath(path) {
	return path.length === 0 ? "" : path.join(".");
}

var isConnection = function(c) {
	return typeof c === "object" && typeof c.send === "function" && typeof c.on === "function";
};

function getLevel(logger, level) {
	//Retrieves the console or publish level of a logger
	//logger - the logger for which to retrieve the level
	//level - a string which can either be "publishLevel" for retrieving the publish level or "c_level" for retrieving the console level.
	if (logger[level] !== undefined) {
		return logger[level];
	} else if (logger.parent !== undefined) {
		return getLevel(logger.parent, level);
	}
}

function messageToTable(title, rows) {
	//Display message as table in file
	var keys = getAllKeys(rows);
	//fill rows with message properties
	var tableRows = rows.map(function (obj) {
		return keys.map(function (key) {
			return obj[key];
		});
	});

	var table_message = asciiTable.factory({
		title: title,
		heading: keys,
		rows: tableRows
	});
	return table_message.toString();
}

function getAllKeys(data) {
	//Accepts an array of objects and returns an array of all the keys from all objects
	var allKeys = [];

	data.forEach(function (obj) {
		Object.keys(obj).forEach(function (key) {
			if (allKeys.indexOf(key) === -1) {
				allKeys.push(key);
			}
		});
	});
	return allKeys;
}

function logger(configuration) {
	if (typeof configuration.connection !== "object") {
		configuration.connection = {};
	}

	//Set debug for the connection module if global debug is set
	configuration.connection.debug = configuration.debug;

	//Init connection
	//Determine if we are given a ready 'connection' object or a configuration.
	var connection = isConnection(configuration.connection) ? configuration.connection : tick42Connection(configuration.connection);

	var idKeys = ["system", "service", "instance"];

	//Convert instance to string, throw exceptions if it is not full
	var instance_str = idKeys.map(function (key) {
		var prop = configuration.identity[key];
		if (typeof prop !== "string") {
			throw 'Please specify "' + key + '" in your identity';
		}
		return prop;
	}).join("/");

	var loggerProto = {
		subLogger: function (name) {
			//Check if the sublogger is already created
			var existingSublogger = this.subloggers.filter(function (subLogger) {
				return subLogger.name === name;
			})[0];

			if (existingSublogger !== undefined) {
				return existingSublogger;
			}

			//Check if the name isn't the same as one of the parent properties
			Object.keys(this).forEach(function (key) {
				if (key === name) {
					throw 'This sub logger name is not allowed.';
				}
			});
			//Check if the name isn't the same as one of the parent methods
			Object.keys(loggerProto).forEach(function (key) {
				if (key === name) {
					throw 'This sub logger name is not allowed.';
				}
			});

			var path = this.path.slice(0);
			path.push(this.name);
			return createLogger(name, path, this);
		},

		publishLevel: function (level) {
			if (level !== null && level !== undefined) {
				this._publishLevel = level;
			}
			return getLevel(this, "_publishLevel");
		},

		consoleLevel: function (level) {
			if (level !== null && level !== undefined) {
				this._consoleLevel = level;
			}
			return getLevel(this, "_consoleLevel");
		},

		metricsLevel: function (level, metricsSystem) {
			if (level !== null && level !== undefined) {
				this._metricLevel = level;
			}

			if (metricsSystem !== undefined) {
				if (typeof metricsSystem === "object" && typeof metricsSystem.objectMetric === "function") {
					this.metricSystem = metricsSystem;
				} else {
					throw "Please specify metric system ";
				}
			}
		},

		table: function (message) {
			//message must be in an array, to be displayed as table
			if (!Array.isArray(message)) {
				throw 'The message must be in an array';
			}

			//Retrieve logger name and levels
			var loggerName = getLoggerName(this);

			//Publish in console
			if (shouldPublish(getLevel(this, '_consoleLevel'), 'info')) {
				console.info(loggerName + ':');
				console.table(message);
			}
			//Publish in file
			if (shouldPublish(getLevel(this, '_publishLevel'), 'info')) {
				connection.send('log', 'LogMessage', {
					instance: instance_str,
					level: levels.indexOf('info'),
					logger: loggerName,
					message: messageToTable(loggerName, message)
				});
			}
		},

		log: function (message, level) {
			publishMessage(this, level || "info", message);
		}
	};

	function createLogger(name, path, parent) {
		var logger = Object.create(loggerProto);
		logger.name = name;
		logger.path = path;
		logger.subloggers = [];
		logger.parent = parent;
		if (parent !== undefined) {
			//add sublogger to subloggers array
			parent.subloggers.push(logger);
			//add easy access to sublogger
			parent[logger.name] = logger;
			//create metric system
			if (parent.metricSystem !== undefined) {
				logger.metricsLevel('warn', parent.metricSystem.subSystem(logger.name));
			}
		}
		levels.forEach(function (level) {
			logger[level] = function (message) {
				publishMessage(logger, level, message);
			};
		});

		logger.off = function(){};

		logger.version = "2.0.3";

		return logger;
	}

	function publishMessage(logger, level, message) {
		//Retrieve logger name and levels
		var logger_name = getLoggerName(logger);

		//Add stack trace if the message is an error
		if (level === 'error') {
			var e = new Error();
			if (e.stack) {
				message = message + "\n" + (e.stack.split("\n").slice(3).join("\n"));
			}
		}

		//Publish in console
		if (shouldPublish(getLevel(logger, '_consoleLevel'), level)) {
			console[level](logger_name + ": " + message);
		}
		//Publish in file
		if (shouldPublish(getLevel(logger, '_publishLevel'), level)) {
			connection.send('log', 'LogMessage', {
				instance: instance_str,
				level: levels.indexOf(level),
				logger: logger_name,
				message: message
			});
		}

		//Publish in metrics
		if (shouldPublish(getLevel(logger, '_metricLevel'), level)) {
			if (logger.metricSystem !== undefined) {
				logger.metricSystem.objectMetric('LogMessage', {
					Time: new Date(),
					Logger: logger_name,
					Level: level,
					Message: message
				});

				if (level == 'error'){
					logger.metricSystem.setState(100, message);
				}
			}
		}
	}

	var shouldPublish = function (publishLevel, messageLevel) {
		return (!publishLevel || levels.indexOf(publishLevel) <= levels.indexOf(messageLevel));
	};

	var getLoggerName = function (logger) {
		var loggerPathAndName = logger.path.slice();
		loggerPathAndName.push(logger.name);
		return "[" + serializePath(loggerPathAndName) + "]";
	};

	var mainLogger = createLogger("main", [], undefined);
	mainLogger.publishLevel("warn");
	mainLogger.consoleLevel("info");
	mainLogger.metricsLevel("warn");

	return mainLogger;
}

if (typeof window !== 'undefined') {
	window.tick42 = window.tick42 || {};
	window.tick42.log = logger;
}

module.exports = logger;

},{"ascii-table":3,"tick42-gateway-connection":55}],61:[function(require,module,exports){
"use strict";
var objectMetric_1 = require("../metrics/objectMetric");
var stringMetric_1 = require("../metrics/stringMetric");
var numberMetric_1 = require("../metrics/numberMetric");
var timestampMetric_1 = require("../metrics/timestampMetric");
var MetricSerializer = (function () {
    function MetricSerializer() {
    }
    MetricSerializer.metricToMessage = function (metric) {
        var def = MetricSerializer._getMetricDefinition(metric.name, metric.value, metric.path, metric.type, metric.description, metric.period, metric.resolution);
        return {
            id: metric.id,
            instance: metric.repo.instance,
            definition: def,
            value: MetricSerializer._serializeValue(metric.value, metric),
        };
    };
    MetricSerializer._getMetricDefinition = function (name, value, path, type, description, resolution, period) {
        var def = {
            name: name,
            description: description,
            type: type ? type : MetricSerializer._getTypeFromValue(value),
            path: path,
            resolution: resolution,
            period: period
        };
        if (def.type === objectMetric_1.ObjectMetric.type) {
            def.Composite = Object.keys(value).reduce(function (arr, key) {
                var val = value[key];
                arr.push(MetricSerializer._getMetricDefinition(key, val, path));
                return arr;
            }, []);
        }
        return def;
    };
    MetricSerializer._serializeValue = function (value, metric) {
        if (value && value.constructor === Date) {
            return {
                value: {
                    type: this._valueTypes.indexOf("date"),
                    value: value.valueOf(),
                    isArray: false
                }
            };
        }
        else if (typeof value === "object") {
            return {
                CompositeValue: Object.keys(value).reduce(function (arr, key) {
                    var val = MetricSerializer._serializeValue(value[key]);
                    val.InnerMetricName = key;
                    arr.push(val);
                    return arr;
                }, [])
            };
        }
        else {
            var valueType = metric ? metric.getValueType() : undefined;
            valueType = valueType | this._valueTypes.indexOf(typeof value);
            return { value: { type: valueType, value: value, isArray: false } };
        }
    };
    MetricSerializer._getTypeFromValue = function (value) {
        var typeAsString = value.constructor === Date ? 'timestamp' : typeof value;
        switch (typeAsString) {
            case 'string':
                return stringMetric_1.StringMetric.type;
            case 'number':
                return numberMetric_1.NumberMetric.type;
            case 'timestamp':
                return timestampMetric_1.TimestampMetric.type;
            case 'object':
                return objectMetric_1.ObjectMetric.type;
        }
        return 0;
    };
    MetricSerializer._valueTypes = [
        "boolean",
        "int",
        "number",
        "long",
        "string",
        "date",
        "object"];
    return MetricSerializer;
}());
exports.MetricSerializer = MetricSerializer;

},{"../metrics/numberMetric":66,"../metrics/objectMetric":67,"../metrics/stringMetric":70,"../metrics/timestampMetric":72}],62:[function(require,module,exports){
"use strict";
var metricSerializer_1 = require("./metricSerializer");
var MetricsBridge = (function () {
    function MetricsBridge(repo, connection) {
        var _this = this;
        this._repo = repo;
        this._connection = connection;
        connection.on('metrics', "MetricsSnapshotRequest", function (instanceInfo) {
            if (instanceInfo.Instance !== repo.instance) {
                return;
            }
            _this.sendFull(_this._repo);
        });
    }
    MetricsBridge.prototype.sendFull = function (repo) {
        var rootSystem = repo.root;
        if (!rootSystem) {
            return;
        }
        if (rootSystem.subSystems.length == 0) {
            return;
        }
        this.sendFullSystem(rootSystem);
    };
    MetricsBridge.prototype.sendFullSystem = function (s) {
        var _this = this;
        this.createSystem(s);
        s.subSystems.forEach(function (sub) {
            _this.sendFullSystem((sub));
        });
        s.metrics.forEach(function (m) {
            _this.createMetric(m);
        });
    };
    MetricsBridge.prototype.createMetric = function (metric) {
        this._send("CreateMetric", metricSerializer_1.MetricSerializer.metricToMessage(metric));
    };
    MetricsBridge.prototype.updateMetric = function (metric) {
        this._send("UpdateMetric", metricSerializer_1.MetricSerializer.metricToMessage(metric));
    };
    MetricsBridge.prototype.createSystem = function (system) {
        if (system.parent !== undefined) {
            this._send("CreateMetricSystem", {
                id: system.id,
                instance: system.repo.instance,
                definition: { name: system.name, description: system.description, path: system.path }
            });
        }
    };
    MetricsBridge.prototype.updateSystem = function (system, state) {
        this._send("UpdateMetricSystem", {
            id: system.id,
            instance: system.repo.instance,
            state: state
        });
    };
    MetricsBridge.prototype.heartbeat = function (repo, interval) {
        this._send("HeartbeatMetrics", { publishingInterval: interval, instance: repo.instance });
    };
    MetricsBridge.prototype._send = function (type, message) {
        this._connection.send("metrics", type, message);
    };
    return MetricsBridge;
}());
exports.MetricsBridge = MetricsBridge;

},{"./metricSerializer":61}],63:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var AddressMetric = (function (_super) {
    __extends(AddressMetric, _super);
    function AddressMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, AddressMetric.type, value || '');
    }
    AddressMetric.type = 8;
    return AddressMetric;
}(metric_1.Metric));
exports.AddressMetric = AddressMetric;

},{"./metric":65}],64:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var CountMetric = (function (_super) {
    __extends(CountMetric, _super);
    function CountMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, CountMetric.type, value || 0);
    }
    CountMetric.prototype.increment = function () {
        this.incrementBy(1);
    };
    CountMetric.prototype.decrement = function () {
        this.decrementBy(1);
    };
    CountMetric.prototype.incrementBy = function (n) {
        this.update((this.value || 0) + n);
    };
    CountMetric.prototype.decrementBy = function (n) {
        this.update((this.value || 0) - n);
    };
    CountMetric.prototype.getValueType = function () {
        return 3;
    };
    CountMetric.type = 3;
    return CountMetric;
}(metric_1.Metric));
exports.CountMetric = CountMetric;

},{"./metric":65}],65:[function(require,module,exports){
"use strict";
var Metric = (function () {
    function Metric(def, parent, transport, type, value) {
        this.name = def.name;
        this.description = def.description;
        this.period = def.period;
        this.resolution = def.resolution;
        this.system = parent;
        this.repo = parent.repo;
        this.id = parent.path + "/" + this.name;
        this.value = value;
        this.type = type;
        this.path = parent.path.slice(0);
        this.path.push(parent.name);
        this._transport = transport;
        this._transport.createMetric(this);
    }
    Metric.prototype.update = function (value) {
        this.value = value;
        this._transport.updateMetric(this);
    };
    Metric.prototype.getValueType = function () {
        return undefined;
    };
    Metric.type = 0;
    return Metric;
}());
exports.Metric = Metric;

},{}],66:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var NumberMetric = (function (_super) {
    __extends(NumberMetric, _super);
    function NumberMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, NumberMetric.type, value || 0);
    }
    NumberMetric.prototype.increment = function () {
        this.incrementBy(1);
    };
    NumberMetric.prototype.decrement = function () {
        this.decrementBy(1);
    };
    NumberMetric.prototype.incrementBy = function (n) {
        this.update((this.value || 0) + n);
    };
    NumberMetric.prototype.decrementBy = function (n) {
        this.update((this.value || 0) - n);
    };
    NumberMetric.type = 2;
    return NumberMetric;
}(metric_1.Metric));
exports.NumberMetric = NumberMetric;

},{"./metric":65}],67:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var ObjectMetric = (function (_super) {
    __extends(ObjectMetric, _super);
    function ObjectMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, ObjectMetric.type, value);
    }
    ObjectMetric.prototype.update = function (value) {
        _super.prototype.update.call(this, value);
    };
    ObjectMetric.type = 11;
    return ObjectMetric;
}(metric_1.Metric));
exports.ObjectMetric = ObjectMetric;

},{"./metric":65}],68:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var RateMetric = (function (_super) {
    __extends(RateMetric, _super);
    function RateMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, RateMetric.type, value || 0);
    }
    RateMetric.type = 4;
    return RateMetric;
}(metric_1.Metric));
exports.RateMetric = RateMetric;

},{"./metric":65}],69:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var StatisticsMetric = (function (_super) {
    __extends(StatisticsMetric, _super);
    function StatisticsMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, StatisticsMetric.type, value || 0);
    }
    StatisticsMetric.type = 6;
    return StatisticsMetric;
}(metric_1.Metric));
exports.StatisticsMetric = StatisticsMetric;

},{"./metric":65}],70:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var StringMetric = (function (_super) {
    __extends(StringMetric, _super);
    function StringMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, StringMetric.type, value || '');
    }
    StringMetric.type = 1;
    return StringMetric;
}(metric_1.Metric));
exports.StringMetric = StringMetric;

},{"./metric":65}],71:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var TimespanMetric = (function (_super) {
    __extends(TimespanMetric, _super);
    function TimespanMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, TimespanMetric.type, value || false);
    }
    TimespanMetric.prototype.start = function () {
        this.update(true);
    };
    TimespanMetric.prototype.stop = function () {
        this.update(false);
    };
    TimespanMetric.type = 10;
    return TimespanMetric;
}(metric_1.Metric));
exports.TimespanMetric = TimespanMetric;

},{"./metric":65}],72:[function(require,module,exports){
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var metric_1 = require("./metric");
var TimestampMetric = (function (_super) {
    __extends(TimestampMetric, _super);
    function TimestampMetric(def, parent, transport, value) {
        _super.call(this, def, parent, transport, TimestampMetric.type, value || new Date());
    }
    TimestampMetric.prototype.now = function () {
        this.update(new Date());
    };
    TimestampMetric.type = 7;
    return TimestampMetric;
}(metric_1.Metric));
exports.TimestampMetric = TimestampMetric;

},{"./metric":65}],73:[function(require,module,exports){
"use strict";
var system_1 = require("./system");
var transport_1 = require("./bridge/transport");
var Repository = (function () {
    function Repository(config) {
        this._config = config;
        this._transport = new transport_1.MetricsBridge(this, config.connection);
        this.instance = config.identity.system + '/' + config.identity.service + '/' + config.identity.instance;
        this.identity = config.identity;
        this._startHeartbeating();
        this.root = new system_1.System('', this, this._transport);
        this._initSystemMetrics(this.root, config.clickStream || config.clickStream === undefined);
    }
    Repository.prototype._startHeartbeating = function () {
        var _this = this;
        this._transport.heartbeat(this, this._config.settings.heartbeatInterval);
        setInterval(function () {
            _this._transport.heartbeat(_this, _this._config.settings.heartbeatInterval);
        }, this._config.settings.heartbeatInterval);
    };
    Repository.prototype._initSystemMetrics = function (rootSystem, useClickStream) {
        if (typeof navigator !== 'undefined') {
            rootSystem.stringMetric('UserAgent', navigator.userAgent);
        }
        if (useClickStream && typeof document !== 'undefined') {
            var clickStream_1 = rootSystem.subSystem("ClickStream");
            var documentClickHandler = function (e) {
                if (!e.target) {
                    return;
                }
                clickStream_1.objectMetric("LastBrowserEvent", {
                    type: "click",
                    timestamp: new Date(),
                    target: {
                        className: e.target ? e.target.className : '',
                        id: e.target.id,
                        type: '<' + e.target.tagName.toLowerCase() + '>',
                        href: e.target.href || ""
                    }
                });
            };
            clickStream_1.objectMetric("Page", {
                title: document.title,
                page: window.location.href
            });
            if (document.addEventListener) {
                document.addEventListener('click', documentClickHandler);
            }
            else {
                document.attachEvent('onclick', documentClickHandler);
            }
        }
    };
    return Repository;
}());
exports.Repository = Repository;

},{"./bridge/transport":62,"./system":74}],74:[function(require,module,exports){
"use strict";
var numberMetric_1 = require("./metrics/numberMetric");
var timespanMetric_1 = require("./metrics/timespanMetric");
var stringMetric_1 = require("./metrics/stringMetric");
var addressMetric_1 = require("./metrics/addressMetric");
var objectMetric_1 = require("./metrics/objectMetric");
var timestampMetric_1 = require("./metrics/timestampMetric");
var countMetric_1 = require("./metrics/countMetric");
var statisticsMetric_1 = require("./metrics/statisticsMetric");
var rateMetric_1 = require("./metrics/rateMetric");
var System = (function () {
    function System(name, repo, transport, parent, description) {
        this.metrics = [];
        this.subSystems = [];
        this.name = name;
        this.description = description || '';
        this.repo = repo;
        this.parent = parent;
        this._transport = transport;
        this.path = this._buildPath(this.parent);
        this.id = (this.path.length > 0 ? this.path.join('/') + '/' : '') + this.name;
        this.identity = repo.identity;
        this.root = repo.root;
        this._transport.createSystem(this);
    }
    System.prototype.subSystem = function (name, description) {
        if (!name || name.length === 0) {
            throw new Error('name is required');
        }
        var matchingSystems = this.subSystems.filter(function (s) { return s.name === name; });
        if (matchingSystems.length > 0) {
            return matchingSystems[0];
        }
        var system = new System(name, this.repo, this._transport, this, description);
        this.subSystems.push(system);
        return system;
    };
    System.prototype.setState = function (state, description) {
        this._transport.updateSystem(this, { state: state, description: description });
    };
    System.prototype.stringMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, stringMetric_1.StringMetric.type, value, function (metricDef) {
            return new stringMetric_1.StringMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.numberMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, numberMetric_1.NumberMetric.type, value, function (metricDef) {
            return new numberMetric_1.NumberMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.countMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, countMetric_1.CountMetric.type, value, function (metricDef) {
            return new countMetric_1.CountMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.addressMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, addressMetric_1.AddressMetric.type, value, function (metricDef) {
            return new addressMetric_1.AddressMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.objectMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, objectMetric_1.ObjectMetric.type, value, function (metricDef) {
            return new objectMetric_1.ObjectMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.timespanMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, timespanMetric_1.TimespanMetric.type, value, function (metricDef) {
            return new timespanMetric_1.TimespanMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.timestampMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, timestampMetric_1.TimestampMetric.type, value, function (metricDef) {
            return new timestampMetric_1.TimestampMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.rateMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, rateMetric_1.RateMetric.type, value, function (metricDef) {
            return new rateMetric_1.RateMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype.statiticsMetric = function (definition, value) {
        var _this = this;
        return this._getOrCreateMetric(definition, statisticsMetric_1.StatisticsMetric.type, value, function (metricDef) {
            return new statisticsMetric_1.StatisticsMetric(metricDef, _this, _this._transport, value);
        });
    };
    System.prototype._unionToMetricDef = function (definition) {
        var metricDef;
        if (typeof definition === 'string') {
            metricDef = { name: definition };
        }
        else {
            metricDef = definition;
        }
        if (metricDef.name === undefined) {
            throw new Error('Metric name is required.');
        }
        return metricDef;
    };
    System.prototype._getOrCreateMetric = function (definition, expectedType, value, createFunc) {
        var metricDef = this._unionToMetricDef(definition);
        var matchingMetrics = this.metrics.filter(function (m) { return m.name === metricDef.name; });
        if (matchingMetrics.length > 0) {
            var existingMetric = matchingMetrics[0];
            if (existingMetric.type !== expectedType) {
                throw new Error('A metric named ' + metricDef.name + ' is already defined with different type');
            }
            if (typeof value !== 'undefined') {
                existingMetric.update(value);
            }
            return existingMetric;
        }
        var newMetric = createFunc(metricDef);
        this.metrics.push(newMetric);
        return newMetric;
    };
    System.prototype._buildPath = function (system) {
        if (!system || !system.parent) {
            return [];
        }
        var path = this._buildPath(system.parent);
        path.push(system.name);
        return path;
    };
    return System;
}());
exports.System = System;

},{"./metrics/addressMetric":63,"./metrics/countMetric":64,"./metrics/numberMetric":66,"./metrics/objectMetric":67,"./metrics/rateMetric":68,"./metrics/statisticsMetric":69,"./metrics/stringMetric":70,"./metrics/timespanMetric":71,"./metrics/timestampMetric":72}],75:[function(require,module,exports){
"use strict";
var repository_1 = require("./core/repository");
var tick42_gateway_connection_1 = require('tick42-gateway-connection');
var windowAsAny = typeof window === 'undefined' ? (new Object()) : window;
windowAsAny.tick42 = windowAsAny.tick42 || {};
windowAsAny.tick42.metrics = windowAsAny.tick42.metrics || function (config) {
    if (!config.identity) {
        throw new Error('Identity missing from metrics configuration');
    }
    if (!config.identity.service || typeof config.identity.service !== 'string') {
        throw new Error('Service missing or invalid in metrics identity configuration');
    }
    if (!config.identity.system || typeof config.identity.system !== 'string') {
        throw new Error('System missing or invalid in metrics identity configuration');
    }
    if (!config.identity.instance || typeof config.identity.instance !== 'string') {
        throw new Error('Instancemissing or invalid in metrics identity configuration');
    }
    config.settings = config.settings || {};
    config.settings.heartbeatInterval = config.settings.heartbeatInterval || 15000;
    if (typeof config.connection !== "object") {
        config.connection = {};
    }
    if (!(typeof config.connection === "object" && typeof config.connection.send === "function" && typeof config.connection.on === "function")) {
        config.connection = tick42_gateway_connection_1.connection(config.connection);
    }
    var repo = new repository_1.Repository(config);
    repo['version'] = repo.root['version'] = '2.0.13';
    return repo.root;
};
module.exports = windowAsAny.tick42.metrics;

},{"./core/repository":73,"tick42-gateway-connection":55}],76:[function(require,module,exports){
var windows = function (agm) {

	var deprecate = require('util-deprecate');
	if (agm.subscribe) {
		agm.serverMethodAdded(function (resp) {
			if ((resp.server.application.indexOf('HtmlContainer.') !== -1 && resp.server.application.indexOf('.Internal') !== -1) && resp.method.name.indexOf('T42.Wnd.WindowStateChanged') !== -1) {
				agm.subscribe("T42.Wnd.WindowStateChanged", {target: "all"}).then(function (stream) {
					stream.onData(function (streamData) {
						update_window(streamData.data, determinateCorrectContainer(streamData.server.application));
					});
					// attach callbacks
					//stream.on("end", handleStreamClosed);
					//stream.on("close", handleStreamClosed);
				});
			}
		});
	}
	//Store windows that are tracked by ID and receive updates
	var windows = {};

	function update_window(window_info, container_name) {

		var window_id = container_name + "." + window_info.windowName;

		var the_window = windows[window_id];

		if (the_window === undefined) {
			//If the user is subscribed for the global events, create the window object.
			if (get_callbacks(window_added_callbacks, container_name).length > 0 || get_callbacks(window_removed_callbacks, container_name).length > 0) {
				the_window = a_window_from(window_info.windowName, container_name, window_info.url, window_info.windowId, window_info.windowStyleAttributes,window_info.windowTitle);
			} else {
				return;
			}
		}

		if (the_window.id === undefined) {
			the_window.id = window_info.windowId;
			exec_callbacks(the_window.callbacks.on_available, the_window);
		}

		if (window_info.state === "TitleChanged") {
			the_window.title = window_info.windowTitle;
			exec_callbacks(the_window.callbacks.onTitleChanged, window_info.windowTitle);
		}

		if (the_window.url !== window_info.url) {
			the_window.url = window_info.url;
			exec_callbacks(the_window.callbacks.on_url_changed, window_info.url);
		}

		if (window_info.state === "Created") {
			//Execute global "window_added" callbacks
			exec_callbacks(get_callbacks(window_added_callbacks, container_name), the_window);
		}

		//Clear the window on close event
		if (window_info.state === "Closed") {
			//Execute global "window_removed" callbacks
			exec_callbacks(get_callbacks(window_removed_callbacks, container_name), the_window);
			//Execute window-specific "window_removed" callbacks
			exec_callbacks(the_window.callbacks.onClose);
			//Refresh the window object state
			the_window.id = undefined;
			the_window.callbacks = {};

			return;
		}

		//ButtonClicked
		if (window_info.state === "ButtonClicked") {
			//Execute global "window_added" callbacks
			if(the_window.buttons !== undefined && Object.keys(the_window.buttons).length !== 0){
				the_window.callbacks.onTabButton.forEach(function (callback) {
					callback(window_info.buttonId,the_window.buttons[window_info.buttonId].info);
				});
			}
		}
	}

	//Create a dictionary to store the callbacks for the method "window_added".
	var window_added_callbacks = {
		containers_callbacks: {},
		all_containers_callbacks: []
	};

	//Create a dictionary to store the callbacks for the method "window_removed".
	var window_removed_callbacks = {
		containers_callbacks: {},
		all_containers_callbacks: []
	};

	//Creates a new window object or returns an existing one
	//Accepts window name, container and URL
	//Returns a window object.

	//It is not guaranteed to return the window with the same URL and ID
	function a_window_from(name, container, url, id, windowStyles, title) {

		var window_id = determinateCorrectContainer(container) + "." + name;

		var existing_window = windows[window_id];

		if (existing_window !== undefined) {

			//If the window is closed, update the URL in the reference
			if (!existing_window.opened()) {
				existing_window.url = url;
			}
			return existing_window;
		} else {

			//Init object
			var window_obj = Object.create(window_proto);
			window_obj.name = name;
			window_obj.container = container;
			window_obj.url = url;
			window_obj.id = id;
			window_obj.callbacks = {};

			//Insert AGM server properties
			window_obj.application = window_id;

			//setting window title
			window_obj.title = title;

			//Adding windowStyleAttributes
			if (windowStyles !== undefined && typeof windowStyles !== 'object') {
				window_obj.windowStyleAttributes = JSON.parse(windowStyles);
			} else if (windowStyles !== undefined && typeof windowStyles === 'object') {
				window_obj.windowStyleAttributes = windowStyles;
			}
			else {
				window_obj.windowStyleAttributes = {};
			}

			//Init empty array for buttons
			window_obj.buttons = {};

			windows[window_id] = window_obj;

			return window_obj;
		}
	}

	//Binds a given window object to an actual window
	function bind_window(the_window, success, error) {

		//Typically the binding occurs when we receive an event, so we will retrieve some info about the window
		//and if it exists we will trigger an artificial event with it.

		//Check if the window isn't already bound
		if (the_window.id === undefined) {

			//checking for container
			var target = container_filter(the_window.container);
			if (target === undefined) {
				if (typeof error === "function") {
					error("No such container");
				}
			}

			//Retrieve window parameters
			agm.invoke("T42.Wnd.FindByName", {windowName: the_window.name}, target, {}, bind_from_info, error);

		} else {
			invoke_agm_success_callback(success, the_window);
		}
		return the_window;

		function bind_from_info(e) {
			//Retrieve window info (a bit hacky because the response format is weird)
			var window_info = vals(e.returned)[0];

			if (window_info === undefined) {
				if (typeof error === "function") {
					error("we cound not open/find this window");
				}
			} else {
				//Trigger an event
				window_info.state = "Attached";
				update_window(window_info, the_window.container);

				//Exec user callback
				invoke_agm_success_callback(success, the_window);
			}
		}
	}

	//Functions for opening, closing, resizing windows
	var window_proto = {

		open: function (dimensions, style, success, error) {

			//A wrapper for the standard AGM "open" function

			var the_window = this;

			//Init style objects if they are null
			dimensions = dimensions || {};
			style = style || {};

			//Take out the sticky-windows related properties from the style object

			var isSticky = style.isSticky;
			delete style.isSticky;

			var stickyGroup = style.stickyGroup;
			delete style.stickyGroup;
			delete style.hasMoveAreaThickness;
			delete style.hasSizeAreaThickness;

			//checking for container
			var target = container_filter(the_window.container);
			if (target === undefined) {
				if (typeof error === "function") {
					error("No such container");
				}
			}

			agm.invoke("T42.Html.CreateWindow",
				{
					//Window name and url
					windowName: the_window.name, url: the_window.url,
					//dimensions
					top: dimensions.top, left: dimensions.left, width: dimensions.width, height: dimensions.height,
					//Stickywindows - related props
					isSticky: isSticky, stickyGroup: stickyGroup,
					//Style attributes
					windowStyleAttributes: JSON.stringify(style)

				},
				target,
				{},
				opened,
				cannot_open);

			function opened(message) {
				//Add id to the current windows because the current HTML Container
				//doesn't support tracking the updates of the window
				if (message.returned !== undefined) {
					the_window.id = message.returned.id;
				}
				invoke_agm_success_callback(success, the_window);
			}

			function cannot_open(e) {
				//Call the error callback
				if (typeof error === "function") {
					error(e);
				}

				//Try to bind the returned object in case...
				bind_window(the_window);
			}

			return the_window;
		},

		setStyle: function (style, success, error) {
			return agm_action("T42.Wnd.SetWindowStyle").call(this, success, error, {windowStyleAttributes: JSON.stringify(style)});
		},

		opened: function () {
			return this.id !== undefined;
		},

		onAvailable: add_callback("on_available", function (the_window, callback) {
			if (the_window.opened()) {
				callback(the_window);
			}
		}),

		close: agm_action("T42.Wnd.Close"),

		collapse: agm_action("T42.Wnd.Collapse"),

		onClose: add_callback("onClose"),

		navigate: function (url, success, error) {
			return agm_action("T42.Html.OpenUrl").call(this, success, error, {url: url});
		},

		onUrlChanged: add_callback("onUrlChanged"),

		onTitleChanged: add_callback("onTitleChanged", function(the_window,callback){
			callback(the_window.title);
		}),

		focus: agm_action("T42.Wnd.Activate"),

		setTitle: function (title, success, error) {

			var target = container_filter(this.container);
			if (target === undefined) {
				if (typeof error !== 'function') {
					return;
				} else {
					error("No container");
				}
			}

			//Invoke the AGM method
			agm.invoke("T42.Wnd.SetWindowTitle", {
				windowId: this.id,
				title: title
			}, target, {}, title_is_set.bind(this), title_cannot_be_set);

			function title_is_set() {
				invoke_agm_success_callback(success, this);
			}

			function title_cannot_be_set(e) {
				invoke_agm_error_callback(error, e);
			}
		},

		getDetails: function (success, error) {
			var window_id = this.id;

			var target = container_filter(this.container);
			if (target === undefined) {
				if (typeof error !== 'function') {
					return;
				} else {
					error("No container");
				}
			}

			agm.invoke("T42.Wnd.FindById", {windowId: this.id}, target, {}, returned_dimensions, cannot_return_dimensions);

			function returned_dimensions(value) {
				invoke_agm_success_callback(success, value.returned[window_id]);
			}

			function cannot_return_dimensions(e) {
				invoke_agm_error_callback(error, e);
			}
		},

		moveResize: function (dimensions, success, error) {
			return agm_action("T42.Wnd.resizeAndMove").call(this, success, error, dimensions);
		},

		maximize: agm_action("T42.Wnd.Maximize"),

		restore: agm_action("T42.Wnd.Restore"),

		minimize: agm_action("T42.Wnd.Minimize"),

		maximizeRestore: agm_action("T42.Wnd.MaximizeOrRestoreDown"),

		onTabButton: add_callback("onTabButton"),

		addTabButton:  function (buttonInfo, success, error) {

			var target = container_filter(this.container);
			if (target === undefined)  {
				if (typeof error !== 'function') {
					return;
				} else {
					error("No container");
				}
			}
			if(typeof buttonInfo === 'undefined'){
				if (typeof error !== 'function') {
					return;
				} else {
					error("No button info");
				}
			}

			if(buttonInfo.buttonId === undefined){
				if (typeof error !== 'function') {
					return;
				} else {
					error("No buttonId");
				}
			}

			if(buttonInfo.imageBase64 === undefined){
				if (typeof error !== 'function') {
					return;
				} else {
					error("No imageBase64");
				}
			}

			var buttonInfo = {
				buttonId: buttonInfo.buttonId,
				tooltip: buttonInfo.tooltip,
				order: buttonInfo.order,
				imageBase64: buttonInfo.imageBase64,
				hoverImageBase64:  buttonInfo.hoverImageBase64,
				clickImageBase64: buttonInfo.clickImageBase64,
			};

			//Invoke the AGM method
			agm.invoke("T42.Wnd.AddButton", {
				windowId: this.id,
				buttonInfo:buttonInfo
			}, target, {}, buttonIsAdded.bind(this), buttonCannotBeAdded.bind(this));

			function buttonIsAdded() {
				var _buttonId = buttonInfo.buttonId;
				this.buttons[_buttonId] = {
					id: _buttonId,
					info:buttonInfo
				};
				invoke_agm_success_callback(success, this);
			}

			function buttonCannotBeAdded(e) {
				invoke_agm_error_callback(error, e);
			}
		}
	};

	// deprecates
	window_proto.set_style = deprecate(window_proto.setStyle, 'window.set_style() is deprecated and might be removed from future versions of glue. Use window.setStyle() instead');
	window_proto.on_available = deprecate(window_proto.onAvailable, 'window.on_available() is deprecated and might be removed from future versions of glue. Use window.onAvailable() instead');
	window_proto.on_close = deprecate(window_proto.onClose, 'window.on_close() is deprecated and might be removed from future versions of glue. Use window.onClose() instead');
	window_proto.on_url_changed = deprecate(window_proto.onUrlChanged, 'window.on_url_changed() is deprecated and might be removed from future versions of glue. Use window.onUrlChanged() instead');
	window_proto.set_title = deprecate(window_proto.setTitle, 'window.set_title() is deprecated and might be removed from future versions of glue. Use window.setTitle() instead');
	window_proto.get_details = deprecate(window_proto.getDetails, 'window.get_details() is deprecated and might be removed from future versions of glue. Use window.getDetails() instead');
	window_proto.move_resize = deprecate(window_proto.moveResize, 'window.move_resize() is deprecated and might be removed from future versions of glue. Use window.moveResize() instead');
	window_proto.maximize_restore = deprecate(window_proto.maximizeRestore, 'window.maximize_restore() is deprecated and might be removed from future versions of glue. Use window.maximizeRestore() instead');

	//Adds an alias of an AGM method in the Window prototype
	function agm_action(action) {
		return function (success, error, args) {

			//Stop if the window is closed
			if (this.url === undefined) {
				if (typeof error === "function") {
					error("Cannot execute a command on a closed window.");
				}

				return;
			}

			//Add the window ID to the arguments
			args = args || {};
			args.windowId = this.id;

			//Invoke the AGM method
			agm.invoke(action, args, container_filter(this.container), {}, fulfilled, error);

			var the_window = this;

			function fulfilled() {
				invoke_agm_success_callback(success, the_window);
			}

			return this;
		};
	}

	function determinateCorrectContainer(containerName) {
		// determinate HC or Browser
		var isHtmlContainer = typeof htmlContainer !== 'undefined';
		var containerFullName = "HtmlContainer.";

		//Container name is optional. if is undefined
		if (containerName === undefined) {
			if (isHtmlContainer) {
				containerFullName += htmlContainer.containerName;
			} else {
				var selectedContainers = getAvailableServers();
				if (selectedContainers.length === 0) {
					containerFullName = undefined;
				} else {
					containerFullName = selectedContainers[0].application;
				}
			}
		} else {
			var firstDotIndex = containerName.indexOf('.');
			var dashIndex = containerName.indexOf('-');
			var lastDotIndex = containerName.indexOf('.', dashIndex);
			//here is a full pattern - just pass it
			if (firstDotIndex !== -1 && dashIndex > firstDotIndex && lastDotIndex !== -1) {
				containerFullName = containerName;
			} else {
				if (isHtmlContainer) {
					if (htmlContainer.env.env !== undefined || htmlContainer.env.region !== undefined) {
						// Here we have partial name of Container in HC
						if (containerName.indexOf(htmlContainer.env.env) === -1 && containerName.indexOf(htmlContainer.env.region) === -1) {
							containerFullName += htmlContainer.env.env + '-' + htmlContainer.env.region + '.';
						}
						containerFullName += containerName;
						//Better to check if exist server with similar container? and if it passed wrong container to throw an exception?
					}
				}
				else {
					var matchingServers = getAvailableServersByName(containerName);
					if (matchingServers.length > 0) {
						containerFullName = matchingServers[0].application;
					} else {
						containerFullName = undefined;
					}
				}
			}
		}
		return containerFullName;
	}

	function getAvailableServers() {
		return agm.servers().reduce(function (memo, server) {
			if (server.application.indexOf('HtmlContainer.') !== -1) {
				if (server.application.indexOf('.Internal') !== -1) {
					memo.unshift(server);
				} else {
					memo.push(server);
				}
			}
			return memo;
		}, []);
	}

	function getAvailableServersByName(nameServer) {
		return agm.servers().filter(function (server) {
			var splittedServerName = server.application.split('.')[2];
			return splittedServerName === nameServer;
		});
	}

	function container_filter(name) {
		if (determinateCorrectContainer(name)) {
			return {application: determinateCorrectContainer(name)};
		} else {
			return undefined;
		}

	}

	//The API itself
	var api = {

		my: function () {
			var h;
			if (typeof window !== 'undefined') {
				h = window.htmlContainer;
			}
			//Retrieve the current window (the onw in which your application currently resides).
			return h === undefined ? undefined : a_window_from(h.browserWindowName, h.containerName, window.location.href, h.windowId);
		},

		open: function (name, url, container, dimensions, style, success, error) {
			var target = determinateCorrectContainer(container);
			if (target === undefined) {
				if (typeof error !== 'function') {
					return;
				} else {
					error("No container");
				}
			}
			return a_window_from(name, target, url, undefined, style).open(dimensions, style, success, error);
		},

		find: function (name, container, success, error) {
			return bind_window(a_window_from(name, determinateCorrectContainer(container)), success, error);
		},
		_from_event: a_window_from,

		list: function (container, success, error) {
			if (typeof success !== 'function') {
				return;
			}

			var target = container_filter(container);
			if (target === undefined) {
				if (typeof error !== 'function') {
					return;
				} else {
					error("No container");
				}
			}

			agm.invoke("T42.Wnd.ListWindows", {}, target, {wait_for_method_timeout: 15000}, listed, cannot_list);

			function listed(value) {
				if (value.returned === undefined) {
					success([]);
					return;
				}
				var result = vals(value.returned).map(function (opened_window) {
					return a_window_from(opened_window.windowName, determinateCorrectContainer(container), opened_window.url, opened_window.windowId, opened_window.windowStyleAttributes, opened_window.windowTitle);
				});
				success(result);
			}

			function cannot_list(e) {
				invoke_agm_error_callback(error, e);
			}
		},

		//Add callback for window added for the list of containers.
		windowAdded: function (callback, container) {
			//Add the current callback to the callback dictionary.
			put_callbacks(window_added_callbacks, callback, container);

			//Execute all the callbacks for already existing windows.

			//Get all existing html containers.
			api.containerAdded(function (server) {
				//If the user is subscribed to the container
				if (container === undefined || container === server) {
					//list all the windows in the container.
					api.list(server,
						function (list_of_windows) {
							//execute the callback for each window.
							list_of_windows.forEach(function (existing_window) {
								callback(existing_window);
							});
						},
						//Error callback if the windows cannot be listed.
						function (e) {
							console.log('Unable to load existing windows. ' + e);
						}
					);
				}
			});
		},

		windowRemoved: function (callback, container) {
			//Add the current callback to the callback dictionary.
			put_callbacks(window_removed_callbacks, callback, container);
		},

		containerAdded: function (callback) {
			agm.serverAdded(function (server) {
				if (server.application.indexOf('HtmlContainer.') !== -1) {
					invoke_agm_success_callback(callback, server.application);
				}
			});
		},

		containerRemoved: function (callback) {
			agm.serverRemoved(function (server) {
				if (server.application.indexOf('HtmlContainer.') !== -1) {
					invoke_agm_success_callback(callback, server.application);
				}
			});
		}
	};

	// deprecates
	api.window_added = deprecate(api.windowAdded, 'window.window_added() is deprecated and might be removed from future versions of glue. Use window.windowAdded() instead');
	api.window_removed = deprecate(api.windowRemoved, 'window.window_removed() is deprecated and might be removed from future versions of glue. Use window.windowRemoved() instead');
	api.container_added = deprecate(api.containerAdded, 'window.container_added() is deprecated and might be removed from future versions of glue. Use window.containerAdded() instead');
	api.container_removed = deprecate(api.containerRemoved, 'window.container_removed() is deprecated and might be removed from future versions of glue. Use window.containerRemoved() instead');


	var PackageJson = require("../package.json");
	api.version = PackageJson.version;

	return api;
};

if (typeof window !== 'undefined') {
	window.tick42 = window.tick42 || {};
	window.tick42.windows = windows;
}

module.exports = windows;


function add_callback(key, on_add) {
	return function (callback) {
		var obj = this.callbacks;
		if (obj[key] === undefined) {
			obj[key] = [callback];
		}
		else {
			obj[key].push(callback);
		}
		if (typeof on_add === "function") {
			on_add(this, callback);
		}
	};
}

function exec_callbacks(arr, val) {
	if (arr !== undefined) {
		arr.forEach(function (callback) {
			callback(val);
		});
	}
}

function vals(obj) {
	return Object.keys(obj).reduce(function (arr, key) {
		arr.push(obj[key]);
		return arr;
	}, []);
}

function container_from_filter(filter) {
	return filter.application.match(/HtmlContainer\.(.*?)$/)[1];
}

function invoke_agm_success_callback(callback, callback_argument) {
	if (typeof callback === "function") {
		callback(callback_argument);
	}
}

function invoke_agm_error_callback(callback, error) {
	if (typeof callback === "function") {
		callback(error.message);
	}
}

function get_callbacks(callbacks, container_name) {
	if (callbacks.containers_callbacks[container_name] !== undefined) {
		return callbacks.all_containers_callbacks.concat(callbacks.containers_callbacks[container_name]);
	} else {
		return callbacks.all_containers_callbacks;
	}
}

function put_callbacks(global_callbacks, callback, container) {
	if (container === undefined) {
		global_callbacks.all_containers_callbacks.push(callback);
	} else {
		if (global_callbacks.containers_callbacks[container] === undefined) {
			global_callbacks.containers_callbacks[container] = [callback];
		} else {
			global_callbacks.containers_callbacks[container].push(callback);
		}
	}
}

},{"../package.json":77,"util-deprecate":78}],77:[function(require,module,exports){
module.exports={
  "_args": [
    [
      "tick42-windows@2.2.0",
      "C:\\work\\stash\\GLUE-dev\\js-glue"
    ]
  ],
  "_from": "tick42-windows@2.2.0",
  "_id": "tick42-windows@2.2.0",
  "_inCache": true,
  "_installable": true,
  "_location": "/tick42-windows",
  "_nodeVersion": "5.3.0",
  "_npmUser": {},
  "_npmVersion": "3.3.12",
  "_phantomChildren": {},
  "_requested": {
    "name": "tick42-windows",
    "raw": "tick42-windows@2.2.0",
    "rawSpec": "2.2.0",
    "scope": null,
    "spec": "2.2.0",
    "type": "version"
  },
  "_requiredBy": [
    "/"
  ],
  "_resolved": "http://192.168.0.234:4873/tick42-windows/-/tick42-windows-2.2.0.tgz",
  "_shasum": "48fa8d468e57de21456deb133ffcfdb5787c7851",
  "_shrinkwrap": null,
  "_spec": "tick42-windows@2.2.0",
  "_where": "C:\\work\\stash\\GLUE-dev\\js-glue",
  "author": {
    "name": "Tick42"
  },
  "dependencies": {
    "util-deprecate": "^1.0.2"
  },
  "description": "A windowing API for the Tick42 HTML Container",
  "devDependencies": {
    "blanket": "^1.1.6",
    "browserify-versionify": "^1.0.4",
    "grunt": "^0.4.5",
    "grunt-browserify": "^3.3.0",
    "grunt-cli": "^0.1.13",
    "grunt-contrib-clean": "^0.6.0",
    "grunt-contrib-connect": "^0.9.0",
    "grunt-contrib-jshint": "^0.11.2",
    "grunt-contrib-qunit": "^0.5.2",
    "grunt-contrib-uglify": "^0.6.0",
    "grunt-contrib-watch": "^0.6.1",
    "grunt-exorcise": "^1.0.1",
    "phantomjs": "^1.9.12",
    "qunitjs": "^1.15.0",
    "uglifyify": "^3.0.1"
  },
  "directories": {
    "test": "tests"
  },
  "dist": {
    "shasum": "48fa8d468e57de21456deb133ffcfdb5787c7851",
    "tarball": "http://192.168.0.234:4873/tick42-windows/-/tick42-windows-2.2.0.tgz"
  },
  "gitHead": "b522b338ea4b73e73d466be1b2de54dd4e125eab",
  "license": "ISC",
  "main": "library/windows.js",
  "name": "tick42-windows",
  "optionalDependencies": {},
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "https://bmarinov@stash.tick42.com:8443/scm/ofgw/js-windows.git"
  },
  "scripts": {
    "prepublish": "npm update & grunt",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "version": "2.2.0"
}

},{}],78:[function(require,module,exports){
(function (global){

/**
 * Module exports.
 */

module.exports = deprecate;

/**
 * Mark that a method should not be used.
 * Returns a modified function which warns once by default.
 *
 * If `localStorage.noDeprecation = true` is set, then it is a no-op.
 *
 * If `localStorage.throwDeprecation = true` is set, then deprecated functions
 * will throw an Error when invoked.
 *
 * If `localStorage.traceDeprecation = true` is set, then deprecated functions
 * will invoke `console.trace()` instead of `console.error()`.
 *
 * @param {Function} fn - the function to deprecate
 * @param {String} msg - the string to print to the console when `fn` is invoked
 * @returns {Function} a new "deprecated" version of `fn`
 * @api public
 */

function deprecate (fn, msg) {
  if (config('noDeprecation')) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config('throwDeprecation')) {
        throw new Error(msg);
      } else if (config('traceDeprecation')) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
}

/**
 * Checks `localStorage` for boolean values for the given `name`.
 *
 * @param {String} name
 * @returns {Boolean}
 * @api private
 */

function config (name) {
  // accessing global.localStorage can trigger a DOMException in sandboxed iframes
  try {
    if (!global.localStorage) return false;
  } catch (_) {
    return false;
  }
  var val = global.localStorage[name];
  if (null == val) return false;
  return String(val).toLowerCase() === 'true';
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],79:[function(require,module,exports){

/**
 * Module dependencies.
 */

var global = (function() { return this; })();

/**
 * WebSocket constructor.
 */

var WebSocket = global.WebSocket || global.MozWebSocket;

/**
 * Module exports.
 */

module.exports = WebSocket ? ws : null;

/**
 * WebSocket constructor.
 *
 * The third `opts` options object gets ignored in web browsers, since it's
 * non-standard, and throws a TypeError if passed to the constructor.
 * See: https://github.com/einaros/ws/issues/227
 *
 * @param {String} uri
 * @param {Array} protocols (optional)
 * @param {Object) opts (optional)
 * @api public
 */

function ws(uri, protocols, opts) {
  var instance;
  if (protocols) {
    instance = new WebSocket(uri, protocols);
  } else {
    instance = new WebSocket(uri);
  }
  return instance;
}

if (WebSocket) ws.prototype = WebSocket.prototype;

},{}],80:[function(require,module,exports){
module.exports={
  "name": "tick42-glue",
  "version": "2.9.1",
  "description": "A JavaScript library which provides support for Tick42 GLUE.",
  "main": "library/glue.js",
  "bin": {
    "init-dev-mode": "bin/init-dev-mode.js",
    "remove-installed-dependencies": "bin/remove-installed-dependencies.js",
    "remove-development-dependencies": "bin/remove-development-dependencies.js",
    "build": "./bin/build.js",
    "clean": "./bin/clean.js",
    "file-versionify": "bin/file-versionify.js",
    "minify": "./bin/minify.js"
  },
  "scripts": {
    "lint": "jshint library",
    "test": "npm run lint & mocha --require ./test/test_helper \"test/**/*.js\"",
    "build": "node bin/clean.js & node bin/build.js & node bin/minify & node bin/file-versionify",
    "build:dev": "node bin/clean & node bin/build",
    "prepublish": "npm update & npm run build",
    "init:develop": "node bin/init-dev-mode",
    "clear:develop": "node bin/remove-development-dependencies",
    "watch": "onchange \"./library/*.js\" \"./node_modules/tick42-*/library/*.js\"  \"./node_modules/tick42-*/library_js/*.js\" \"../node_modules/tick42-*/library/*.js\"  \"../node_modules/tick42-*/library_js/*.js\" -iv -e \"./bin\" -- npm run build:dev",
    "watch:develop": "node bin/remove-installed-dependencies & npm run watch",
    "watch:prod": "npm install & npm run watch"
  },
  "repository": {
    "type": "git",
    "url": "https://bmarinov@stash.tick42.com:8443/scm/ofgw/js-glue.git"
  },
  "author": {
    "name": "Tick42",
    "url": "http://www.tick42.com"
  },
  "license": "ISC",
  "dependencies": {
    "cuid": "^1.3.8",
    "detect-node": "^2.0.3",
    "es5-shim": "^4.1.14",
    "tick42-activity": "^2.0.0",
    "tick42-agm": "^2.1.6",
    "tick42-app-manager": "^2.0.0",
    "tick42-appconfig": "^0.0.0",
    "tick42-gateway-connection": "^1.1.6",
    "tick42-logger": "^2.0.3",
    "tick42-metrics": "^2.0.13",
    "tick42-windows": "^2.0.2"
  },
  "devDependencies": {
    "browserify": "^13.0.0",
    "browserify-replacify": "^0.0.4",
    "browserify-versionify": "^1.0.4",
    "chai": "^3.5.0",
    "fs": "0.0.2",
    "jsdom": "^8.1.0",
    "jshint": "^2.9.1",
    "minifyify": "^7.3.2",
    "mocha": "^2.4.5",
    "onchange": "^2.1.2",
    "shelljs": "^0.6.0"
  }
}

},{}]},{},[1])