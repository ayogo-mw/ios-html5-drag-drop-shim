/* global window, navigator */
(function(window, doc) {
	'use strict';

	log = function() {}; // noOp, remove this line to enable debugging

	main();

	function main() {

		var div = doc.createElement('div');
		var dragDiv = 'draggable' in div;
		var evts = 'ondragstart' in div && 'ondrop' in div;

		var needsPatch = !(dragDiv || evts) || /iPad|iPhone|iPod/.test(navigator.userAgent);
		log((needsPatch ? '' : 'not ') + 'patching html5 drag drop');

		if (false && !needsPatch) {
			return;
		}

		doc.addEventListener('touchstart', touchstart);
	}

	function DragDrop(event, el) {

		this.touchPositions = {};
		this.dragData = {};
		this.el = el || event.target;

		event.preventDefault();

		log('dragstart');

		this.dispatchDragEvent('dragstart', this.el);
		this.elTranslation = readTransform(this.el);

		this.listen();

	}

	DragDrop.prototype = {
		listen: function() {
			var move = onEvt(doc, 'touchmove', this.move, this);
			var end = onEvt(doc, 'touchend', ontouchend, this);
			var cancel = onEvt(doc, 'touchcancel', cleanup, this);

			function ontouchend(event) {
				/*jshint validthis:true */
				this.dragend(event);
				cleanup.bind(this)();
			}

			function cleanup() {
				/*jshint validthis:true */
				log('cleanup');
				this.touchPositions = {};
				// Clear this.el breaks snapback
				this.dragData = null;
				return [move, end, cancel].forEach(function(handler) {
					return handler.off();
				});
			}
		},
		move: function(event) {
			var deltas = {
				x: [],
				y: []
			};

			[].forEach.call(event.changedTouches, function(touch, index) {
				var lastPosition = this.touchPositions[index];
				if (lastPosition) {
					deltas.x.push(touch.pageX - lastPosition.x);
					deltas.y.push(touch.pageY - lastPosition.y);
				} else {
					this.touchPositions[index] = lastPosition = {};
				}
				lastPosition.x = touch.pageX;
				lastPosition.y = touch.pageY;
			}.bind(this));

			this.elTranslation.x += average(deltas.x);
			this.elTranslation.y += average(deltas.y);
			writeTransform(this.el, this.elTranslation.x, this.elTranslation.y);

			var target = elementFromTouchEvent(this.el, event);

			if (target === null) {
				return;
			}

			if (target !== this.prevTarget) {
				if (this.prevTarget !== undefined) {
					this.dispatchDragEvent('dragleave', this.prevTarget);
				}
				this.dispatchDragEvent('dragenter', target);
				this.prevTarget = target;
			}
			this.dispatchDragEvent('dragover', target);
		},
		dragend: function(event) {

			// we'll dispatch drop if there's a target, then dragEnd. If drop isn't fired
			// or isn't cancelled, we'll snap back
			// drop comes first http://www.whatwg.org/specs/web-apps/current-work/multipage/dnd.html#drag-and-drop-processing-model
			log('dragend');

			var target = elementFromTouchEvent(this.el, event);

			if (target) {
				log('found drop target ' + target.tagName);
				this.dispatchDrop(target);
			} else {
				log('no drop target, scheduling snapBack');
				once(doc, 'dragend', this.snapBack, this);
			}

			var dragendEvt = doc.createEvent('Event');
			dragendEvt.initEvent('dragend', true, true);
			this.el.dispatchEvent(dragendEvt);
		},
		dispatchDrop: function(target) {
			var snapBack = true;

			var dropEvt = doc.createEvent('Event');
			dropEvt.initEvent('drop', true, true);
			dropEvt.dataTransfer = {
				getData: function(type) {
					return this.dragData[type];
				}.bind(this)
			};
			dropEvt.preventDefault = function() {
				// https://www.w3.org/Bugs/Public/show_bug.cgi?id=14638 - if we don't cancel it, we'll snap back
				snapBack = false;
				writeTransform(this.el, 0, 0);
			}.bind(this);

			once(doc, 'drop', function() {
				log('drop event not canceled');
				if (snapBack) {
					this.snapBack();
				}
			}, this);

			target.dispatchEvent(dropEvt);
		},
		snapBack: function() {
			once(this.el, 'webkitTransitionEnd', function() {
				this.el.style['-webkit-transition'] = 'none';
			}, this);
			setTimeout(function() {
				this.el.style['-webkit-transition'] = 'all 0.2s';
				writeTransform(this.el, 0, 0);
			}.bind(this));
		},
		dispatchDragEvent: function(eventname, el) {
			var evt = doc.createEvent('Event');
			evt.initEvent(eventname, true, true);
			evt.dataTransfer = {
				setData: function(type, val) {
					this.dragData[type] = val;
				}.bind(this),
				dropEffect: 'move'
			};
			el.dispatchEvent(evt);
		}
	};

	// event listeners
	function touchstart(evt) {
		var el = evt.target;
		do {
			// https://developer.mozilla.org/en/docs/DragDrop/Drag_Operations#draggableattribute
			if (el.getAttribute('draggable') === 'true') {
				evt.preventDefault();
				new DragDrop(evt, el);
			}
		} while ((el = el.parentNode) && el !== doc.body);
	}

	// DOM helpers
	function elementFromTouchEvent(el, event) {
		var parent = el.parentElement;
		var next = el.nextSibling;
		parent.removeChild(el);

		var touch = event.changedTouches[0];
		var target = doc.elementFromPoint(
			touch.pageX - window.pageXOffset,
			touch.pageY - window.pageYOffset
		);

		if (next) {
			parent.insertBefore(el, next);
		} else {
			parent.appendChild(el);
		}

		return target;
	}

	function readTransform(el) {
		var transform = el.style['-webkit-transform'];
		var x = 0;
		var y = 0;
		var match = /translate\(\s*(\d+)[^,]*,\D*(\d+)/.exec(transform);
		if (match) {
			x = parseInt(match[1], 10);
			y = parseInt(match[2], 10);
		}
		return {
			x: x,
			y: y
		};
	}

	function writeTransform(el, x, y) {
		var transform = el.style['-webkit-transform'].replace(/translate\(\D*\d+[^,]*,\D*\d+[^,]*\)\s*/g, '');
		el.style['-webkit-transform'] = transform + ' translate(' + x + 'px,' + y + 'px)';
	}

	function onEvt(el, event, handler, context) {
		if (context) {
			handler = handler.bind(context);
		}
		el.addEventListener(event, handler);
		return {
			off: function() {
				return el.removeEventListener(event, handler);
			}
		};
	}

	function once(el, event, handler, context) {
		if (context) {
			handler = handler.bind(context);
		}

		function listener(evt) {
			handler(evt);
			return el.removeEventListener(event, listener);
		}
		return el.addEventListener(event, listener);
	}


	// general helpers
	function log(msg) {
		console.log(msg);
	}

	function average(arr) {
		if (arr.length === 0) {
			return 0;
		}
		return arr.reduce((function(s, v) {
			return v + s;
		}), 0) / arr.length;
	}

	// Function.bind polyfill for Safari < 5.1.4 and iOS.
	// From https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Function/bind
	if (Function.prototype.bind === undefined) {
		Function.prototype.bind = function(c) {
			if ('function' !== typeof this) {
				throw new TypeError('Function.prototype.bind - binding an object that is not callable');
			}
			var d = Array.prototype.slice.call(arguments, 1),
				e = this,
				A = function() {}, b = function() {
					return e.apply(this instanceof A ? this : c || window, d.concat(Array.prototype.slice.call(arguments)));
				};
			A.prototype = this.prototype;
			b.prototype = new A();
			return b;
		};
	}

})(window, document);