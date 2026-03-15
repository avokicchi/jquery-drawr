/*!
 * jquery-drawr
 * Copyright (c) 2019–present Avokicchi
 * Released under the MIT License
 */

(function( $ ) {

	var DRAWR_VERSION = "@@VERSION@@";

	$.fn.drawr = function( action, param, param2 ) {
		var plugin = this;
		//returns the euclidean distance between two {x,y} points.
		plugin.distance_between = function(p1, p2) {
		  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
		};
		//returns the angle in radians from p1 to p2, measured clockwise from the downward Y axis.
		plugin.angle_between = function(p1, p2) {
		  return Math.atan2( p2.x - p1.x, p2.y - p1.y );
		};
		//converts a CSS hex color string to an {r, g, b} object. returns null if the input is invalid.
		plugin.hex_to_rgb = function (hex) {
			var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			return result ? {
				r: parseInt(result[1], 16),
				g: parseInt(result[2], 16),
				b: parseInt(result[3], 16)
			} : null;
		};
		//converts r, g, b (0–255) to a CSS hex string "#rrggbb".
		plugin.rgb_to_hex = function(r, g, b) {
			return '#' + (0x1000000 + (b | (g << 8) | (r << 16))).toString(16).slice(1);
		};
		//keeps track of last 25 mouse or stylus events to determine majority, and ignore unintended touches by wrist.
		plugin.eventArr = [];
		plugin.record_event = function(event){
			var fakeevent = {
				"type" : event.type
			};
			plugin.eventArr.push(fakeevent);
			if(plugin.eventArr.length>25){
				plugin.eventArr.shift();
			}
		};

		//checks if a drawing event should be ignored.
		//rule: if the majority of the last 25 events is from a pen, ignore touch/other.
		//if true, it should be ignored
		plugin.check_ignore = function(event){
			var other = 0, stylus = 0;
			$.each(plugin.eventArr, function(i, ev){
				ev.type=="pen" ? stylus++ : other++;
			});
			if(stylus > other){
				return !(event.originalEvent.pointerType=="pen");
			}
			return false;
		};
		//Function to get x/y/pressure data from mouse/touch/pointer events
		//It can get it relative to body, or another component
		plugin.get_mouse_data = function (event,relativeTo,scrollEl) {
			
			//if(event.type!=="touchend") 
			plugin.record_event(event);

			if(typeof relativeTo!=="undefined" && relativeTo!==null){
				var border = plugin.get_border(relativeTo);
				var translate_x = typeof scrollEl!=="undefined" ? scrollEl.scrollX : 0;
				var translate_y = typeof scrollEl!=="undefined" ? scrollEl.scrollY : 0;

				var box = relativeTo.getBoundingClientRect();
				box.x += $(document).scrollLeft();
				box.y += $(document).scrollTop();
				bounding_box = {
					left: box.x - translate_x + border.left,
					top: box.y - translate_y + border.top
				};

			} else {
				var bounding_box = {
					left: 0,
					top: 0 
				};			
			}
			var x, y, pressure;
			this.pen_pressure = event.originalEvent.pointerType=="pen";
			pressure = this.pen_pressure ? event.originalEvent.pressure : 1;
			x = (event.pageX - bounding_box.left)/this.zoomFactor;
			y = (event.pageY-bounding_box.top)/this.zoomFactor;
			//apply inverse canvas rotation 
			if(typeof relativeTo!=="undefined" && relativeTo!==null && this.rotationAngle){
				var angle = this.rotationAngle;
				var W = this.width * this.zoomFactor;
				var H = this.height * this.zoomFactor;
				var dx = x * this.zoomFactor - W / 2;
				var dy = y * this.zoomFactor - H / 2;
				var cos = Math.cos(-angle);
				var sin = Math.sin(-angle);
				x= (dx * cos - dy * sin + W / 2)/this.zoomFactor;
				y= (dx * sin + dy * cos + H / 2)/this.zoomFactor;
			}
			return { 
				x: x,
				 y: y, 
				 pressure: pressure 
			};
		};
		plugin.is_dragging = false;

		//calculates effective alpha and size for a brush, scaling by pressure if the brush supports it.
		plugin.calc_brush_params = function(brush, brushSize, brushAlpha, pressure){
			return {
				alpha: brush.pressure_affects_alpha ? Math.min(1, brushAlpha * pressure * 2) : brushAlpha,
				size:  parseFloat(brush.pressure_affects_size  ? Math.max(1, brushSize * pressure * 2) : brushSize)
			};
		};

		//returns the CSS transform string shared by the canvas and background canvas.
		plugin.canvas_transform = function(x, y, angle){
			return "translate(" + -x + "px," + -y + "px) rotate(" + angle + "rad)";
		};

		//reads border-top and border-left pixel widths from an element's computed style.
		plugin.get_border = function(el){
			var cs = window.getComputedStyle(el, null);
			return {
				top:  parseInt(cs.getPropertyValue("border-top-width")),
				left: parseInt(cs.getPropertyValue("border-left-width"))
			};
		};

		//evaluates a centripetal Catmull-Rom spline (alpha=0.5) at parameter u (0..1) for the
		//segment p1→p2, using p0 and p3 as the outer control points. The centripetal
		//parameterisation guarantees no cusps or loops regardless of knot spacing or sharp
		//direction changes — unlike the uniform variant which overshoots into loops at turns.
		//Uses the Barry-Goldman algorithm.
		plugin.catmull_rom_point = function(p0, p1, p2, p3, u) {
			var d01 = Math.sqrt(plugin.distance_between(p0, p1));
			var d12 = Math.sqrt(plugin.distance_between(p1, p2));
			var d23 = Math.sqrt(plugin.distance_between(p2, p3));
			var t0 = 0;
			var t1 = t0 + d01;
			var t2 = t1 + d12;
			var t3 = t2 + d23;
			if (t2 === t1) return { x: p1.x, y: p1.y }; // zero-length segment
			if (t1 === t0) t0 = t1 - 1e-4;			  // degenerate outer interval
			if (t3 === t2) t3 = t2 + 1e-4;
			var t = t1 + u * (t2 - t1);
			var inv10 = 1 / (t1 - t0), inv21 = 1 / (t2 - t1), inv32 = 1 / (t3 - t2);
			var inv20 = 1 / (t2 - t0), inv31 = 1 / (t3 - t1);
			var A1x = (t1-t)*inv10 * p0.x + (t-t0)*inv10 * p1.x;
			var A1y = (t1-t)*inv10 * p0.y + (t-t0)*inv10 * p1.y;
			var A2x = (t2-t)*inv21 * p1.x + (t-t1)*inv21 * p2.x;
			var A2y = (t2-t)*inv21 * p1.y + (t-t1)*inv21 * p2.y;
			var A3x = (t3-t)*inv32 * p2.x + (t-t2)*inv32 * p3.x;
			var A3y = (t3-t)*inv32 * p2.y + (t-t2)*inv32 * p3.y;
			var B1x = (t2-t)*inv20 * A1x + (t-t0)*inv20 * A2x;
			var B1y = (t2-t)*inv20 * A1y + (t-t0)*inv20 * A2y;
			var B2x = (t3-t)*inv31 * A2x + (t-t1)*inv31 * A3x;
			var B2y = (t3-t)*inv31 * A2y + (t-t1)*inv31 * A3y;
			return {
				x: (t2-t)*inv21 * B1x + (t-t1)*inv21 * B2x,
				y: (t2-t)*inv21 * B1y + (t-t1)*inv21 * B2y
			};
		};

		//walks the Catmull-Rom segment p1→p2 (influenced by p0 and p3) at arc-length steps of
		//stepSize, calling brush.drawSpot at each step. accepts a carry-in accumDist so that
		//partial progress from a previous short segment is not discarded (fixes slow-draw gaps).
		//returns the leftover accumDist to be passed into the next call.
		plugin.draw_catmull_segment = function(context, brush, p0, p1, p2, p3, stepSize, size, alpha, e, accumDist) {
			var self = this;
			var segLen = plugin.distance_between(p1, p2);
			//sample densely enough that no step is skipped even on fast strokes
			var numSamples = Math.max(20, Math.ceil(segLen / (stepSize * 0.5)));
			var prevPt = p1;
			accumDist = accumDist || 0;
			for (var i = 1; i <= numSamples; i++) {
				var pt = plugin.catmull_rom_point(p0, p1, p2, p3, i / numSamples);
				var stepDist = plugin.distance_between(prevPt, pt);
				accumDist += stepDist;
				while (accumDist >= stepSize) {
					accumDist -= stepSize;
					var spotAlpha = alpha;
					if (brush.brush_fade_in) {
						self._fadeInSpotCount++;
						spotAlpha = alpha * Math.min(1, self._fadeInSpotCount / brush.brush_fade_in);
					}
					if (typeof brush.drawSpot !== "undefined") {
						//interpolate the exact arc-length position along prevPt→pt so that
						//multiple spots within one sample step are spread out, not stacked.
						var ratio = stepDist > 0 ? Math.max(0, Math.min(1, 1 - accumDist / stepDist)) : 1;
						brush.drawSpot.call(self, brush, context,
							prevPt.x + (pt.x - prevPt.x) * ratio,
							prevPt.y + (pt.y - prevPt.y) * ratio,
							size, spotAlpha, e);
					}
				}
				prevPt = pt;
			}
			return accumDist;
		};

		//sets the active (orange) or inactive (grey) visual state of a toolbox button.
		plugin.set_button_state = function(el, active){
			$(el).css(active ? { "background": "orange", "color": "white" }
							 : { "background": "#eeeeee", "color": "#000000" });
		};

		//Binds touch event listeners to the canvas's parent container
		plugin.bind_draw_events = function(){
			var self=this;
			var context = self.getContext("2d", { alpha: self.settings.enable_transparency });
			$(self).data("is_drawing",false);$(self).data("lastx",null);$(self).data("lasty",null);
			$(self).parent().on("touchstart." + self._evns, function(e){ e.preventDefault(); });//cancel scroll.

			//true if inside canvas, false if outside canvas.
			//used to check if an initial click or touch start event is valid inside the container
			//and needs to be tracked through move/end events.
			self.boundCheck = function(event){
				//new rotation-aware hit test
				var parent = $(self).parent()[0];
				var border = plugin.get_border(parent);
				var box = parent.getBoundingClientRect();
				var eventX = event.pageX;
				var eventY = event.pageY;
				var px = eventX - (box.x + $(document).scrollLeft()) - border.left;
				var py = eventY - (box.y + $(document).scrollTop()) - border.top;
				var W = self.width * self.zoomFactor;
				var H = self.height * self.zoomFactor;
				var angle = self.rotationAngle || 0;
				var dx = px - (W / 2 - self.scrollX);
				var dy = py - (H / 2 - self.scrollY);
				var cos = Math.cos(-angle);
				var sin = Math.sin(-angle);
				var canvasX = (dx * cos - dy * sin + W / 2) / self.zoomFactor;
				var canvasY = (dx * sin + dy * cos + H / 2) / self.zoomFactor;
				return canvasX >= 0 && canvasX <= self.width && canvasY >= 0 && canvasY <= self.height;
			};

			//simple AABB hit test against the container's bounding rect (no rotation awareness).
			//returns true if the event's pointer is within the container element.
			//used for right-drag pan initiation and hover highlight, where an approximate test is sufficient.
			self.containerBoundCheck = function(event){
				var parent = $(self).parent()[0];
				var box = parent.getBoundingClientRect();
				var eventX = event.originalEvent.clientX;
				var eventY = event.originalEvent.clientY;
				return eventX >= box.left && eventX <= box.right && eventY >= box.top && eventY <= box.bottom;
			};

			//tracks active touch pointers by pointerId for gesture detection
			self.activePointers = {};

			//handles pointerdown. sets the important is_drawing flag if drawing started within the canvas area
			//this is important as drawing continues even when you leave, as long as it started in a valid area.
			//calls plugin drawStart and drawSpot functions
			self.drawStart = function(e){
				var mouse_data = plugin.get_mouse_data.call(self,e);

				if(plugin.check_ignore(e)==true) return;
				//console.warn(e.button);

				//middle-mouse drag: enter panning mode
				if(e.button === 1){
					if(self.containerBoundCheck.call(self, e)){
						self.isMiddleDragging = true;
						self.middleDragStart = { x: e.pageX, y: e.pageY, scrollX: self.scrollX, scrollY: self.scrollY };
					}
					return;
				}

				//pinch/two-finger gesture: track touch pointers and enter gesture mode when a second finger lands
				if(e.originalEvent.pointerType === "touch"){
					self.activePointers[e.originalEvent.pointerId] = {x: e.pageX, y: e.pageY};
					var pts = Object.values(self.activePointers);
					if(pts.length >= 2){
						//erase any dot drawn by the first touch before the gesture was detected
						if(self._gestureAbortSnapshot){
							context.putImageData(self._gestureAbortSnapshot, 0, 0);
							self._gestureAbortSnapshot = null;
						}
						var t1 = pts[0], t2 = pts[1];
						self.gestureStart = {
							dist:	 plugin.distance_between(t1, t2),
							angle:	Math.atan2(t2.y - t1.y, t2.x - t1.x),
							zoom:	 self.zoomFactor,
							rotation: self.rotationAngle || 0,
							midX:	 (t1.x + t2.x) / 2,
							midY:	 (t1.y + t2.y) / 2,
							scrollX:  self.scrollX,
							scrollY:  self.scrollY
						};
						self.isGesturing = true;
						$(self).data("is_drawing", false);
						return;
					}
				}

				if(self.$brushToolbox.is(":visible") && self.boundCheck.call(self,e)==true && self.containerBoundCheck.call(self,e)==true){//yay! We're drawing!
					if(plugin.is_dragging==false){
						mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);
						//save snapshot so the second touch can erase this stroke start if a gesture is detected
						if(e.originalEvent.pointerType === "touch") self._gestureAbortSnapshot = context.getImageData(0, 0, self.width, self.height);
						$(self).data("is_drawing",true);
						self._activeButton = e.button;//store button, since pointer events only have useful button info in pointerdown, and we catch pointermove later.
						context.lineCap = "round";context.lineJoin = 'round';

						//reset fade-in counter at start of stroke
						self._fadeInSpotCount = 0;

						//calculate alpha and size, scaled by pressure if the brush supports it
						var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure);
						var calculatedAlpha = bp.alpha, calculatedSize = bp.size;

						$(self).data("positions",[{x:mouse_data.x,y:mouse_data.y}]);
						if(self.active_brush.smoothing) { self._smoothKnots = [{x: mouse_data.x, y: mouse_data.y}]; self._smoothAccumDist = 0; self._smoothLastStepSize = null; }
						var startAlpha = calculatedAlpha;
						if(self.active_brush.brush_fade_in){
							self._fadeInSpotCount++;
							startAlpha = calculatedAlpha * Math.min(1, self._fadeInSpotCount / self.active_brush.brush_fade_in);
						}
						if(typeof self.active_brush.drawStart!=="undefined") self.active_brush.drawStart.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,startAlpha,e);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,startAlpha,e);
						plugin.request_redraw.call(self);
					}
				}
			};
			$(window).bind("pointerdown." + self._evns, self.drawStart);

			//handles pointermove events. if is_drawing is true, will call plugins drawSpot
			//also handles toolbox dragging
			self.drawMove = function(e){

				//update tracked pointer position for gesture calculation
				if(e.originalEvent.pointerType === "touch" && self.activePointers[e.originalEvent.pointerId]){
					self.activePointers[e.originalEvent.pointerId] = {x: e.pageX, y: e.pageY};
				}

				//apply pinch zoom and rotation while gesturing
				if(self.isGesturing){
					var pts = Object.values(self.activePointers);
					if(pts.length >= 2){
						var t1 = pts[0], t2 = pts[1];
						var gs = self.gestureStart;
						var newDist  = plugin.distance_between(t1, t2);
						var newAngle = Math.atan2(t2.y - t1.y, t2.x - t1.x);
						var newZoom  = Math.max(0.1, Math.min(5, gs.zoom * (newDist / gs.dist)));
						var newMidX  = (t1.x + t2.x) / 2;
						var newMidY  = (t1.y + t2.y) / 2;
						/*keep the canvas point under the initial pinch centre pinned to the
						current finger midpoint, combine zoom-centering and panning in one step */
						var rect  = $(self).parent()[0].getBoundingClientRect();
						var cLeft = rect.left + window.scrollX;
						var cTop  = rect.top  + window.scrollY;
						var newScrollX = (gs.midX - cLeft + gs.scrollX) * (newZoom / gs.zoom) - (newMidX - cLeft);
						var newScrollY = (gs.midY - cTop  + gs.scrollY) * (newZoom / gs.zoom) - (newMidY - cTop);
						//adjust scroll so rotation pivots around the current finger midpoint instead of the canvas center
						var dAngle = newAngle - gs.angle;
						var _W = self.width * newZoom;
						var _H = self.height * newZoom;
						var pvX = newMidX - cLeft;
						var pvY = newMidY - cTop;
						var ctrX = _W / 2 - newScrollX;
						var ctrY = _H / 2 - newScrollY;
						var dX = pvX - ctrX;
						var dY = pvY - ctrY;
						newScrollX -= dX - (dX * Math.cos(dAngle) - dY * Math.sin(dAngle));
						newScrollY -= dY - (dX * Math.sin(dAngle) + dY * Math.cos(dAngle));
						self.gesturePivot = { x: pvX, y: pvY };
						self.zoomFactor = newZoom;
						$(self).width(self.width * newZoom);
						$(self).height(self.height * newZoom);
						plugin.draw_checkerboard.call(self);
						plugin.apply_scroll.call(self, newScrollX, newScrollY, true);
						plugin.apply_rotation.call(self, gs.rotation + dAngle, false);
					}
					return;
				}

				//middle-mouse drag: pan the canvas
				if(self.isMiddleDragging){
					var dx = e.pageX - self.middleDragStart.x;
					var dy = e.pageY - self.middleDragStart.y;
					plugin.apply_scroll.call(self, self.middleDragStart.scrollX - dx, self.middleDragStart.scrollY - dy, true);
					return;
				}

				var bound_check = self.boundCheck.call(self,e) && self.containerBoundCheck.call(self,e);

				if(bound_check){
					$(self).parent().find(".sfx-canvas")[0].style.boxShadow="0px 0px 5px 1px skyblue inset";
				} else {
					$(self).parent().find(".sfx-canvas")[0].style.boxShadow="";
				}

				var mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);

				if($(self).data("is_drawing")==true && plugin.check_ignore(e)==false){

					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;
					var stepSize = calculatedSize/4;
					if(stepSize<1) stepSize = 1;

					if(self.active_brush.smoothing) {
						//smooth path: buffer raw knots and draw a Catmull-Rom segment lagging one event behind,
						//using the new knot as the lookahead (P3) that shapes the tangent of the previous segment.
						self._smoothKnots.push({x: mouse_data.x, y: mouse_data.y});
						var knots = self._smoothKnots;
						var n = knots.length - 1; //last index
						if(n >= 2) {
							//draw segment knots[n-2]→knots[n-1]; knots[n] is the lookahead control point
							var p0 = knots[Math.max(0, n-3)];
							var p1 = knots[n-2];
							var p2 = knots[n-1];
							var p3 = knots[n];
							//rescale accumDist when stepSize changes (e.g. stylus pressure shift) so the
							//fractional progress towards the next spot is preserved, preventing the while
							//loop in draw_catmull_segment from firing multiple times at the same point.
							if(self._smoothLastStepSize && self._smoothLastStepSize !== stepSize) {
								self._smoothAccumDist = self._smoothAccumDist * (stepSize / self._smoothLastStepSize);
							}
							self._smoothLastStepSize = stepSize;
							self._smoothAccumDist = plugin.draw_catmull_segment.call(self, context, self.active_brush, p0, p1, p2, p3, stepSize, calculatedSize, calculatedAlpha, e, self._smoothAccumDist);
						}
					} else {
						//original linear interpolation along the line between the last drawn spot and the current position
						var positions = $(self).data("positions");
						var currentSpot = {x:mouse_data.x,y:mouse_data.y};
						var lastSpot=positions[positions.length-1];
						var dist = plugin.distance_between(lastSpot, currentSpot);
						var angle = plugin.angle_between(lastSpot, currentSpot);
						for (var i = stepSize; i < dist; i+=stepSize) {
							x = lastSpot.x + (Math.sin(angle) * i);
							y = lastSpot.y + (Math.cos(angle) * i);
							var spotAlpha = calculatedAlpha;
							if(self.active_brush.brush_fade_in){
								self._fadeInSpotCount++;
								spotAlpha = calculatedAlpha * Math.min(1, self._fadeInSpotCount / self.active_brush.brush_fade_in);
							}
							if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,x,y,calculatedSize,spotAlpha,e);
							positions.push({x:x,y:y});
						}
						$(self).data("positions",positions);
					}
				}
				var tbPageX = e.pageX || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0] && e.originalEvent.touches[0].pageX) || 0;
				var tbPageY = e.pageY || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0] && e.originalEvent.touches[0].pageY) || 0;
				$(".drawr-toolbox").each(function(){
					if($(this).data("dragging")==true){
						$(this).offset({
							top: tbPageY - $(this).data("offsety"),
							left: tbPageX - $(this).data("offsetx")
						});
					}
				});
			};

			if(this.settings.enable_scrollwheel_zooming==true){
				//zooms the canvas in or out in response to a mouse wheel event, keeping the pointer position stationary
				//delta is clamped to 0.1 per tick to prevent runaway zoom on hires trackpads
				self.scrollWheel = function(e){
					var delta = Math.max(-0.1, Math.min(0.1, e.originalEvent.deltaY * -0.005));

					var newZoomies = self.zoomFactor + delta;
					var containerOffset = $(self).parent().offset();
					var focalX = e.pageX - containerOffset.left;
					var focalY = e.pageY - containerOffset.top;
					plugin.apply_zoom.call(self, newZoomies, focalX, focalY);
				};
				$(self).parent().on("wheel." + self._evns, function(e){
					e.preventDefault();
					self.scrollWheel(e);
				});
			}
			$(self).parent().on("contextmenu." + self._evns, function(e){ e.preventDefault(); });
			//prevent browser native touch gestures (scroll, pinch-zoom) so pointer events fire uninterrupted
			$(self).parent().css("touch-action", "none");

			$(window).bind("pointermove." + self._evns, self.drawMove);

			//handles pointerup to finish drawing. disables is_drawing flag, 
			//and on some tools finalizes transfer of what was drawn on the fx canvas to the main canvas
			//stops toolbox drag
			self.drawStop = function(e){

				//remove pointer from tracking map on lift or cancel
				if(e.originalEvent && e.originalEvent.pointerType === "touch"){
					delete self.activePointers[e.originalEvent.pointerId];
				}

				//end gesture mode when fewer than two touch pointers remain
				if(self.isGesturing){
					if(Object.keys(self.activePointers).length < 2) self.isGesturing = false;
					return;
				}

				//middle-mouse drag: end pan mode
				if(self.isMiddleDragging){
					
					//console.warn("right drag: end");
					self.isMiddleDragging = false;
					return;
				}

				if($(self).data("is_drawing")==true){
					var mouse_data = plugin.get_mouse_data.call(self,e,self);

					//if(plugin.check_ignore(e)==true) return;
					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;
					var result;

					//flush the one lagging segment that smoothing holds back until a lookahead arrives
					if(self.active_brush.smoothing && self._smoothKnots && self._smoothKnots.length >= 2) {
						var knots = self._smoothKnots;
						var n = knots.length - 1;
						var stepSize = calculatedSize / 6;
						if(stepSize < 1) stepSize = 1;
						var p0 = knots[Math.max(0, n-2)];
						var p1 = knots[Math.max(0, n-1)];
						var p2 = knots[n];
						var flushAccum = self._smoothAccumDist;
						if(self._smoothLastStepSize && self._smoothLastStepSize !== stepSize) {
							flushAccum = flushAccum * (stepSize / self._smoothLastStepSize);
						}
						plugin.draw_catmull_segment.call(self, context, self.active_brush, p0, p1, p2, p2, stepSize, calculatedSize, calculatedAlpha, e, flushAccum);
						self._smoothKnots = null;
						self._smoothAccumDist = 0;
						self._smoothLastStepSize = null;
					}

					if(typeof self.active_brush.drawStop!=="undefined") result = self.active_brush.drawStop.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,calculatedAlpha,e);
					//if there is an action to undo
					if(typeof result!=="undefined"){
						plugin.record_undo_entry.call(self);
					  }
					plugin.request_redraw.call(self);
				}
				self._gestureAbortSnapshot = null;
				$(self).data("is_drawing",false).data("lastx",null).data("lasty",null);
				$(".drawr-toolbox").data("dragging", false);
				plugin.is_dragging=false;
			};
			$(window).bind("pointerup." + self._evns + " pointercancel." + self._evns, self.drawStop);
		};

		//function that can be called to clear the canvas from elsewhere in the plugin 
		//as long as you call it with a "this" of the canvas
		plugin.clear_canvas = function(record_undo){
			if(record_undo) {
				this.plugin.record_undo_entry.call(this);
			}
			var context = this.getContext("2d", { alpha: this.settings.enable_transparency });
			if(this.settings.enable_transparency==false){
				context.fillStyle="white";
				context.globalCompositeOperation="source-over";
				context.globalAlpha=1;
				context.fillRect(0,0,this.width,this.height);
			} else {
				context.clearRect(0,0,this.width,this.height);
			}
		};

		//Call this before any canvas manipulation. it is automatically done with most tool plugins.
		//works as long as you call it with a "this" of the canvas
		plugin.record_undo_entry = function(){
			if(typeof this.$undoButton!=="undefined"){
				this.$undoButton.css("opacity",1);
			}
			this.undoStack.push({data: this.toDataURL("image/png"),current: true});
			if(this.undoStack.length>(this.settings.undo_max_levels+1)) this.undoStack.shift();
			//new drawing action invalidates redo history
			this.redoStack = [];
			if(typeof this.$redoButton!=="undefined"){
				this.$redoButton.css("opacity",0.5);
			}
		};

		//calls a tool plugin's activate_brush call. 
		plugin.select_button = function(button){
			this.$brushToolbox.find(".drawr-tool-btn.type-brush").each(function(){
				$(this).removeClass("active");
				plugin.set_button_state(this, false);
			});
			$(button).addClass("active");
			plugin.set_button_state(button, true);
			plugin.activate_brush.call(this, $(button).data("data"));
		};

		//activates a brush ( a tool plugin ).
		plugin.activate_brush = function(brush){
			var context = this.getContext("2d", { alpha: this.settings.enable_transparency });
			if(typeof this.active_brush!=="undefined" && typeof this.active_brush.deactivate!=="undefined"){
				this.active_brush.deactivate.call(this,this.active_brush,context);
			}
			this.active_brush = brush;
			this.brushSize = typeof brush.size!=="undefined" ? brush.size : this.brushSize;
			this.brushAlpha = typeof brush.alpha!=="undefined" ? brush.alpha : this.brushAlpha;


			if(typeof this.$settingsToolbox!=="undefined") this.$settingsToolbox.find(".slider-alpha").val(this.brushAlpha*100).trigger("input");
			if(typeof this.$settingsToolbox!=="undefined") this.$settingsToolbox.find(".slider-size").val(this.brushSize).trigger("input");
			if(typeof this.$settingsToolbox!=="undefined") this.$settingsToolbox.find(".checkbox-alpha").prop("checked", !!brush.pressure_affects_alpha);
			if(typeof this.$settingsToolbox!=="undefined") this.$settingsToolbox.find(".checkbox-size").prop("checked",  !!brush.pressure_affects_size);

			this.active_brush.activate.call(this,this.active_brush,context);

			if(typeof this.$settingsToolbox!=="undefined"){
				var settings_brush = plugin.get_tool_by_name("default","settings");
				settings_brush.update.call(this);
			}
		};

		/* Inserts a button into a toolbox */
		plugin.create_button = function(toolbox,type,data,css){
			var self=this;

			var button_width = 100/self.settings.toolbox_cols;
			var el = $("<a class='drawr-tool-btn' style='cursor:pointer;float:left;display:block;margin:0px;'><i class='" + data.icon + "'></i></a>");
			el.css({ "outline" : "none", "text-align":"center","padding": "0px 0px 0px 0px","width" : button_width + "%", "background" : "#eeeeee", "color" : "#000000","border":"0px","min-height":"30px","user-select": "none", "text-align": "center", "border-radius" : "0px" });
			if(typeof css!=="undefined") el.css(css);
			el.addClass("type-" + type);
			el.data("data",data).data("type",type);

			el.on("pointerdown." + self._evns, function(e){
				if($(this).data("type")=="brush") plugin.select_button.call(self,this);
				if(typeof data.action!=="undefined") {
					var ctx = self.getContext("2d", { alpha: self.settings.enable_transparency });
					data.action.call(self,data,ctx);
				}
				if($(this).data("type")=="toggle") {//toggle data attribute and select effect
					if(typeof $(this).data("state")=="undefined") $(this).data("state",false);
					$(this).data("state",!$(this).data("state"));
					plugin.set_button_state(this, $(this).data("state"));
				}
				e.stopPropagation();
				e.preventDefault();
			});

			$(toolbox).append(el);
			if(typeof data.buttonCreated!=="undefined"){
				data.buttonCreated.call(self,data,el);
			}
			return el;
		};

		/* create a dropdown select inside a toolbox.
		   options: array of { value, label }
		   selected: currently selected value
		   returns the <select> element */
		plugin.create_dropdown = function(toolbox, title, options, selected){
			var key = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
			var optHtml = '';
			$.each(options, function(i, opt){
				optHtml += '<option value="' + opt.value + '"' + (opt.value === selected ? ' selected' : '') + '>' + opt.label + '</option>';
			});
			$(toolbox).append(
				'<div style="clear:both;text-align:left;padding:4px 8px;">' +
				'<label style="text-align:center;display:block;font-weight:bold;margin-bottom:2px;user-select:none;">' + title + '</label>' +
				'<select class="dropdown-component dropdown-' + key + '" style="color:#333;width:100%;box-sizing:border-box;cursor:pointer;">' +
				optHtml +
				'</select></div>'
			);
			$(toolbox).find('.dropdown-' + key).on('pointerdown touchstart mousedown', function(e){
				e.stopPropagation();
			});
			return $(toolbox).find('.dropdown-' + key);
		};

		/* create a checkbox */
		plugin.create_checkbox = function(toolbox, title, checked){
			var key = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
			$(toolbox).append(
				'<div style="clear:both;text-align:left;padding:4px 8px;">' +
				'<label style="cursor:pointer;user-select:none;">' +
				'<input type="checkbox" class="checkbox-component checkbox-' + key + '"' + (checked ? ' checked' : '') + ' style="margin-right:5px;">' +
				title +
				'</label></div>'
			);
			$(toolbox).find('.checkbox-' + key).on('pointerdown touchstart', function(e){
				e.stopPropagation();
			});
			return $(toolbox).find('.checkbox-' + key);
		};

		//create a label
		plugin.create_label = function(toolbox, title){
			$(toolbox).append(
				'<label style="text-align:center;padding:4px 8px;font-weight:bold;">' +
				title +
				'</label>'
			);
			return $(toolbox).find('label:last');
		};

		/* create a slider */
		plugin.create_slider = function(toolbox,title,min,max,value){
			var self=this;
			$(toolbox).append('<div style="clear:both;font-weight:bold;text-align:center;padding:5px 0px 5px 0px">' + title + '</div><div style="clear:both;display: inline-block;width: 50px;height: 40px;padding: 0;"><input class="slider-component slider-' + title.toLowerCase() + '" value="' + value + '" style="background:transparent;width: 70px;height: 30px;margin: 0px -10px 0px -10px;" type="range" min="' + min + '" max="' + max + '" step="1" /><span>' + value + '</span></div>');
			$(toolbox).find(".slider-" + title.toLowerCase()).on("pointerdown touchstart",function(e){
				e.stopPropagation();
			}).on("input." + self._evns,function(e){
				 $(this).next().text($(this).val());
			});
			return $(toolbox).find(".slider-" + title.toLowerCase());
		}

		//set some default settings. :)
		plugin.initialize_canvas = function(width,height,reset){

			this.origStyles = plugin.get_styles(this);
			this.origParentStyles = plugin.get_styles($(this).parent()[0]);
			$(this).css({ "display" : "block", "user-select": "none", "webkit-touch-callout": "none", "position": "relative", "z-index": 1 });
			$(this).parent().css({	"overflow": "hidden", "position": "relative", "user-select": "none", "webkit-touch-callout": "none" });

			const style = document.createElement('style');
			style.textContent = `
				.drawr-filepicker-fix::-webkit-file-upload-button {
					width: 38px;
				}
			`;
			document.head.appendChild(style);//hacky, but I don't know another way to do this. 

			if(!this.$bgCanvas){
				this.$bgCanvas = $("<canvas class='drawr-bg-canvas'></canvas>");
				this.$bgCanvas.css({"position":"absolute","z-index":0,"top":0,"left":0,"pointer-events":"none"});
				this.$bgCanvas.insertBefore(this);
			}

			if(this.width!==width || this.height!==height){//if statement because it resets otherwise.
				this.width=width;
				this.height=height;
			}
			
			if(reset==true){
				this.zoomFactor = 1;
				this.rotationAngle = 0;
				if(typeof this.$zoomToolbox!=="undefined") this.$zoomToolbox.find("input").val(100).trigger("input");
				plugin.apply_scroll.call(this,0,0,false);
				$(this).width(width);
				$(this).height(height);
			}

			plugin.draw_checkerboard.call(this);

			this.pen_pressure = false;//switches mode once it detects.
			
			var context = this.getContext("2d", { alpha: true });
			if(this.settings.clear_on_init==true){
				context.globalAlpha = 1;
				if(this.settings.enable_transparency==false){
					context.fillStyle="white";
					context.fillRect(0,0,width,height);
				} else {
					context.clearRect(0,0,width,height);
				}
			} 

			//memory canvas
			var context = this.$memoryCanvas[0].getContext("2d");
			context.fillStyle="blue";
			context.fillRect(0,0,width,height);
			var parent_width = $(this).parent().innerWidth();
			var parent_height = $(this).parent().innerHeight();

			this.$memoryCanvas.css({
				"z-index": 5,
				"position":"absolute",
				"width" : parent_width,
				"height" : parent_height
			});
			this.$memoryCanvas[0].width=parent_width;
			this.$memoryCanvas[0].height=parent_height;
			this.$memoryCanvas.width(parent_width);
			this.$memoryCanvas.height(parent_height);

		};

		//this is basically the animation/drawing loop. 
		//involves drawing the guide lines of where the drawing area ends.
		//and the scroll indicators.
		plugin.draw_animations = function(){
			if(!this.classList.contains("active-drawr")) return;//end drawing loop
			this._animFrameQueued = false;
			var context = this.memoryContext;
			context.clearRect(0,0,this.$memoryCanvas[0].width,this.$memoryCanvas[0].height);

			if(typeof this.effectCallback!=="undefined" && this.effectCallback!==null){
				var _W = this.width * this.zoomFactor;
				var _H = this.height * this.zoomFactor;
				var _cx = _W / 2 - this.scrollX;
				var _cy = _H / 2 - this.scrollY;
				context.save();
				context.translate(_cx, _cy);
				context.rotate(this.rotationAngle || 0);
				context.translate(-_cx, -_cy);
				this.effectCallback.call(this,context,this.active_brush,this.scrollX,this.scrollY,this.zoomFactor);
				context.restore();
			}

			var container_width = this.containerWidth;
			var container_height = this.containerHeight;

			context.globalAlpha = 0.5;//brush.currentAlpha;
			context.lineWidth = 1;
			context.lineJoin = context.lineCap = "round";
			context.strokeStyle = "black";

			//draw lines outlining canvas size (rotated with canvas)
			var _bW = this.width * this.zoomFactor;
			var _bH = this.height * this.zoomFactor;
			var _bcx = _bW / 2 - this.scrollX;
			var _bcy = _bH / 2 - this.scrollY;
			context.save();
			context.translate(_bcx, _bcy);
			context.rotate(this.rotationAngle || 0);
			context.strokeRect(-_bW / 2, -_bH / 2, _bW, _bH);
			context.restore();

			//debug_mode on: always show version label
			if(this.settings.debug_mode){
				context.save();
				context.globalAlpha = 0.75;
				context.fillStyle = "rgba(0,0,0,0.5)";
				context.fillRect(4, 4, 130, 18);
				context.globalAlpha = 1;
				context.fillStyle = "#fff";
				context.font = "bold 11px monospace";
				context.fillText("drawr v" + DRAWR_VERSION, 8, 17);
				context.restore();
			}

			//debug_mode on: draw a bunch of useful debug stuff when gesturing
			if(this.settings.debug_mode && this.isGesturing && this.gesturePivot){
				var _crossSize = 12;
				var _crossX = this.gesturePivot.x;
				var _crossY = this.gesturePivot.y;
				var _angle = this.rotationAngle || 0;
				var _lineLen = 40;
				context.save();
				context.globalAlpha = 1;
				context.strokeStyle = "red";
				context.lineWidth = 2;
				context.lineCap = "round";
				//cross
				context.beginPath();
				context.moveTo(_crossX - _crossSize, _crossY);
				context.lineTo(_crossX + _crossSize, _crossY);
				context.moveTo(_crossX, _crossY - _crossSize);
				context.lineTo(_crossX, _crossY + _crossSize);
				context.stroke();
				//rotation angle line
				context.beginPath();
				context.moveTo(_crossX, _crossY);
				context.lineTo(_crossX + Math.cos(_angle) * _lineLen, _crossY + Math.sin(_angle) * _lineLen);
				context.stroke();
				//zoom factor label
				context.fillStyle = "red";
				context.font = "bold 11px monospace";
				context.fillText("zoom: " + this.zoomFactor.toFixed(2) + "x", _crossX + _crossSize + 4, _crossY + _crossSize + 12);
				context.restore();
			}

			//scroll indicators
			if(this.scrollTimer>0){
				context.globalAlpha = Math.min(0.6, (0.6/100)*this.scrollTimer);
				this.scrollTimer-=5;
				context.lineWidth = 4;
				context.lineCap = 'square';

				//axis-aligned bounding box of the rotated canvas
				var _angle = this.rotationAngle || 0;
				var _W = this.width * this.zoomFactor;
				var _H = this.height * this.zoomFactor;
				var _abscos = Math.abs(Math.cos(_angle));
				var _abssin = Math.abs(Math.sin(_angle));
				var effectiveWidth  = _W * _abscos + _H * _abssin;
				var effectiveHeight = _W * _abssin + _H * _abscos;

				//When rotated, CSS transform-origin is the canvas element center (_W/2, _H/2).
				//The AABB left edge sits at (_W - effectiveWidth)/2 from the element's left edge,
				//not at 0. We need the scroll offset relative to that AABB origin so that the
				//visible-window calculation is correct in AABB space.
				var scrollX_aabb = this.scrollX - (_W - effectiveWidth) / 2;
				var scrollY_aabb = this.scrollY - (_H - effectiveHeight) / 2;

				//horizontal bar
				//hVisible: how many AABB pixels are actually showing in the viewport
				//hThumbW:  thumb width = visible fraction of total AABB width, mapped onto track
				//hThumbX:  thumb position = where the visible window starts in AABB space, mapped onto track
				var hVisible = Math.max(0, Math.min(effectiveWidth, scrollX_aabb + container_width) - Math.max(0, scrollX_aabb));
				var hThumbW  = Math.max(4, hVisible / effectiveWidth * container_width);
				var hThumbX  = Math.max(0, scrollX_aabb) / effectiveWidth * container_width;
				context.beginPath();
				context.moveTo(hThumbX, container_height-3);
				context.lineTo(hThumbX + hThumbW, container_height-3);
				context.stroke();

				//vertical bar
				var vVisible = Math.max(0, Math.min(effectiveHeight, scrollY_aabb + container_height) - Math.max(0, scrollY_aabb));
				var vThumbH  = Math.max(4, vVisible / effectiveHeight * container_height);
				var vThumbY  = Math.max(0, scrollY_aabb) / effectiveHeight * container_height;
				context.beginPath();
				context.moveTo(container_width-2, vThumbY);
				context.lineTo(container_width-2, vThumbY + vThumbH);
				context.stroke();
			}

			//we only keep the loop alive when there is work to do (effectCallback preview or scroll indicators fading in n out). Everything else is triggered via request_redraw.
			if((typeof this.effectCallback!=="undefined" && this.effectCallback!==null) || this.scrollTimer > 0 || (this.settings.debug_mode && this.isGesturing)){
				this._animFrameQueued = true;
				window.requestAnimationFrame(this.draw_animations_bound);
			}
		};

		//schedule one animation frame. ignored if a frame is already queued.
		//we call this whenever the memory canvas needs a refresh (border position changed due to scroll / rotation / zoom, or an effectCallback-using tool just started or stopped).
		plugin.request_redraw = function(){
			if(!this._animFrameQueued){
				this._animFrameQueued = true;
				window.requestAnimationFrame(this.draw_animations_bound);
			}
		};

		/* Create floating dialog and appends it hidden after the canvas */
		plugin.create_toolbox = function(id,position,title,width){
			var self = this;
			var toolbox = document.createElement("div");
			toolbox.innerHTML="<div style='padding:5px 0px 5px 0px'>" + title + "</div>";
			toolbox.className = "drawr-toolbox drawr-toolbox-" + id;
			toolbox.ownerCanvas = self;
			$(toolbox).css({
				"position" : "absolute", "z-index" : 6, "cursor" : "move", "width" : width + "px", "height" : "auto", "color" : "#fff",
				"padding" : "2px", "background" : "linear-gradient(to bottom, rgba(69,72,77,1) 0%,rgba(0,0,0,1) 100%)", "border-radius" : "2px",
				"box-shadow" : "0px 2px 5px -2px rgba(0,0,0,0.75)",	"user-select": "none", "font-family" : "sans-serif", "font-size" :"12px", "text-align" : "center"
			});
			$(toolbox).insertAfter($(this).parent());
			$(toolbox).offset(position);
			$(toolbox).hide();
			$(toolbox).on("pointerdown." + self._evns + " touchstart." + self._evns, function(e){
				if($(e.target).is("button, input, select, textarea, label, a") || $(e.target).closest("button, input, select, textarea, label, a").length) {
					e.preventDefault();//prevent native scroll, even if we don't wanna drag the toolbox.
					return;
				}
				var tbOffset = $(this).offset();
				var pageX = e.pageX || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0] && e.originalEvent.touches[0].pageX) || 0;
				var pageY = e.pageY || (e.originalEvent && e.originalEvent.touches && e.originalEvent.touches[0] && e.originalEvent.touches[0].pageY) || 0;
				$(this).data("offsetx", pageX - tbOffset.left).data("offsety", pageY - tbOffset.top).data("dragging", true);
				plugin.is_dragging=true;
				e.preventDefault();
			});
			return $(toolbox);
		};

		//draw the transparency checkerboard onto the background canvas at fixed 20px squares
		//if self.paperColorMode === "solid", fills with self.paperColor instead
		plugin.draw_checkerboard = function(){
			var self = this;
			if(!self.$bgCanvas) return;
			var W = Math.ceil(self.width * self.zoomFactor);
			var H = Math.ceil(self.height * self.zoomFactor);
			self.$bgCanvas[0].width = W;
			self.$bgCanvas[0].height = H;
			self.$bgCanvas.width(W);
			self.$bgCanvas.height(H);
			var ctx = self.$bgCanvas[0].getContext('2d');
			if(self.paperColorMode === "solid"){
				ctx.fillStyle = self.paperColor || '#ffffff';
				ctx.fillRect(0, 0, W, H);
			} else {
				var sz = 20 * self.zoomFactor;
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, W, H);
				ctx.fillStyle = '#cccccc';
				for(var row = 0; row * sz < H; row++){
					for(var col = row % 2; col * sz < W; col += 2){
						ctx.fillRect(col * sz, row * sz, sz, sz);
					}
				}
			}
			var angle = self.rotationAngle || 0;
			var sx = self.scrollX || 0;
			var sy = self.scrollY || 0;
			self.$bgCanvas.css("transform", plugin.canvas_transform(sx, sy, angle));
		};

		//call this to change scroll
		//if setTimer is set the scrollbars will show for a brief moment
		//we should probably do that with more operations later on. rotation could affect scroll, so
		plugin.apply_scroll = function(x,y,setTimer){
			var self = this;
			var angle = self.rotationAngle || 0;
			var transform = plugin.canvas_transform(x, y, angle);
			$(self).css("transform", transform);
			if(self.$bgCanvas) self.$bgCanvas.css("transform", transform);
			self.scrollX = x;
			self.scrollY = y;
			if(setTimer==true){
				self.scrollTimer= 500;
			}
			plugin.request_redraw.call(self);
		};

		//call this to set canvas rotation angle (radians).
		plugin.apply_rotation = function(angle,setTimer){
			var self = this;
			self.rotationAngle = angle;
			var transform = plugin.canvas_transform(self.scrollX, self.scrollY, angle);
			$(self).css("transform", transform);
			if(self.$bgCanvas) self.$bgCanvas.css("transform", transform);
			if(setTimer==true){
				self.scrollTimer= 500;
			}
			plugin.request_redraw.call(self);
		};

		//call this to set zoom. valid zoomFactor values are between 0.1 and 5
		//optional focalX,focalY: point relative to container to keep fixed during zoom. 
		//so you don't scroll when zooming with pinch, and zoom to the mouse with mousewheel
		plugin.apply_zoom = function(zoomFactor, focalX, focalY){
			var self = this;
			var oldZoom = self.zoomFactor;
			zoomFactor = Math.max(0.1, Math.min(5, zoomFactor));
			self.zoomFactor = zoomFactor;
			$(self).width(self.width*zoomFactor);
			$(self).height(self.height*zoomFactor);
			plugin.draw_checkerboard.call(self);
			if(oldZoom > 0 && zoomFactor !== oldZoom){
				if(focalX !== undefined){
					plugin.apply_scroll.call(self, (focalX + self.scrollX) * (zoomFactor / oldZoom) - focalX, (focalY + self.scrollY) * (zoomFactor / oldZoom) - focalY, true);
				} else {
					plugin.apply_scroll.call(self, self.scrollX * (zoomFactor / oldZoom), self.scrollY * (zoomFactor / oldZoom), true);
				}
			}

		};

		//gets an objects' computed styles so they can be restored after plugin destruction
		plugin.get_styles = function(el){
			var inlineStyles = {};
			for (var i = 0, l = el.style.length; i < l; i++){
				var styleProperty = el.style[i];
				var styleValue = getComputedStyle(el, null).getPropertyValue(styleProperty);
				inlineStyles[styleProperty]=styleValue;
			}
			return inlineStyles;
		};

		//toolset is only a parameter for more helpful errors.
		plugin.get_tool_by_name = function(toolset, toolname){
			var found = $.fn.drawr.availableTools.find(function(t){ return t.name == toolname; });
			if(!found) throw new Error("Tool " + toolname + " not found, as referenced in " + toolset);
			return found;
		};

		//instantiates and inserts toolbar buttons for the named toolset.
		//pass "default" to load all registered tools sorted by their order property,
		//or a custom toolset name previously defined via the "createtoolset" action.
		plugin.load_toolset = function(toolset){
			var self = this;
			self.current_toolset = toolset;

			if(toolset=="default"){
				$.fn.drawr.availableTools.sort(function(a,b) {return (a.order > b.order) ? 1 : ((b.order > a.order) ? -1 : 0);} );
				$.each($.fn.drawr.availableTools, function(i, tool){
					plugin.create_button.call(self, self.$brushToolbox[0], tool.type || "brush", tool);
				});
			} else {
				for(var tool_name of self.toolsets[toolset]){
					var tool = plugin.get_tool_by_name(toolset, tool_name);
					plugin.create_button.call(self, self.$brushToolbox[0], tool.type || "brush", tool);
				}
			}
		};

		//call with $(selector).drawr("export",mime). mime is optional, will default to png. returns a data url.
		if ( action == "export" ) {
			var currentCanvas = this.first()[0];
			if(typeof param !== "undefined" && typeof param !== "string") throw new Error("drawr export: mime type must be a string");
			var mime = typeof param=="undefined" ? "image/png" : param;
			return currentCanvas.toDataURL(mime);
		}

		//dynamically add a button, and return it so they can add event listeners to it etc.
		if( action == "button" ){
			var collection = $();
			this.each(function() {
				var currentCanvas = this;
				var newButton = plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],typeof param.type=="undefined" ? "action" : param.type,param);
				collection=collection.add(newButton);
			});
			return collection;
		}

		//Initialize canvas or calling of methods
		this.each(function() {

			var currentCanvas = this;	
			if ( action === "start") {
				if(!$(currentCanvas).hasClass("active-drawr")) {
					console.error("The element you are running this command on is not a drawr canvas.");
					return false;//can't start if not initialized.
				}

				if(typeof currentCanvas.current_toolset=="undefined" && currentCanvas.current_toolset!=="default"){
					plugin.load_toolset.call(currentCanvas,"default");
				}

				$(".drawr-toolbox").hide();
				$(".drawr-toolbox-brush").show();
				$(".drawr-toolbox-palette").show();
				currentCanvas.$brushToolbox.find(".drawr-tool-btn:first").trigger("pointerdown");		  
			} else if ( action === "clear" ) {

				if(typeof param !== "undefined" && typeof param !== "boolean") throw new Error("drawr clear: clear_undo must be a boolean");
				var clear_undo = typeof param!=="undefined" ? param : false;
				currentCanvas.plugin.clear_canvas.call(currentCanvas,false);

				if(clear_undo) {//re-add current version of the canvas.
					if(typeof currentCanvas.$undoButton!=="undefined") currentCanvas.$undoButton.css("opacity",0.5);
					if(typeof currentCanvas.$redoButton!=="undefined") currentCanvas.$redoButton.css("opacity",0.5);
					currentCanvas.undoStack = [];
					currentCanvas.redoStack = [];
				}

				currentCanvas.undoStack.push({data: currentCanvas.toDataURL("image/png"),current:true});

			} else if ( action === "stop" ) {
				if(!$(currentCanvas).hasClass("active-drawr")) {
					console.error("The element you are running this command on is not a drawr canvas.");
					return false;//can't stop if not initialized.
				}
				//reset togglers
				currentCanvas.$brushToolbox.find('.drawr-tool-btn.type-toggle').each(function(){
					if($(this).data("state")==true){
						$(this).trigger("pointerdown");
					}
				});
				$(".drawr-toolbox").hide();
			} else if ( action === "createtoolset" ) {
				if(typeof currentCanvas.toolsets=="undefined") currentCanvas.toolsets = {};
				if(typeof param!=="string" || typeof param2!=="object" || Array.isArray(param2)==false){
					throw new Error("Invalid parameters");
				}
				currentCanvas.toolsets[param] = param2;
			} else if ( action === "loadtoolset" ) {
				if(typeof currentCanvas.toolsets=="undefined") currentCanvas.toolsets = {};
				if(typeof param!=="string"){
					throw new Error("Invalid parameters");
				}
				if(param in currentCanvas.toolsets){
					plugin.load_toolset.call(currentCanvas,param);
				} else {
					throw new Error("Toolset not found");
				}
			} else if ( action === "activate_tool" ) {

				if(typeof param !== "string") throw new Error("drawr activate_tool: tool name must be a string");
				var tool = plugin.get_tool_by_name("activate_tool", param);
				var toolButton = null;
				currentCanvas.$brushToolbox.find(".drawr-tool-btn.type-brush").each(function(){
					if($(this).data("data") === tool) { toolButton = this; return false; }
				});
				if(toolButton) {
					plugin.select_button.call(currentCanvas, toolButton);
				} else {
					plugin.activate_brush.call(currentCanvas, tool);
				}

			} else if ( action === "zoom" ) {

				if(typeof param !== "number") throw new Error("drawr setzoom: param must be a number");
				plugin.apply_zoom.call(currentCanvas, param);

			} else if ( action === "center" ) {

				var _cw = currentCanvas.width  * currentCanvas.zoomFactor;
				var _ch = currentCanvas.height * currentCanvas.zoomFactor;
				var _cx = (_cw - currentCanvas.containerWidth)  / 2;
				var _cy = (_ch - currentCanvas.containerHeight) / 2;
				plugin.apply_scroll.call(currentCanvas, _cx, _cy, false);

			} else if ( action === "movetoolbox" ) {

				if(typeof param !== "object" || param === null || Array.isArray(param)) throw new Error("drawr movetoolbox: param must be an object");
				if(typeof param.x !== "number" || typeof param.y !== "number") throw new Error("drawr movetoolbox: param.x and param.y must be numbers");
				currentCanvas.$brushToolbox.css("left",($(currentCanvas).parent().offset().left + param.x) + "px");
				currentCanvas.$brushToolbox.css("top",($(currentCanvas).parent().offset().top + param.y) + "px");
				
			//call with $(selector).drawr("load",something) to load an image.
			//todo: document what something is. at least the output of a filereader onload (e.target.result) whatever that is.
			} else if ( action === "load" ) {
				if(!$(currentCanvas).hasClass("active-drawr")) {
					console.error("The element you are running this command on is not a drawr canvas.");
					return false;//can't load if not initialized.
				}
				var img = document.createElement("img");
				img.crossOrigin = "Anonymous";

				img.onload = function(){
					var context = currentCanvas.getContext("2d", { alpha: currentCanvas.settings.enable_transparency });
					plugin.initialize_canvas.call(currentCanvas,img.width,img.height,true);
					currentCanvas.undoStack = [{data: currentCanvas.toDataURL("image/png"),current:true}];
					context.drawImage(img,0,0);
				};
				img.src=param;
			//call with $(selector).drawr("destroy") 
			//should undo everything that was done to the canvas and its parent container, returning it to its original state.
			} else if ( action === "destroy" ) {
				if(!$(currentCanvas).hasClass("active-drawr")) {
					console.error("The element you are running this command on is not a drawr canvas.");
					return false;//can't destroy if not initialized.
				}
				var parent = $(currentCanvas).parent();
				var evns = currentCanvas._evns;
				parent.off("touchstart." + evns);
				parent.off("wheel." + evns);
				parent.off("contextmenu." + evns);
				parent.find(".drawr-toolbox .drawr-tool-btn").off("pointerdown." + evns);
				parent.find(".drawr-toolbox .slider-component").off("input." + evns);
				parent.find(".drawr-toolbox").off("pointerdown." + evns + " touchstart." + evns);
				$(window).unbind("pointerup." + evns + " pointercancel." + evns, currentCanvas.drawStop);
				$(window).unbind("pointermove." + evns, currentCanvas.drawMove);
				$(window).unbind("pointerdown." + evns, currentCanvas.drawStart);
				$(window).unbind("wheel." + evns, currentCanvas.scrollWheel);
				$(window).off("resize." + evns, currentCanvas.onWindowResize);

				$.each($.fn.drawr.availableTools,function(i,tool){
					if(typeof tool.cleanup!=="undefined"){
						tool.cleanup.call(currentCanvas);
					}
				});

				currentCanvas.$memoryCanvas.remove();
				if(currentCanvas.$bgCanvas){ currentCanvas.$bgCanvas.remove(); delete currentCanvas.$bgCanvas; }
				currentCanvas.$brushToolbox.remove();

				delete currentCanvas.$memoryCanvas;
				delete currentCanvas.memoryContext;
				delete currentCanvas.draw_animations_bound;
				delete currentCanvas.onWindowResize;
				delete currentCanvas.containerWidth;
				delete currentCanvas.containerHeight;
				delete currentCanvas.$brushToolbox;
				delete currentCanvas.plugin;
				delete currentCanvas.settings;
				delete currentCanvas.undoStack;
				delete currentCanvas.redoStack;
				delete currentCanvas.brushColor;
				delete currentCanvas.brushBackColor;
				delete currentCanvas.active_brush;
				delete currentCanvas.zoomFactor;
				delete currentCanvas.scrollX;
				delete currentCanvas.scrollY;
				delete currentCanvas.rotationAngle;
				delete currentCanvas.brushSize;
				delete currentCanvas.brushAlpha;
				delete currentCanvas.pen_pressure;
				delete currentCanvas.drawStart;
				delete currentCanvas.boundCheck;
				delete currentCanvas.containerBoundCheck;
				delete currentCanvas.drawMove;
				delete currentCanvas.drawStop;
				delete currentCanvas.scrollWheel;
				delete currentCanvas.current_toolset;
				delete currentCanvas.scrollTimer;

				//reset css and visuals and scrolls
				$(currentCanvas).width(currentCanvas.width);
				$(currentCanvas).height(currentCanvas.height);
				$(currentCanvas).css("transform","translate(0px,0px)");

				//reset styles to what they were.
				$(currentCanvas).attr('style', '');
				$(currentCanvas).parent().attr('style', '');
				$(currentCanvas).css(currentCanvas.origStyles);
				$(currentCanvas).parent().css(currentCanvas.origParentStyles);

				delete currentCanvas.origStyles;
				delete currentCanvas.origParentStyles;

				$(currentCanvas).removeClass("active-drawr");
				$(currentCanvas).parent().removeClass("drawr-container");
			//not an action, but an init call
			} else if ( typeof action == "object" || typeof action =="undefined" ){
				if($(currentCanvas).hasClass("active-drawr")) return false;//prevent double init
				currentCanvas.className = currentCanvas.className + " active-drawr";
				$(currentCanvas).parent().addClass("drawr-container");

				//determine settings
				var defaultSettings = {
					"enable_transparency" : true,
					"enable_scrollwheel_zooming" : true,
					"canvas_width" : $(currentCanvas).parent().innerWidth(),
					"canvas_height" : $(currentCanvas).parent().innerHeight(),
					"undo_max_levels" : 5,
					"color_mode" : "picker",
					"clear_on_init" : true,
					"toolbox_cols" : 3,
					"debug_mode" : false,
					"paper_color_mode" : "checkerboard",
					"paper_color" : "#ffffff"
				};
				if(typeof action == "object") defaultSettings = Object.assign(defaultSettings, action);
				currentCanvas.settings = defaultSettings;

				//set up special effects layer
				currentCanvas.$memoryCanvas=$("<canvas class='sfx-canvas'></canvas>");
				currentCanvas.$memoryCanvas.insertBefore(currentCanvas);
				currentCanvas.memoryContext = currentCanvas.$memoryCanvas[0].getContext("2d");

				//cache container dimensions; kept up to date via resize handler
				var _parent = $(currentCanvas).parent();
				currentCanvas.containerWidth = _parent.width();
				currentCanvas.containerHeight = _parent.height();
				currentCanvas._evns = "drawr_" + Math.random().toString(36).slice(2, 9);//event namespace so destroying one drawr instance doesn't affect others.
				currentCanvas.onWindowResize = function() {
					currentCanvas.containerWidth = _parent.width();
					currentCanvas.containerHeight = _parent.height();
				};
				$(window).on("resize." + currentCanvas._evns, currentCanvas.onWindowResize);

				currentCanvas.plugin = plugin;
				currentCanvas.rotationAngle = 0;
				currentCanvas.draw_animations_bound = plugin.draw_animations.bind(currentCanvas);
				currentCanvas._animFrameQueued = false;

				currentCanvas.paperColorMode = currentCanvas.settings.paper_color_mode;
				currentCanvas.paperColor = currentCanvas.settings.paper_color;

				//set up canvas
				plugin.initialize_canvas.call(currentCanvas,defaultSettings.canvas_width,defaultSettings.canvas_height,true);
				currentCanvas.undoStack = [{data:currentCanvas.toDataURL("image/png"),current:true}];
				currentCanvas.redoStack = [];
				var context = currentCanvas.getContext("2d", { alpha: defaultSettings.enable_transparency });
				currentCanvas.brushColor = { r: 0, g: 0, b: 0 };
				currentCanvas.brushBackColor = { r: 255, g: 255, b: 255 };


				//brush dialog
				var width = defaultSettings.toolbox_cols * 40;
				currentCanvas.$brushToolbox = plugin.create_toolbox.call(currentCanvas,"brush",{ left: $(currentCanvas).parent().offset().left, top: $(currentCanvas).parent().offset().top },"Tools",width);

				plugin.bind_draw_events.call(currentCanvas);
			}
		});
		return this;
 
	};

	/* Register a new tool */
	$.fn.drawr.register = function (tool){
		if(typeof $.fn.drawr.availableTools=="undefined") $.fn.drawr.availableTools=[];
		$.fn.drawr.availableTools.push(tool);
	};

}( jQuery ));
