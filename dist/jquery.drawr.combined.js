(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define(["jquery"], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory(require("jquery"));
  } else {
    factory(root.jQuery);
  }
}(typeof self !== "undefined" ? self : this, function ($) {
  //"use strict";
  if (!$) throw new Error("jquery-drawr requires jQuery");
  var jQuery = $;
/*!
 * jquery-drawr
 * Copyright (c) 2019–present Avokicchi
 * Released under the MIT License
 */

(function( $ ) {

	var DRAWR_VERSION = "1.0.0";

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
		plugin.calc_brush_params = function(brush, brushSize, brushAlpha, pressure, pen_pressure){
			return {
				alpha: (brush.pressure_affects_alpha && pen_pressure) ? Math.min(1, brushAlpha * pressure * 2) : brushAlpha,
				size:  parseFloat((brush.pressure_affects_size && pen_pressure) ? Math.max(1, brushSize * pressure * 2) : brushSize)
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

		//Evaluates a centripetal Catmull-Rom spline (alpha=0.5) at parameter u (0..1) for the
		//segment p1 -> p2, using p0 and p3 as the outer control points. The centripetal
		//parameterisation guarantees no cusps or loops regardless of knot spacing or sharp
		//direction changes — unlike the uniform variant which overshoots into loops at turns.
		//Uses the Barry–Goldman recursive form (three linear interpolations per level, three levels),
		//which is numerically friendlier for drawing apps than expanding the basis polynomials.
		//Refs:
		//Catmull-Rom spline — https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline
		//Barry–Goldman algorithm — https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm (same idea,
		//generalised to non-uniform knot spacing; see also Yuksel et al., "On the Parameterization of
		//Catmull-Rom Curves", 2011 — http://www.cemyuksel.com/research/catmullrom_param/).
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

		//central per-spot pipeline. applies brush dynamics (size/opacity/angle jitter, flow,
		//scatter, rotation mode, fade-in) on top of the calculated base size/alpha, then calls
		//brush.drawSpot with the resolved values. all three interpolation loops (drawMove linear,
		//Catmull-Rom, drawStop flush) funnel through here so dynamics apply uniformly.
		//strokeAngleRad: direction of travel at this spot in radians (atan2(dx, dy) convention
		//matching plugin.angle_between); undefined means no direction available (first/stationary spot).
		plugin.emit_spot = function(context, brush, baseX, baseY, strokeAngleRad, size, alpha, e) {
			var self = this;

			//size jitter: per-spot multiplier clamped to [0.1, 2] so a 100% jitter can't zero out.
			var sizeJitter = brush.size_jitter || 0;
			var sizeMul = 1 + (Math.random() * 2 - 1) * sizeJitter;
			if(sizeMul < 0.1) sizeMul = 0.1;
			if(sizeMul > 2)   sizeMul = 2;
			var finalSize = Math.max(1, size * sizeMul);

			//fade-in first, then flow and opacity jitter. opacity_jitter only reduces (Photoshop-style).
			var spotAlpha = alpha;
			if(brush.brush_fade_in){
				self._fadeInSpotCount++;
				spotAlpha = alpha * Math.min(1, self._fadeInSpotCount / brush.brush_fade_in);
			}
			var flow = (typeof brush.flow !== "undefined") ? brush.flow : 1;
			var opJitter = brush.opacity_jitter || 0;
			spotAlpha = spotAlpha * flow * (1 - Math.random() * opJitter);

			//angle resolution from rotation_mode.
			var mode = brush.rotation_mode || "none";
			var angle = 0;
			if(mode === "fixed"){
				angle = brush.fixed_angle || 0;
			} else if(mode === "follow_stroke"){
				angle = (typeof strokeAngleRad === "number") ? strokeAngleRad : 0;
			} else if(mode === "random_jitter"){
				angle = Math.random() * Math.PI * 2;
			} else if(mode === "follow_jitter"){
				var base = (typeof strokeAngleRad === "number") ? strokeAngleRad : 0;
				angle = base + (Math.random() * 2 - 1) * (brush.angle_jitter || 0) * Math.PI;
			}

			//scatter: perpendicular offset from the stroke direction, magnitude as fraction of base size.
			var ox = 0, oy = 0;
			var scatter = brush.scatter || 0;
			if(scatter > 0 && typeof strokeAngleRad === "number"){
				var perp = strokeAngleRad + Math.PI / 2;
				var mag = (Math.random() * 2 - 1) * scatter * size;
				//stroke angle uses atan2(dx,dy), so sin(angle)=dx-component, cos(angle)=dy-component
				ox = Math.sin(perp) * mag;
				oy = Math.cos(perp) * mag;
			}

			if(typeof brush.drawSpot !== "undefined"){
				brush.drawSpot.call(self, brush, context, baseX + ox, baseY + oy, finalSize, spotAlpha, e, angle);
			}
		};

		//walks the Catmull-Rom segment p1 -> p2 (influenced by p0 and p3) at arc-length steps of
		//stepSize, calling emit_spot at each step. accepts a carry-in accumDist so that
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
					//interpolate the exact arc-length position along prevPt->pt so that
					//multiple spots within one sample step are spread out, not stacked.
					var ratio = stepDist > 0 ? Math.max(0, Math.min(1, 1 - accumDist / stepDist)) : 1;
					var spotX = prevPt.x + (pt.x - prevPt.x) * ratio;
					var spotY = prevPt.y + (pt.y - prevPt.y) * ratio;
					//derive stroke direction from the spline tangent on this sample step.
					var spotAngle = (stepDist > 0) ? plugin.angle_between(prevPt, pt) : undefined;
					plugin.emit_spot.call(self, context, brush, spotX, spotY, spotAngle, size, alpha, e);
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
						var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure, self.pen_pressure);
						var calculatedAlpha = bp.alpha, calculatedSize = bp.size;

						$(self).data("positions",[{x:mouse_data.x,y:mouse_data.y}]);
						if(self.active_brush.smoothing) { self._smoothKnots = [{x: mouse_data.x, y: mouse_data.y}]; self._smoothAccumDist = 0; self._smoothLastStepSize = null; }
						var startAlpha = calculatedAlpha;
						if(self.active_brush.brush_fade_in){
							self._fadeInSpotCount++;
							startAlpha = calculatedAlpha * Math.min(1, self._fadeInSpotCount / self.active_brush.brush_fade_in);
						}
						//first spot has no stroke direction yet so we pass angle=0 so tools consuming
						//the 8th arg get a deterministic value. fade-in already applied inline above,
						//so this call bypasses emit_spot to avoid double-incrementing the counter.
						if(typeof self.active_brush.drawStart!=="undefined") self.active_brush.drawStart.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,startAlpha,e,0);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,startAlpha,e,0);
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

					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure, self.pen_pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;
					//spacing as a fraction of size (brush dynamics). fallback to 0.25 matches the old hardcoded /4.
					var spacingFrac = (typeof self.active_brush.spacing === "number") ? self.active_brush.spacing : 0.25;
					var stepSize = calculatedSize * spacingFrac;
					if(stepSize<1) stepSize = 1;

					if(self.active_brush.smoothing) {
						//smooth path: buffer raw knots and draw a Catmull-Rom segment lagging one event behind,
						//using the new knot as the lookahead (P3) that shapes the tangent of the previous segment.
						//Only accept a new knot if it is far enough from the last one. Sub-pixel (or near-pixel)
						//knot spacing gives the spline no room to round corners, so high-precision stylus input
						//would pass through every jitter point rather than smoothing over them.
						var lastKnot = self._smoothKnots[self._smoothKnots.length - 1];
						if(plugin.distance_between(lastKnot, {x: mouse_data.x, y: mouse_data.y}) < stepSize * 1.5) return;//todo: make 1.5 a variable; we can tune linesmoothing with this.
						self._smoothKnots.push({x: mouse_data.x, y: mouse_data.y});
						var knots = self._smoothKnots;
						var n = knots.length - 1; //last index
						if(n >= 2) {
							//draw segment knots[n-2]->knots[n-1]; knots[n] is the lookahead control point
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
							plugin.emit_spot.call(self, context, self.active_brush, x, y, angle, calculatedSize, calculatedAlpha, e);
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
			//middle mouse button is claimed for canvas panning, so block the browser's autoscroll-on-middle-click
			//over the whole container. Autoscroll fires on `mousedown` (not pointerdown), hence the separate bind.
			$(self).parent().on("mousedown." + self._evns, function(e){
				if(e.button === 1) e.preventDefault();
			});
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
					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure, self.pen_pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;
					var result;

					//flush the one lagging segment that smoothing holds back until a lookahead arrives
					if(self.active_brush.smoothing && self._smoothKnots && self._smoothKnots.length >= 2) {
						var knots = self._smoothKnots;
						var n = knots.length - 1;
						//unified: same spacing as the move loop, so the flush stamps consistently with the rest of the stroke.
						var spacingFrac = (typeof self.active_brush.spacing === "number") ? self.active_brush.spacing : 0.25;
						var stepSize = calculatedSize * spacingFrac;
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
				$(".drawr-toolbox").each(function(){
					if($(this).data("dragging") == true){
						var owner = this.ownerCanvas;
						if(owner && owner._toolboxPositions){
							var containerOffset = $(owner).parent().offset();
							var o = $(this).offset();
							owner._toolboxPositions[$(this).data("toolbox-id")] = {
								left: o.left - containerOffset.left,
								top:  o.top  - containerOffset.top
							};
						}
					}
				});
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
		//---- Persistence & cross-instance sync -------------------------------------------------
		//Two localStorage keys: drawr.toolOverrides ({ [name]: { field: value } }) for built-in tools,
		//and drawr.customBrushes ([ { id, ... } ]) for user-created brushes (step 8 populates these).
		//Writes propagate to (a) all same-page drawr canvases via $.fn.drawr._instances, and (b) other
		//tabs via the storage event. The writing tab does not receive its own storage event.

		plugin.read_overrides = function(){
			try {
				var raw = window.localStorage.getItem("drawr.toolOverrides");
				return raw ? JSON.parse(raw) : {};
			} catch(e) { return {}; }
		};

		plugin.write_overrides = function(obj){
			try { window.localStorage.setItem("drawr.toolOverrides", JSON.stringify(obj)); } catch(e){}
		};

		plugin.read_custom_brushes = function(){
			try {
				var raw = window.localStorage.getItem("drawr.customBrushes");
				return raw ? JSON.parse(raw) : [];
			} catch(e) { return []; }
		};

		plugin.write_custom_brushes = function(arr){
			try { window.localStorage.setItem("drawr.customBrushes", JSON.stringify(arr)); } catch(e){}
		};

		//apply overrides from localStorage onto already-registered tools. idempotent — safe to re-run.
		//sets a guard so we don't iterate every call; set `force=true` to re-apply after a storage event.
		plugin.apply_overrides = function(force){
			if($.fn.drawr._overridesApplied && !force) return;
			var overrides = plugin.read_overrides();
			if(!$.fn.drawr.availableTools) return;
			$.each($.fn.drawr.availableTools, function(i, tool){
				if(!tool.removable && overrides[tool.name]){
					var patch = overrides[tool.name];
					for(var field in patch){
						if(Object.prototype.hasOwnProperty.call(patch, field)) tool[field] = patch[field];
					}
				}
			});
			$.fn.drawr._overridesApplied = true;
		};

		//refresh settings UI on every registered instance whose active brush matches the given toolName.
		//Used both by persist_tool_setting (same-page broadcast) and by the storage-event handler (cross-tab).
		plugin.broadcast_dynamics_change = function(toolName){
			var instances = $.fn.drawr._instances || [];
			for(var i = 0; i < instances.length; i++){
				var inst = instances[i];
				if(!inst || !inst.active_brush) continue;
				if(inst.active_brush.name !== toolName) continue;
				if(typeof inst.$settingsToolbox === "undefined") continue;
				var settings_brush = plugin.get_tool_by_name("default","settings");
				if(settings_brush && typeof settings_brush.update === "function"){
					settings_brush.update.call(inst);
				}
			}
		};

		//persist a single dynamics field change. For built-in tools, writes into drawr.toolOverrides;
		//for custom (removable) brushes, updates the matching record in drawr.customBrushes.
		plugin.persist_tool_setting = function(brush, field, value){
			if(!brush) return;
			if(brush.removable){
				//custom brush: update the matching record by id (tool exposes it as _id).
				var brushes = plugin.read_custom_brushes();
				var found = false;
				for(var i = 0; i < brushes.length; i++){
					if(brushes[i].id === brush._id){
						brushes[i][field] = value;
						found = true;
						break;
					}
				}
				if(found) plugin.write_custom_brushes(brushes);
			} else {
				//built-in: write into drawr.toolOverrides[name][field].
				var overrides = plugin.read_overrides();
				if(!overrides[brush.name]) overrides[brush.name] = {};
				overrides[brush.name][field] = value;
				plugin.write_overrides(overrides);
			}
			plugin.broadcast_dynamics_change(brush.name);
		};

		//Reset a built-in tool to the defaults snapshotted at register() time.
		//Copies each field from tool._defaults back onto the tool, and deletes fields that the original
		//declaration didn't have. Also wipes the drawr.toolOverrides entry so the reset persists.
		plugin.reset_tool_defaults = function(brush){
			if(!brush || !brush._defaults) return;
			var fields = $.fn.drawr._dynamicsFields || [];
			for(var i = 0; i < fields.length; i++){
				var f = fields[i];
				if(typeof brush._defaults[f] !== "undefined"){
					brush[f] = brush._defaults[f];
				} else {
					delete brush[f];
				}
			}
			if(!brush.removable){
				var overrides = plugin.read_overrides();
				if(overrides[brush.name]){
					delete overrides[brush.name];
					plugin.write_overrides(overrides);
				}
			}
			plugin.broadcast_dynamics_change(brush.name);
		};

		//Factory: produce a full tool object from a persisted custom-brush record.
		//Record shape: { id, name, icon, image_data_url, size, alpha, flow, spacing,
		//   rotation_mode, fixed_angle, angle_jitter, size_jitter, opacity_jitter, scatter,
		//   smoothing, brush_fade_in, pressure_affects_alpha, pressure_affects_size }
		//Used both at create-time (from the custom-brush dialog) and at boot hydration.
		$.fn.drawr.buildCustomBrush = function(record){
			var tool = {
				//identification
				icon: "mdi " + (record.icon || "mdi-puzzle") + " mdi-24px",
				name: "custom:" + record.id,
				_id: record.id,
				_displayName: record.name,
				removable: true,
				order: 1000,
				//dynamics (mirror the record so emit_spot reads from the live tool)
				size:           typeof record.size === "number" ? record.size : 15,
				alpha:          typeof record.alpha === "number" ? record.alpha : 1,
				flow:           typeof record.flow === "number" ? record.flow : 1,
				spacing:        typeof record.spacing === "number" ? record.spacing : 0.25,
				rotation_mode:  record.rotation_mode || "follow_stroke",
				fixed_angle:    typeof record.fixed_angle === "number" ? record.fixed_angle : 0,
				angle_jitter:   typeof record.angle_jitter === "number" ? record.angle_jitter : 0,
				size_jitter:    typeof record.size_jitter === "number" ? record.size_jitter : 0,
				opacity_jitter: typeof record.opacity_jitter === "number" ? record.opacity_jitter : 0,
				scatter:        typeof record.scatter === "number" ? record.scatter : 0,
				smoothing:      !!record.smoothing,
				brush_fade_in:  typeof record.brush_fade_in === "number" ? record.brush_fade_in : 0,
				pressure_affects_alpha: record.pressure_affects_alpha !== false,
				pressure_affects_size:  !!record.pressure_affects_size,
				activate: function(brush, context){
					brush._rawImage = new Image();
					brush._rawImage.crossOrigin = "Anonymous";
					brush._stampCache = null;
					brush._stampCacheKey = null;
					brush._rawImage.src = record.image_data_url;
				},
				deactivate: function(brush, context){},
				drawStart: function(brush, context, x, y, size, alpha, event){
					context.globalCompositeOperation = "source-over";
					context.globalAlpha = alpha;
				},
				//render a colorized copy of the brush image, rotated by the engine-provided angle.
				drawSpot: function(brush, context, x, y, size, alpha, event, angle){
					if(!brush._rawImage || !brush._rawImage.complete) return;
					var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
					var cacheKey = color.r + "," + color.g + "," + color.b;
					if(brush._stampCacheKey !== cacheKey){
						var img = brush._rawImage;
						var buffer = document.createElement("canvas");
						buffer.width = img.width;
						buffer.height = img.height;
						var bctx = buffer.getContext("2d");
						bctx.fillStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
						bctx.fillRect(0, 0, img.width, img.height);
						bctx.globalCompositeOperation = "destination-atop";
						bctx.drawImage(img, 0, 0);
						brush._stampCache = buffer;
						brush._stampCacheKey = cacheKey;
					}
					context.globalAlpha = alpha;
					var drawSize = Math.max(2, Math.round(size));
					var image = brush._stampCache;
					context.save();
					context.translate(x, y);
					context.rotate(angle || 0);
					var iw, ih;
					if(image.width >= image.height){
						ih = image.height / (image.width / drawSize);
						iw = drawSize;
					} else {
						iw = image.width / (image.height / drawSize);
						ih = drawSize;
					}
					context.drawImage(image, -iw/2, -ih/2, iw, ih);
					context.restore();
				},
				drawStop: function(brush, context, x, y, size, alpha, event){
					return true;
				}
			};
			return tool;
		};

		//Hydrate persisted custom brushes into the global registry. Guarded so multiple drawr
		//instances on the same page don't double-register. Called from load_toolset before
		//the toolbar buttons are created.
		$.fn.drawr.hydrate_custom_brushes = function(){
			if($.fn.drawr._customBrushesHydrated) return;
			$.fn.drawr._customBrushesHydrated = true;
			var records = plugin.read_custom_brushes();
			for(var i = 0; i < records.length; i++){
				$.fn.drawr.register($.fn.drawr.buildCustomBrush(records[i]));
			}
		};

		//Reconcile the global registry with the localStorage list. Called on storage events and after
		//any in-process add/remove. Diffs by id; adds missing, removes deleted, patches fields on
		//existing entries. Touches all registered drawr instances so their toolbars stay in sync.
		$.fn.drawr.reconcile_custom_brushes = function(){
			if(!$.fn.drawr.availableTools) return;
			var records = plugin.read_custom_brushes();
			var recordById = {};
			for(var i = 0; i < records.length; i++) recordById[records[i].id] = records[i];

			//collect current registered custom brushes (by id)
			var existingById = {};
			for(var j = 0; j < $.fn.drawr.availableTools.length; j++){
				var t = $.fn.drawr.availableTools[j];
				if(t.removable && t._id) existingById[t._id] = t;
			}

			//add brushes present in storage but not registered
			for(var id in recordById){
				if(!existingById[id]){
					var tool = $.fn.drawr.buildCustomBrush(recordById[id]);
					$.fn.drawr.register(tool);
					//create toolbar buttons on every active instance
					var instances = $.fn.drawr._instances || [];
					for(var k = 0; k < instances.length; k++){
						var inst = instances[k];
						if(inst && inst.$brushToolbox && inst.$brushToolbox.length){
							plugin.create_toolbutton.call(inst, inst.$brushToolbox[0], tool.type || "brush", tool);
						}
					}
				}
			}

			//remove brushes registered but not present in storage
			for(var eid in existingById){
				if(!recordById[eid]){
					var etool = existingById[eid];
					//remove from availableTools
					var idx = $.fn.drawr.availableTools.indexOf(etool);
					if(idx >= 0) $.fn.drawr.availableTools.splice(idx, 1);
					//remove DOM buttons on every instance (match by tool data reference)
					var insts = $.fn.drawr._instances || [];
					for(var kk = 0; kk < insts.length; kk++){
						var ii = insts[kk];
						if(ii && ii.$brushToolbox){
							ii.$brushToolbox.find(".drawr-tool-btn").each(function(){
								if($(this).data("data") === etool) $(this).remove();
							});
						}
					}
				}
			}

			//patch fields on brushes that exist in both but may have changed (e.g. edited in another tab).
			//We only copy the canonical dynamics fields — not id/icon/image_data_url, which shouldn't
			//change for an existing brush — so reuse the single source of truth for that list.
			var dynFields = $.fn.drawr._dynamicsFields || [];
			for(var eid2 in existingById){
				if(recordById[eid2]){
					var rec = recordById[eid2];
					var tool2 = existingById[eid2];
					for(var m = 0; m < dynFields.length; m++){
						var f = dynFields[m];
						if(typeof rec[f] !== "undefined") tool2[f] = rec[f];
					}
					tool2._displayName = rec.name;
				}
			}
		};

		//one-time storage-event binding to sync overrides/custom-brushes from other tabs.
		plugin.bind_storage_listener = function(){
			if($.fn.drawr._storageBound) return;
			$.fn.drawr._storageBound = true;
			window.addEventListener("storage", function(e){
				if(!e || !e.key) return;
				if(e.key === "drawr.toolOverrides"){
					//reapply overrides onto all tools, then refresh settings UI on instances where the
					//active brush might have changed. we don't know which tool changed, so refresh each.
					plugin.apply_overrides(true);
					var instances = $.fn.drawr._instances || [];
					for(var i = 0; i < instances.length; i++){
						var inst = instances[i];
						if(inst && inst.active_brush && typeof inst.$settingsToolbox !== "undefined"){
							plugin.broadcast_dynamics_change(inst.active_brush.name);
						}
					}
				} else if(e.key === "drawr.customBrushes"){
					//step 8 handles custom-brush add/remove reconciliation across tabs.
					if(typeof $.fn.drawr.reconcile_custom_brushes === "function"){
						$.fn.drawr.reconcile_custom_brushes();
					}
				}
			});
		};

		plugin.activate_brush = function(brush){
			var context = this.getContext("2d", { alpha: this.settings.enable_transparency });
			if(typeof this.active_brush!=="undefined" && typeof this.active_brush.deactivate!=="undefined"){
				this.active_brush.deactivate.call(this,this.active_brush,context);
			}
			this.active_brush = brush;
			this.brushSize = typeof brush.size!=="undefined" ? brush.size : this.brushSize;
			this.brushAlpha = typeof brush.alpha!=="undefined" ? brush.alpha : this.brushAlpha;

			this.active_brush.activate.call(this,this.active_brush,context);

			//settings.update() handles syncing all UI controls (sliders, checkboxes, Advanced section)
			//to the newly-activated brush, under an internal _suppressSettingsWrite guard so the sync
			//doesn't accidentally persist overrides.
			if(typeof this.$settingsToolbox!=="undefined"){
				var settings_brush = plugin.get_tool_by_name("default","settings");
				settings_brush.update.call(this);
			}
		};

		/* Inserts a button into a toolbox */
		plugin.create_toolbutton = function(toolbox,type,data,css){
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

			//removable tools (custom brushes) get a small × overlay that deletes the brush.
			//stopPropagation so clicking × doesn't also select the brush underneath.
			if(data.removable){
				el.css("position", "relative");
				var $x = $("<span class='drawr-tool-x' title='Remove brush'>×</span>");
				$x.css({
					position: "absolute", top: "0px", right: "2px",
					width: "12px", height: "12px", lineHeight: "10px", fontSize: "14px",
					color: "#900", background: "rgba(255,255,255,0.7)", borderRadius: "50%",
					textAlign: "center", cursor: "pointer", userSelect: "none", zIndex: 1
				});
				$x.on("pointerdown." + self._evns + " mousedown." + self._evns, function(e){
					e.stopPropagation();
					e.preventDefault();
				});
				$x.on("click." + self._evns, function(e){
					e.stopPropagation();
					e.preventDefault();
					var displayName = data._displayName || data.name;
					if(!window.confirm("Delete brush \"" + displayName + "\"?")) return;
					//remove from localStorage, then reconcile to drop from registry + DOM on all instances.
					var arr = plugin.read_custom_brushes().filter(function(r){ return r.id !== data._id; });
					plugin.write_custom_brushes(arr);
					$.fn.drawr.reconcile_custom_brushes();
					//if this instance had the deleted brush selected, fall back to the first brush button.
					if(self.active_brush === data && self.$brushToolbox){
						self.$brushToolbox.find(".drawr-tool-btn.type-brush:first").trigger("pointerdown");
					}
				});
				el.append($x);
			}

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

		/* create a slider: inline [label][range][value] row, so tall dialogs with many sliders stay compact. */
		plugin.create_slider = function(toolbox,title,min,max,value){
			var self=this;
			var cls = "slider-" + title.toLowerCase();
			$(toolbox).append(
				'<div style="display:flex;align-items:center;padding:2px 6px;gap:6px;font-size:11px;">' +
					'<label style="flex:0 0 auto;min-width:46px;font-weight:bold;user-select:none;">' + title + '</label>' +
					'<input class="slider-component ' + cls + '" value="' + value + '" type="range" min="' + min + '" max="' + max + '" step="1" style="flex:1 1 auto;min-width:0;background:transparent;height:18px;margin:0;" />' +
					'<span style="flex:0 0 auto;min-width:26px;text-align:right;font-variant-numeric:tabular-nums;">' + value + '</span>' +
				'</div>'
			);
			$(toolbox).find("." + cls).on("pointerdown touchstart",function(e){
				e.stopPropagation();
			}).on("input." + self._evns,function(e){
				 $(this).next().text($(this).val());
			});
			return $(toolbox).find(".slider-" + title.toLowerCase());
		}

		/* create a button */
		plugin.create_button = function(toolbox, title){
			var key = 'btn-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
			$(toolbox).append(
				'<button class="drawr-toolwindow-btn ' + key + '" style="' +
					'display:block;width:calc(100% - 16px);margin:6px 8px;padding:7px 10px;' +
					'font-size:12px;font-weight:bold;cursor:pointer;border-radius:4px;' +
					'border:1px solid rgba(0,0,0,0.25);' +
					'background:linear-gradient(to bottom,rgba(255,255,255,0.18) 0%,rgba(0,0,0,0.08) 100%);' +
					'box-shadow:0 1px 2px rgba(0,0,0,0.18),inset 0 1px 0 rgba(255,255,255,0.22);' +
					'color:inherit;' +
				'">' + title + '</button>'
			);
			$(toolbox).find('.' + key).on('pointerdown touchstart', function(e){
				e.stopPropagation();
			});
			return $(toolbox).find('.' + key);
		};

		/* create a descriptive text block (styled like a quote block) */
		plugin.create_text = function(toolbox, text){
			$(toolbox).append(
				'<div class="drawr-toolwindow-text" style="' +
					'margin:6px 8px;padding:6px 8px 6px 10px;font-size:11px;line-height:1.5;' +
					'border-left:3px solid rgba(128,128,255,0.55);' +
					'background:rgba(128,128,255,0.07);border-radius:0 3px 3px 0;' +
					'white-space:pre-wrap;word-break:break-word;' +
				'">' + text + '</div>'
			);
			return $(toolbox).find('.drawr-toolwindow-text:last');
		};

		/* create a styled text input field with a left accent border */
		plugin.create_input = function(toolbox, placeholder, value){
			var uid = 'inp-' + Math.random().toString(36).slice(2, 8);
			$(toolbox).append(
				'<div style="margin:6px 8px;border-left:3px solid rgba(128,128,255,0.55);border-radius:0 3px 3px 0;color:#333;background:rgba(255,255,255);">' +
					'<input class="drawr-toolwindow-input ' + uid + '" type="text"' +
						(placeholder ? ' placeholder="' + placeholder + '"' : '') +
						(value !== undefined ? ' value="' + value + '"' : '') +
						' style="' +
							'display:block;width:100%;box-sizing:border-box;' +
							'padding:6px 8px 6px 10px;font-size:12px;' +
							'background:transparent;border:none;outline:none;color:inherit;' +
						'">' +
				'</div>'
			);
			var input = $(toolbox).find('.' + uid);
			input.on('pointerdown touchstart keydown', function(e){ e.stopPropagation(); });
			return input;
		};

		/* create a file picker styled like a button, with an upload icon */
		plugin.create_filepicker = function(toolbox, title, accept){
			var uid = 'fp-' + Math.random().toString(36).slice(2, 8);
			var wrapper = $(
				'<div class="drawr-toolwindow-btn drawr-filepicker-wrap ' + uid + '" style="' +
					'display:block;position:relative;width:calc(100% - 16px);margin:6px 8px;padding:7px 10px;' +
					'font-size:12px;font-weight:bold;cursor:pointer;border-radius:4px;' +
					'border:1px solid rgba(0,0,0,0.25);' +
					'background:linear-gradient(to bottom,rgba(255,255,255,0.18) 0%,rgba(0,0,0,0.08) 100%);' +
					'box-shadow:0 1px 2px rgba(0,0,0,0.18),inset 0 1px 0 rgba(255,255,255,0.22);' +
					'text-align:center;user-select:none;overflow:hidden;box-sizing:border-box;' +
				'">' +
					'<span class="mdi mdi-upload" style="margin-right:5px;vertical-align:middle;font-size:16px;"></span>' +
					'<span style="vertical-align:middle;">' + title + '</span>' +
				'</div>'
			);
			var input = $('<input type="file" class="drawr-filepicker-fix">').css({
				position: 'absolute', top: 0, left: 0,
				width: '100%', height: '100%',
				opacity: 0, cursor: 'pointer', margin: 0
			});
			if (accept){ input.attr('accept', accept); }
			wrapper.append(input);
			wrapper.on('pointerdown touchstart', function(e){ e.stopPropagation(); });
			$(toolbox).append(wrapper);
			return input;
		};

		/* create a collapsible section. returns the inner jQuery element for callers to append into.
		   Header toggles the content. collapsedDefault=true starts hidden. */
		plugin.create_collapsible = function(toolbox, title, collapsedDefault){
			var uid = 'col-' + Math.random().toString(36).slice(2, 8);
			var collapsed = !!collapsedDefault;
			var $wrap = $(
				'<div class="drawr-collapsible ' + uid + '" style="margin:6px 8px 4px;border-top:1px solid rgba(0,0,0,0.12);">' +
					'<div class="drawr-collapsible-header" style="cursor:pointer;padding:6px 4px;font-weight:bold;font-size:12px;user-select:none;display:flex;align-items:center;">' +
						'<span class="drawr-collapsible-chevron" style="display:inline-block;width:12px;transition:transform 0.1s;">' + (collapsed ? '▸' : '▾') + '</span>' +
						'<span style="margin-left:6px;">' + title + '</span>' +
					'</div>' +
					'<div class="drawr-collapsible-content" style="' + (collapsed ? 'display:none;' : '') + '"></div>' +
				'</div>'
			);
			$(toolbox).append($wrap);
			var $content = $wrap.find('.drawr-collapsible-content');
			var $header = $wrap.find('.drawr-collapsible-header');
			var $chev = $wrap.find('.drawr-collapsible-chevron');
			$header.on('pointerdown touchstart mousedown', function(e){ e.stopPropagation(); });
			$header.on('click', function(){
				collapsed = !collapsed;
				$content.css('display', collapsed ? 'none' : '');
				$chev.text(collapsed ? '▸' : '▾');
			});
			return $content;
		};

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
			if(position){ $(toolbox).offset(position); }
			$(toolbox).data("toolbox-id", id);
			$(toolbox).hide();
			//the plugin claims the middle mouse button for canvas panning, so block the browser's
			//autoscroll-on-middle-click over any toolbox (otherwise a tall dialog will trigger it).
			$(toolbox).on("mousedown." + self._evns, function(e){
				if(e.button === 1) e.preventDefault();
			});
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

		//returns the best container-relative {left, top} for a toolbox of the given dimensions.
		//restores a remembered drag position if available; otherwise scores 8 perimeter zones
		//by their total overlap area with already-visible toolboxes and picks the lowest-scoring one.

		plugin.get_best_toolbox_position = function(id, width, height, $exclude) {

			var container = $(this).parent();
			var cw = container.innerWidth();
			var ch = container.innerHeight();
			var P = 6;

			if(this._toolboxPositions && this._toolboxPositions[id]) {
				var mem = this._toolboxPositions[id];
				return {
					left: Math.min(Math.max(mem.left, P), cw - width - P),
					top:  Math.min(Math.max(mem.top,  P), ch - height - P)
				};
			}

			var zones = [
				{ left: P,                top: P                },  //topleft
				{ left: cw - width - P,   top: P                },  //topright
				{ left: P,                top: (ch-height)/2    },  //middle left
				{ left: cw - width - P,   top: (ch-height)/2    },  //middleright
				{ left: P,                top: ch - height - P  },  //bottomleft
				{ left: cw - width - P,   top: ch - height - P  },  //bottomright
				{ left: (cw-width)/2,     top: P                },  //topcenter
				{ left: (cw-width)/2,     top: ch - height - P  }   //bottomcenter
			];

			var containerOffset = container.offset();
			var occupied = [];
			$(".drawr-toolbox:visible").each(function(){
				if($exclude && $(this).is($exclude)) return; //skip the toolbox being placed
				var o = $(this).offset();
				occupied.push({
					left:   o.left  - containerOffset.left,
					top:    o.top   - containerOffset.top,
					right:  o.left  - containerOffset.left + $(this).outerWidth(),
					bottom: o.top   - containerOffset.top  + $(this).outerHeight()
				});
			});

			var best = zones[0], bestScore = Infinity;
			zones.forEach(function(zone){
				var zr = { left: zone.left, top: zone.top, right: zone.left+width, bottom: zone.top+height };
				var score = 0;
				occupied.forEach(function(occ){
					var ix = Math.max(0, Math.min(zr.right,  occ.right)  - Math.max(zr.left, occ.left));
					var iy = Math.max(0, Math.min(zr.bottom, occ.bottom) - Math.max(zr.top,  occ.top));
					score += ix * iy;
				});
				if(score < bestScore){ bestScore = score; best = zone; }
			});
			return best;
		};

		//shows a toolbox and positions it using zone-scoring (or its remembered drag position).
		plugin.show_toolbox = function($toolbox){
			var self = this;
			var id = $toolbox.data("toolbox-id");
			$toolbox.show();
			var w = $toolbox.outerWidth();
			var h = $toolbox.outerHeight() || 100;
			var pos = plugin.get_best_toolbox_position.call(self, id, w, h, $toolbox);
			var containerOffset = $(self).parent().offset();
			$toolbox.offset({
				left: containerOffset.left + pos.left,
				top:  containerOffset.top  + pos.top
			});
		};

		//draw the transparency checkerboard onto the background canvas at fixed 20px squares
		//if self.paperColorMode === "solid", fills with self.paperColor instead
		plugin.draw_checkerboard = function(){
			var self = this;
			if(!self.$bgCanvas) return;
			//draw at base resolution; css display size handles zoom scaling 
			var W = self.width;
			var H = self.height;
			self.$bgCanvas[0].width = W;
			self.$bgCanvas[0].height = H;
			self.$bgCanvas.width(Math.ceil(W * self.zoomFactor));
			self.$bgCanvas.height(Math.ceil(H * self.zoomFactor));
			var ctx = self.$bgCanvas[0].getContext('2d');
			if(self.paperColorMode === "solid"){
				ctx.fillStyle = self.paperColor || '#ffffff';
				ctx.fillRect(0, 0, W, H);
			} else {
				var sz = 20; //fixed cell size at base resolution; zoom handled by css :)
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

			//hydrate persisted custom brushes (once globally) and apply built-in tool overrides before
			//the toolbar is built. Both are idempotent / guarded.
			$.fn.drawr.hydrate_custom_brushes();
			plugin.apply_overrides();

			if(toolset=="default"){
				$.fn.drawr.availableTools.sort(function(a,b) {return (a.order > b.order) ? 1 : ((b.order > a.order) ? -1 : 0);} );
				$.each($.fn.drawr.availableTools, function(i, tool){
					plugin.create_toolbutton.call(self, self.$brushToolbox[0], tool.type || "brush", tool);
				});
			} else {
				for(var tool_name of self.toolsets[toolset]){
					var tool = plugin.get_tool_by_name(toolset, tool_name);
					plugin.create_toolbutton.call(self, self.$brushToolbox[0], tool.type || "brush", tool);
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
				var newButton = plugin.create_toolbutton.call(currentCanvas,currentCanvas.$brushToolbox[0],typeof param.type=="undefined" ? "action" : param.type,param);
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

				$(".drawr-toolbox").each(function(){ if(this.ownerCanvas === currentCanvas) $(this).hide(); });
				plugin.show_toolbox.call(currentCanvas, currentCanvas.$brushToolbox);
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
				$(".drawr-toolbox").each(function(){ if(this.ownerCanvas === currentCanvas) $(this).hide(); });
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
				currentCanvas.memoryContext.imageSmoothingEnabled= false;

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
				context.imageSmoothingEnabled= false;

				currentCanvas.brushColor = { r: 0, g: 0, b: 0 };
				currentCanvas.brushBackColor = { r: 255, g: 255, b: 255 };
				currentCanvas._toolboxPositions = {};

				//brush dialog
				var width = defaultSettings.toolbox_cols * 40;
				currentCanvas.$brushToolbox = plugin.create_toolbox.call(currentCanvas,"brush",null,"Tools",width);

				plugin.bind_draw_events.call(currentCanvas);

				//register this instance for cross-instance dynamics sync, and lazily install the storage listener.
				if(!$.fn.drawr._instances) $.fn.drawr._instances = [];
				$.fn.drawr._instances.push(currentCanvas);
				plugin.bind_storage_listener();
			}
		});
		return this;
 
	};

	//canonical brush-dynamics field names. snapshotted at register-time into tool._defaults
	//so "Reset defaults" in the settings dialog can restore pristine values after an override.
	$.fn.drawr._dynamicsFields = [
		"size","alpha","flow","spacing",
		"rotation_mode","fixed_angle","angle_jitter",
		"size_jitter","opacity_jitter","scatter",
		"smoothing","brush_fade_in",
		"pressure_affects_alpha","pressure_affects_size"
	];

	/* Register a new tool */
	$.fn.drawr.register = function (tool){
		if(typeof $.fn.drawr.availableTools=="undefined") $.fn.drawr.availableTools=[];
		//snapshot dynamics defaults so Reset-Defaults has a pristine target. Shallow copy of
		//only the fields the tool actually declares — missing fields stay missing after reset.
		if(typeof tool._defaults === "undefined"){
			var defaults = {};
			for(var i = 0; i < $.fn.drawr._dynamicsFields.length; i++){
				var f = $.fn.drawr._dynamicsFields[i];
				if(typeof tool[f] !== "undefined") defaults[f] = tool[f];
			}
			tool._defaults = defaults;
		}
		$.fn.drawr.availableTools.push(tool);
	};

}( jQuery ));

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define(["jquery"], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory(require("jquery"));
  } else {
    factory(root.jQuery);
  }
}(typeof self !== "undefined" ? self : this, function ($) {
  //"use strict";
  if (!$) throw new Error("jquery-drawrpalette requires jQuery");
  var jQuery = $;
/*!
 * jquery-drawrpalette
 * Copyright (c) 2019–present Avokicchi
 * Released under the MIT License
 */

(function( $ ) {

	$.fn.drawrpalette = function( action, param ) {

		var plugin = this;

		plugin.offset	 = 5;
		plugin.pickerSize = 200;

		//returns {x, y} pointer/touch position relative to $relativeTo.
		plugin.get_mouse_value = function(event, $relativeTo) {
			var src = (event.type === "touchmove" || event.type === "touchstart")
				? event.originalEvent.touches[0] : event;
			return {
				x: src.pageX - $relativeTo.offset().left - plugin.offset,
				y: src.pageY - $relativeTo.offset().top  - plugin.offset
			};
		};

		//converts r, g, b (0–255) to a CSS hex string "#rrggbb".
		plugin.rgb_to_hex = function(r, g, b) {
			return '#' + (0x1000000 + (b | (g << 8) | (r << 16))).toString(16).slice(1);
		};

		//converts a hex string to {r, g, b} (0–255), or null if invalid. 
		plugin.hex_to_rgb = function(hex) {
			var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
		};

		//converts HSV (0–1 each) to {r, g, b} (0–255). 
		plugin.hsv_to_rgb = function(h, s, v) {
			if (arguments.length === 1) { s = h.s; v = h.v; h = h.h; }
			var i = Math.floor(h * 6), f = h * 6 - i,
				p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s),
				ch = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
			return { r: Math.round(ch[0] * 255), g: Math.round(ch[1] * 255), b: Math.round(ch[2] * 255) };
		};

		//converts {r, g, b} (0–255) to {h, s, v} (0–1 each). 
		plugin.rgb_to_hsv = function(r, g, b) {
			if (arguments.length === 1) { g = r.g; b = r.b; r = r.r; }
			var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min,
				s = (max === 0 ? 0 : d / max), v = max / 255, h;
			if	  (max === min) { h = 0; }
			else if (max === r)   { h = ((g - b) + d * (g < b ? 6 : 0)) / (6 * d); }
			else if (max === g)   { h = ((b - r) + d * 2) / (6 * d); }
			else				  { h = ((r - g) + d * 4) / (6 * d); }
			return { h: h, s: s, v: v };
		};

		//maps HSV to canvas pixel position {x, y}.
		plugin.hsv_to_xy = function(h, s, v) {
			return { x: s * plugin.pickerSize + plugin.offset, y: (1 - v) * plugin.pickerSize + plugin.offset };
		};

		 //maps canvas pixel position to partial HSV {s, v} (h is unchanged).
		plugin.xy_to_hsv = function(x, y) {
			return { s: x / plugin.pickerSize, v: (plugin.pickerSize - y) / plugin.pickerSize };
		};

		//redraws the HSV square and hue strip onto the canvas.
		plugin.draw_hsv = function(size, canvas) {
			var hsv = this.hsv, ctx = canvas.getContext('2d'), row, rgb, grad, pos;
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			//saturation/value square, drawn row by row
			for (row = 0; row < size; row++) {
				var value = (size - row) / size;
				grad = ctx.createLinearGradient(0, 0, size, 0);
				rgb = plugin.hsv_to_rgb(hsv.h, 0, value);
				grad.addColorStop(0, 'rgb('+rgb.r+','+rgb.g+','+rgb.b+')');
				rgb = plugin.hsv_to_rgb(hsv.h, 1, value);
				grad.addColorStop(1, 'rgb('+rgb.r+','+rgb.g+','+rgb.b+')');
				ctx.fillStyle = grad;
				ctx.fillRect(plugin.offset, row + plugin.offset, size, 1);
			}

			//hue strip
			for (row = 0; row < size; row++) {
				ctx.fillStyle = "hsl(" + ((360 / size) * row) + ", 100%, 50%)";
				ctx.fillRect(size + plugin.offset + 5, row + plugin.offset, 40, 1);
			}

			//hue indicator bar
			ctx.fillStyle = "black";
			ctx.fillRect(size + plugin.offset + 3, plugin.offset + (hsv.h * size) - 3, 44, 6);
			ctx.fillStyle = "white";
			ctx.fillRect(size + plugin.offset + 5, plugin.offset + (hsv.h * size) - 1, 40, 2);

			//crosshair circle
			pos = plugin.hsv_to_xy(this.hsv.h, this.hsv.s, this.hsv.v);
			ctx.beginPath(); ctx.lineWidth = 3; ctx.strokeStyle = "black";
			ctx.arc(pos.x, pos.y, 5, 0, 2 * Math.PI); ctx.stroke();
			ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = "white";
			ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI); ctx.stroke();
		};

		//updates the swatch button color and redraws the canvas to reflect this.hsv.
		plugin.update_color = function() {
			var rgb = plugin.hsv_to_rgb(this.hsv.h, this.hsv.s, this.hsv.v);
			this.$button.css("background-color", "rgb("+rgb.r+","+rgb.g+","+rgb.b+")");
			plugin.draw_hsv.call(this, plugin.pickerSize, this.$dropdown.find("canvas")[0]);
		};

		//writes the current HSV state as a hex value back to the input element. 
		plugin.update_value = function() {
			var rgb = plugin.hsv_to_rgb(this.hsv.h, this.hsv.s, this.hsv.v);
			$(this).val(plugin.rgb_to_hex(rgb.r, rgb.g, rgb.b));
		};

		//reverts HSV to match the input's current value and fires the cancel event. 
		plugin.cancel = function() {
			var rgb = plugin.hex_to_rgb($(this).val());
			this.hsv = plugin.rgb_to_hsv(rgb.r, rgb.g, rgb.b);
			plugin.update_color.call(this);
			$(this).trigger("cancel.drawrpalette", $(this).val());
		};

		//computes current hex from picker's HSV state and fires the preview event.
		plugin.trigger_preview = function(picker) {
			var rgb = plugin.hsv_to_rgb(picker.hsv.h, picker.hsv.s, picker.hsv.v);
			$(picker).trigger("preview.drawrpalette", plugin.rgb_to_hex(rgb.r, rgb.g, rgb.b));
		};

		this.each(function() {

			var currentPicker = this;

			if (action === "destroy") {
				if (!$(currentPicker).hasClass("active-drawrpalette")) {
					console.error("The element you are running this command on is not a drawrpalette.");
					return false;
				}
				currentPicker.$button.off("pointerdown.drawrpalette");
				currentPicker.$dropdown.find(".ok").off("pointerup.drawrpalette");
				currentPicker.$dropdown.find(".cancel").off("pointerup.drawrpalette");
				currentPicker.$dropdown.off("pointerdown.drawrpalette touchstart.drawrpalette pointerup.drawrpalette");
				$(window).unbind("pointerdown.drawrpalette", currentPicker.paletteStart);
				$(window).unbind("pointermove.drawrpalette", currentPicker.paletteMove);
				$(window).unbind("pointerup.drawrpalette",   currentPicker.paletteStop);
				$(currentPicker).show();
				currentPicker.$button.remove();
				currentPicker.$dropdown.remove();
				$(currentPicker).unwrap();
				delete currentPicker.$wrapper;
				delete currentPicker.$button;
				delete currentPicker.$dropdown;
				delete currentPicker.hsl;
				delete currentPicker.slidingHue;
				delete currentPicker.slidingHsl;
				delete currentPicker.paletteStart;
				delete currentPicker.paletteMove;
				delete currentPicker.paletteStop;
				$(currentPicker).removeClass("active-drawrpalette");

			} else if (action === "set") {
				if (!$(currentPicker).hasClass("active-drawrpalette")) {
					console.error("The element you are running this command on is not a drawrpalette.");
					return false;
				}
				$(currentPicker).val(param);
				var rgb = plugin.hex_to_rgb(param);
				currentPicker.hsv = plugin.rgb_to_hsv(rgb.r, rgb.g, rgb.b);
				plugin.update_color.call(currentPicker);

			} else if (typeof action === "object" || typeof action === "undefined") {

				//capture inline styles/classes before the element is modified
				var inlineStyles = {}, inlineClasses = currentPicker.className !== "" ? currentPicker.className.split(" ") : [];
				for (var i = 0, l = currentPicker.style.length; i < l; i++) {
					var prop = currentPicker.style[i];
					inlineStyles[prop] = getComputedStyle(currentPicker, null).getPropertyValue(prop);
				}
				
				//prevent double-init

				if ($(currentPicker).hasClass("active-drawrpalette")) return false; 
				currentPicker.className += " active-drawrpalette";

				var settings = Object.assign(
					{ enable_alpha: false, append_to: currentPicker, auto_apply: false },
					typeof action === "object" ? action : {}
				);
				currentPicker.settings = settings;
				currentPicker.plugin   = plugin;

				//wrap input, hide it, and store wrapper reference
				$(this).wrap("<div class='drawrpallete-wrapper'></div>").hide();
				this.$wrapper = $(this).parent().css({ position: "relative", display: "inline-block" });

				//build the color swatch button, inheriting original inline styles and classes
				currentPicker.$button = $("<button>&nbsp;</button>").css({
					"width": "40px", "height": "40px", "border": "2px solid #ccc",
					"background-color": "#eee", "cursor": "pointer", "text-align": "text",
					"padding": "0px", "font-size": "2em",
					"background-image": "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAHCAYAAADEUlfTAAAAG0lEQVR42mNgwAfKy8v/48I4FeA0AacVDFQBAP9wJkE/KhUMAAAAAElFTkSuQmCC')",
					"background-repeat": "no-repeat", "background-position": "24px 25px"
				}).css(inlineStyles);
				$.each(inlineClasses, function(i, cls) { currentPicker.$button.addClass(cls); });
				this.$wrapper.append(currentPicker.$button);

				//build dropdown: canvas + optional ok/cancel buttons
				var cH = plugin.pickerSize + plugin.offset * 2,
					cW = plugin.pickerSize + 40 + plugin.offset * 2 + 5;
				currentPicker.$dropdown = $("<div><canvas style='display:block;' class='drawrpallete-canvas' width='" + cW + "' height='" + cH + "'></canvas></div>");
				if (!settings.auto_apply) {
					currentPicker.$dropdown.append('<div style="height:28px;text-align:right;margin-top:-2px;padding:0px 5px;"><button class="cancel">cancel</button><button style="margin-left:5px;width:40px;" class="ok">ok</button></div>');
				}
				currentPicker.$dropdown.css({
					"background": "#eee", "width": cW + "px",
					"height": (settings.auto_apply ? cH : cH + 28) + "px",
					"position": "absolute", "z-index": 8
				}).hide();
				this.$wrapper.append(currentPicker.$dropdown);

				//ok: commit color to input and close
				currentPicker.$dropdown.find(".ok").css("color", "black").on("pointerup.drawrpalette", function() {
					plugin.update_value.call(currentPicker);
					$(currentPicker).trigger("choose.drawrpalette", $(currentPicker).val());
					currentPicker.$dropdown.hide();
					$(currentPicker).trigger("close.drawrpalette");
				});

				//cancel: revert to last committed value and close
				currentPicker.$dropdown.find(".cancel").css("color", "black").on("pointerup.drawrpalette", function() {
					plugin.cancel.call(currentPicker);
					currentPicker.$dropdown.hide();
					$(currentPicker).trigger("close.drawrpalette");
				});

				//prevent touch scroll from bubbling to the window close-on-outside-click handler
				//this is so the whole page doesn't scroll up and make this component completely useless on mobile. 
				currentPicker.$dropdown.on("touchstart.drawrpalette", function(e) {
					e.preventDefault(); e.stopPropagation();
				});

				//canvas interactions: pick saturation/value or hue on pointerdown; close on pointerup in auto_apply mode
				currentPicker.$dropdown.on("pointerdown.drawrpalette", function(e) {
					var m = plugin.get_mouse_value(e, currentPicker.$dropdown);
					if (m.x > 0 && m.x < plugin.pickerSize && m.y > 0 && m.y < plugin.pickerSize) {
						currentPicker.slidingHsl = true;
						var sv = plugin.xy_to_hsv(m.x, m.y);
						currentPicker.hsv.s = sv.s;
						currentPicker.hsv.v = sv.v;
						plugin.update_color.call(currentPicker);
						plugin.trigger_preview(currentPicker);
					} else if (m.x > plugin.pickerSize + 5 && m.x < plugin.pickerSize + 45 && m.y > 0 && m.y < plugin.pickerSize) {
						currentPicker.slidingHue = true;
						currentPicker.hsv.h = m.y / plugin.pickerSize;
						plugin.update_color.call(currentPicker);
						plugin.trigger_preview(currentPicker);
					}
					if (settings.auto_apply) {
						plugin.update_value.call(currentPicker);
						$(currentPicker).trigger("choose.drawrpalette", $(currentPicker).val());
					}
					e.preventDefault(); e.stopPropagation();
				}).on("pointerup.drawrpalette", function(e) {
					var m = plugin.get_mouse_value(e, currentPicker.$dropdown);
					if (settings.auto_apply && m.x > 0 && m.x < plugin.pickerSize && m.y > 0 && m.y < plugin.pickerSize) {
						plugin.update_value.call(currentPicker);
						$(currentPicker).trigger("choose.drawrpalette", $(currentPicker).val());
						currentPicker.$dropdown.hide();
						$(currentPicker).trigger("close.drawrpalette");
					}
				});

				//swatch button: open dropdown, positioned to stay within the viewport
				currentPicker.$button.on("pointerdown.drawrpalette", function(e) {
					currentPicker.slidingHue = currentPicker.slidingHsl = false;
					currentPicker.$dropdown.show();
					var bLeft   = currentPicker.$button.offset().left,
						bRight  = bLeft + currentPicker.$dropdown.outerWidth(),
						vpRight = $(window).scrollLeft() + $(window).width();
					currentPicker.$dropdown.offset({
						top:  currentPicker.$button.offset().top + currentPicker.$button.outerHeight(),
						left: bRight < vpRight ? bLeft : bLeft - currentPicker.$dropdown.outerWidth() + currentPicker.$button.outerWidth()
					});
					var rgb = plugin.hex_to_rgb($(currentPicker).val());
					currentPicker.hsv = plugin.rgb_to_hsv(rgb.r, rgb.g, rgb.b);
					plugin.update_color.call(currentPicker);
					$(currentPicker).trigger("open.drawrpalette");
					e.preventDefault(); e.stopPropagation();
				});

				//window-level handlers: drag tracking and click-outside-to-close
				currentPicker.paletteStart = function() {
					if (currentPicker.$dropdown.is(":visible")) {
						plugin.cancel.call(currentPicker);
						currentPicker.$dropdown.hide();
						$(currentPicker).trigger("close.drawrpalette");
					}
				};
				currentPicker.paletteMove = function(e) {
					if (!currentPicker.slidingHsl && !currentPicker.slidingHue) return;
					var m = plugin.get_mouse_value(e, currentPicker.$dropdown);
					m.y = Math.max(0, Math.min(m.y, plugin.pickerSize));
					m.x = Math.max(0, m.x);
					if (currentPicker.slidingHsl) {
						m.x = Math.min(m.x, plugin.pickerSize);
						var sv = plugin.xy_to_hsv(m.x, m.y);
						currentPicker.hsv.s = sv.s;
						currentPicker.hsv.v = sv.v;
					} else {
						currentPicker.hsv.h = m.y / plugin.pickerSize;
					}
					plugin.update_color.call(currentPicker);
					plugin.trigger_preview(currentPicker);
					if (settings.auto_apply) {
						plugin.update_value.call(currentPicker);
						$(currentPicker).trigger("choose.drawrpalette", $(currentPicker).val());
					}
				};
				currentPicker.paletteStop = function() {
					currentPicker.slidingHue = currentPicker.slidingHsl = false;
				};
				$(window).bind("pointerdown.drawrpalette", currentPicker.paletteStart);
				$(window).bind("pointermove.drawrpalette", currentPicker.paletteMove);
				$(window).bind("pointerup.drawrpalette",   currentPicker.paletteStop);

				//initialise color from input value, defaulting to black
				if ($(this).val() !== "") {
					var rgb = plugin.hex_to_rgb($(this).val());
					currentPicker.hsv = plugin.rgb_to_hsv(rgb.r, rgb.g, rgb.b);
				} else {
					currentPicker.hsv = { h: 0, s: 0, v: 0 };
					$(this).val("#000000");
				}
				plugin.update_color.call(currentPicker);
			}
		});
		return this;
	};

}( jQuery ));

  return $;
}));
jQuery.fn.drawr.register({
	icon: "mdi mdi-spray mdi-24px",
	name: "airbrush",
	size: 20,
	alpha: 0.5,
	order: 3,
	brush_fade_in: 10,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	smoothing: false,
	flow: 0.5,
	spacing: 0.05,
	scatter: 0,
	opacity_jitter: 0,
	size_jitter: 0,
	rotation_mode: "none",
	activate: function(brush,context){
		brush._stampCache = null;
		brush._stampCacheKey = null;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var cacheKey = size + '|' + color.r + ',' + color.g + ',' + color.b;
		if(brush._stampCacheKey !== cacheKey){
			var buffer = document.createElement('canvas');
			buffer.width = size;
			buffer.height = size;
			var bctx = buffer.getContext('2d');
			var half = size / 2;
			var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
			radgrad.addColorStop(0, 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')');
			radgrad.addColorStop(0.5, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.5)');
			radgrad.addColorStop(1, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0)');
			bctx.fillStyle = radgrad;
			bctx.fillRect(0, 0, size, size);
			brush._stampCache = buffer;
			brush._stampCacheKey = cacheKey;
		}
		context.globalAlpha = alpha;
		context.drawImage(brush._stampCache, x - size / 2, y - size / 2);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});
jQuery.fn.drawr.register({
	icon: "mdi mdi-brush mdi-24px",
	name: "brush",
	size: 6,
	alpha: 1,
	order: 4,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	brush_fade_in: 20,
	smoothing: true,
	flow: 0.9,
	spacing: 0.15,
	opacity_jitter: 0.05,
	rotation_mode: "none",
	activate: function(brush,context){
		brush._stampCache = null;
		brush._stampCacheKey = null;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var cacheKey = size + '|' + color.r + ',' + color.g + ',' + color.b;
		if(brush._stampCacheKey !== cacheKey){
			var sz = Math.max(1, size);
			var buffer = document.createElement('canvas');
			buffer.width = sz;
			buffer.height = sz;
			var bctx = buffer.getContext('2d');
			var half = sz / 2;
			var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
			radgrad.addColorStop(0, 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')');
			radgrad.addColorStop(0.5, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.5)');
			radgrad.addColorStop(1, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0)');
			bctx.fillStyle = radgrad;
			bctx.fillRect(0, 0, sz, sz);
			brush._stampCache = buffer;
			brush._stampCacheKey = cacheKey;
		}
		context.globalAlpha = alpha;
		context.drawImage(brush._stampCache, x - size / 2, y - size / 2);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});
jQuery.fn.drawr.register({
	icon: "mdi mdi-plus mdi-24px",
	name: "custom",
	type: "toggle",
	order: 100,
	//buttonCreated runs once per canvas, but the tool object itself is shared across all drawr instances.
	//So any per-dialog DOM references must live on `self` (the canvas), not on `brush` (the shared tool),
	//otherwise the last instance to boot overwrites the previous one's handles.
	buttonCreated: function(brush,button){
		var self = this;

		self.$customToolbox = self.plugin.create_toolbox.call(self,"custom",
			{ left: $(self).parent().offset().left + $(self).parent().innerWidth()/2,
			  top:  $(self).parent().offset().top  + $(self).parent().innerHeight()/2 },
			"Custom brush", 160);

		self.plugin.create_text.call(self, self.$customToolbox, "Create a new brush from an image.");

		self.plugin.create_label.call(self, self.$customToolbox, "Name");
		self._customNameInput = self.plugin.create_input(self.$customToolbox, "Name", "");

		self.plugin.create_label.call(self, self.$customToolbox, "Icon");
		self._customIconInput = self.plugin.create_input(self.$customToolbox, "Icon", "mdi-puzzle");

		self.plugin.create_label.call(self, self.$customToolbox, "Image");
		self._customFilePicker = self.plugin.create_filepicker(self.$customToolbox, "Load Image", "image/*");
		self._customImageDataUrl = null;
		self._customFilePicker.on('change', function() {
			var file = this.files[0];
			if (!file) return;
			var reader = new FileReader();
			reader.onload = function(e) { self._customImageDataUrl = e.target.result; };
			reader.readAsDataURL(file);
		});

		//Advanced: the same dynamics controls exposed in the settings dialog, so users can
		//tailor the brush at creation time. Everything defaults to sane starting values.
		var $adv = self.plugin.create_collapsible.call(self, self.$customToolbox, "Advanced", true);

		self._customRotationMode  = self.plugin.create_dropdown.call(self, $adv, "Rotation", [
			{ value: "none",           label: "None" },
			{ value: "fixed",          label: "Fixed" },
			{ value: "follow_stroke",  label: "Follow" },
			{ value: "random_jitter",  label: "Random" },
			{ value: "follow_jitter",  label: "Follow±" }
		], "follow_stroke");
		self._customSpacing    = self.plugin.create_slider.call(self, $adv, "spacing",    2, 200, 25);
		self._customFlow       = self.plugin.create_slider.call(self, $adv, "flow",       0, 100, 100);
		self._customSizeJit    = self.plugin.create_slider.call(self, $adv, "sizejitter", 0, 100, 0);
		self._customOpJit      = self.plugin.create_slider.call(self, $adv, "opjitter",   0, 100, 0);
		self._customAngleJit   = self.plugin.create_slider.call(self, $adv, "anglejit",   0, 100, 0);
		self._customScatter    = self.plugin.create_slider.call(self, $adv, "scatter",    0, 100, 0);
		self._customFixedAngle = self.plugin.create_slider.call(self, $adv, "angle",      0, 359, 0);
		self._customSize       = self.plugin.create_slider.call(self, $adv, "basesize",   1, 100, 15);
		self._customAlpha      = self.plugin.create_slider.call(self, $adv, "basealpha",  0, 100, 100);
		self._customFadeIn     = self.plugin.create_slider.call(self, $adv, "fadein",     0, 200, 0);
		self._customSmoothing   = self.plugin.create_checkbox.call(self, $adv, "Smoothing",  false);
		self._customPressureA   = self.plugin.create_checkbox.call(self, $adv, "PressureAlpha", true);
		self._customPressureS   = self.plugin.create_checkbox.call(self, $adv, "PressureSize",  false);

		var $createBtn = self.plugin.create_button.call(self, self.$customToolbox, "Create new brush");
		$createBtn.on('click', function(){
			var name = self._customNameInput.val().trim();
			if(!name){ alert("Brush needs a name."); return; }
			if(!self._customImageDataUrl){ alert("Pick an image first."); return; }
			//uniqueness check against display names already registered (both built-in and custom)
			var clash = ($.fn.drawr.availableTools || []).some(function(t){
				return (t._displayName || t.name) === name;
			});
			if(clash){ alert("A tool with that name already exists."); return; }

			var icon = self._customIconInput.val().trim() || "mdi-puzzle";
			var id = (typeof crypto !== "undefined" && crypto.randomUUID)
				? crypto.randomUUID()
				: (Date.now() + "-" + Math.random().toString(36).slice(2, 10));

			var record = {
				id: id,
				name: name,
				icon: icon,
				image_data_url: self._customImageDataUrl,
				size:           parseInt(self._customSize.val()),
				alpha:          parseFloat(self._customAlpha.val()) / 100,
				flow:           parseFloat(self._customFlow.val()) / 100,
				spacing:        parseFloat(self._customSpacing.val()) / 100,
				rotation_mode:  self._customRotationMode.val(),
				fixed_angle:    parseFloat(self._customFixedAngle.val()) * Math.PI / 180,
				angle_jitter:   parseFloat(self._customAngleJit.val()) / 100,
				size_jitter:    parseFloat(self._customSizeJit.val()) / 100,
				opacity_jitter: parseFloat(self._customOpJit.val()) / 100,
				scatter:        parseFloat(self._customScatter.val()) / 100,
				smoothing:      self._customSmoothing.prop("checked"),
				brush_fade_in:  parseInt(self._customFadeIn.val()),
				pressure_affects_alpha: self._customPressureA.prop("checked"),
				pressure_affects_size:  self._customPressureS.prop("checked")
			};

			//persist first, then register + paint buttons on every active instance via reconcile.
			var all = self.plugin.read_custom_brushes();
			all.push(record);
			self.plugin.write_custom_brushes(all);
			$.fn.drawr.reconcile_custom_brushes();

			//reset the form and close the dialog so the user's attention moves to the tools panel
			//where the new brush has appeared. Without this, the Create click looks like a no-op.
			self._customNameInput.val("");
			self._customFilePicker.val("");
			self._customImageDataUrl = null;
			self.$customToolbox.hide();
			//also untoggle the +-button, keeping its visual state in sync with the hidden dialog.
			var $customBtn = self.$brushToolbox.find(".drawr-tool-btn.type-toggle").filter(function(){
				return $(this).data("data") === brush;
			});
			if($customBtn.length && $customBtn.data("state")){
				$customBtn.data("state", false);
				self.plugin.set_button_state($customBtn[0], false);
			}
		});
	},
	action: function(brush,context){
		var self = this;
		self.$customToolbox.toggle();
	},
	cleanup: function(){
		var self = this;
		self.$customToolbox.remove();
		delete self.$customToolbox;
	}
});

//iterates every pixel inside a circular brush area, calling fn(data, src, i, blend, t, row, col, radius, diameter).
//handles getImageData / putImageData and the tapered blend weight from the center 
//pass needSrc=true to receive a frozen snapshot as the second argument to fn.
function _effectCircleEach(context, x, y, size, alpha, needSrc, fn) {
	var radius   = Math.max(2, Math.round(size / 2));
	var diameter = radius * 2;
	var ox       = Math.round(x) - radius;
	var oy       = Math.round(y) - radius;
	var imageData = context.getImageData(ox, oy, diameter, diameter);
	var data      = imageData.data;
	var src       = needSrc ? new Uint8ClampedArray(data) : null;
	for (var row = 0; row < diameter; row++) {
		for (var col = 0; col < diameter; col++) {
			var dx   = col - radius + 0.5;
			var dy   = row - radius + 0.5;
			var dist = Math.sqrt(dx * dx + dy * dy);
			if (dist >= radius) continue;
			var t     = 1 - dist / radius;
			var blend = alpha * t * t;
			fn(data, src, (row * diameter + col) * 4, blend, t, row, col, radius, diameter);
		}
	}
	context.putImageData(imageData, ox, oy);
}

//returns the average rgba of a box-blur neighbourhood from a snapshot buffer.
function _effectBoxBlur(src, row, col, diameter, kernelRadius) {
	var sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
	for (var ky = -kernelRadius; ky <= kernelRadius; ky++) {
		for (var kx = -kernelRadius; kx <= kernelRadius; kx++) {
			var nr = row + ky, nc = col + kx;
			if (nr < 0 || nr >= diameter || nc < 0 || nc >= diameter) continue;
			var ki = (nr * diameter + nc) * 4;
			sumR += src[ki]; sumG += src[ki + 1]; sumB += src[ki + 2]; sumA += src[ki + 3];
			count++;
		}
	}
	return { r: sumR / count, g: sumG / count, b: sumB / count, a: sumA / count };
}

jQuery.fn.drawr.register({
	icon: "mdi mdi-auto-fix mdi-24px",
	name: "effects",
	size: 20,
	alpha: 0.8,
	order: 13,
	pressure_affects_alpha: true,
	smoothing: false,
	flow: 1,
	spacing: 0.25,
	rotation_mode: "none",
	_effect: "blur",

	//Note: the tool object is shared across all drawr instances on a page, so DOM refs MUST live on
	//`self` (the canvas), not on `brush`. `brush._effect` itself is intentionally still global —
	//tool config (like pencil's spacing) is shared by design — but we keep a list of every per-canvas
	//dropdown on the tool so a change in one canvas syncs the others.
	buttonCreated: function(brush, button) {
		var self = this;

		self.$effectsToolbox = self.plugin.create_toolbox.call(self, "effects", null, "Effect", 120);

		var $dd = self.plugin.create_dropdown.call(self, self.$effectsToolbox, "Type", [
			{ value: "blur",    label: "Blur"    },
			{ value: "sharpen", label: "Sharpen" },
			{ value: "burn",    label: "Burn"    },
			{ value: "dodge",   label: "Dodge"   },
			{ value: "smudge",  label: "Smudge"  },
			{ value: "noise",   label: "Noise"   }
		], brush._effect);

		if(!brush._effectDropdowns) brush._effectDropdowns = [];
		brush._effectDropdowns.push($dd);

		$dd.on("change.drawr", function() {
			var val = $(this).val();
			brush._effect = val;
			brush.smoothing = (val === "smudge");
			//mirror the change onto sibling dropdowns in other instances, without re-firing change.
			var siblings = brush._effectDropdowns;
			for(var i = 0; i < siblings.length; i++){
				if(siblings[i][0] !== this) siblings[i].val(val);
			}
			self.plugin.is_dragging = false;
		});
	},

	activate: function(brush, context) {
		if(this.$effectsToolbox) this.plugin.show_toolbox.call(this, this.$effectsToolbox);
	},

	deactivate: function(brush, context) {
		brush._smudge = null;
		if(this.$effectsToolbox) this.$effectsToolbox.hide();
	},

	drawStart: function(brush, context, x, y, size, alpha, event) {
		if (brush._effect !== "smudge") return;
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;
		var imageData = context.getImageData(Math.round(x) - radius, Math.round(y) - radius, diameter, diameter);
		brush._smudge = {
			buf:      new Float32Array(imageData.data),
			radius:   radius,
			diameter: diameter,
			strength: alpha
		};
	},

	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var effect = brush._effect;

		if (effect === "blur") {
			var kernelRadius = Math.max(2, Math.round(Math.max(2, Math.round(size / 2)) / 4));
			_effectCircleEach(context, x, y, size, alpha, true, function(data, src, i, blend, t, row, col, radius, diameter) {
				var avg = _effectBoxBlur(src, row, col, diameter, kernelRadius);
				data[i]     = src[i]     + (avg.r - src[i])     * blend;
				data[i + 1] = src[i + 1] + (avg.g - src[i + 1]) * blend;
				data[i + 2] = src[i + 2] + (avg.b - src[i + 2]) * blend;
				data[i + 3] = src[i + 3] + (avg.a - src[i + 3]) * blend;
			});

		} else if (effect === "sharpen") {
			var kernelRadius = Math.max(2, Math.round(Math.max(2, Math.round(size / 2)) / 4));
			_effectCircleEach(context, x, y, size, alpha, true, function(data, src, i, blend, t, row, col, radius, diameter) {
				var avg = _effectBoxBlur(src, row, col, diameter, kernelRadius);
				data[i]     = src[i]     + (src[i]     - avg.r) * blend;
				data[i + 1] = src[i + 1] + (src[i + 1] - avg.g) * blend;
				data[i + 2] = src[i + 2] + (src[i + 2] - avg.b) * blend;
			});

		} else if (effect === "burn") {
			_effectCircleEach(context, x, y, size, alpha, false, function(data, src, i, blend) {
				data[i]     = data[i]     * (1 - blend);
				data[i + 1] = data[i + 1] * (1 - blend);
				data[i + 2] = data[i + 2] * (1 - blend);
			});

		} else if (effect === "dodge") {
			_effectCircleEach(context, x, y, size, alpha, false, function(data, src, i, blend) {
				data[i]     = data[i]     + (255 - data[i])     * blend;
				data[i + 1] = data[i + 1] + (255 - data[i + 1]) * blend;
				data[i + 2] = data[i + 2] + (255 - data[i + 2]) * blend;
			});

		} else if (effect === "noise") {
			_effectCircleEach(context, x, y, size, alpha, false, function(data, src, i, blend) {
				var grain = (Math.random() - 0.5) * 255 * blend;
				data[i]     = Math.min(255, Math.max(0, data[i]     + grain));
				data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
				data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
			});

		} else if (effect === "smudge") {
			var s = brush._smudge;
			if (!s) return;
			var ox = Math.round(x) - s.radius;
			var oy = Math.round(y) - s.radius;
			var imageData = context.getImageData(ox, oy, s.diameter, s.diameter);
			var data      = imageData.data;
			var buf       = s.buf;
			for (var row = 0; row < s.diameter; row++) {
				for (var col = 0; col < s.diameter; col++) {
					var dx   = col - s.radius + 0.5;
					var dy   = row - s.radius + 0.5;
					var dist = Math.sqrt(dx * dx + dy * dy);
					if (dist >= s.radius) continue;
					var t      = 1 - dist / s.radius;
					var blend  = s.strength * t * t;
					var i      = (row * s.diameter + col) * 4;
					var pickup = 0.18 * t;
					var origR = data[i],     origG = data[i + 1], origB = data[i + 2], origA = data[i + 3];
					data[i]     = origR + (buf[i]     - origR) * blend;
					data[i + 1] = origG + (buf[i + 1] - origG) * blend;
					data[i + 2] = origB + (buf[i + 2] - origB) * blend;
					data[i + 3] = origA + (buf[i + 3] - origA) * blend;
					buf[i]     += (origR - buf[i])     * pickup;
					buf[i + 1] += (origG - buf[i + 1]) * pickup;
					buf[i + 2] += (origB - buf[i + 2]) * pickup;
					buf[i + 3] += (origA - buf[i + 3]) * pickup;
				}
			}
			context.putImageData(imageData, ox, oy);
		}
	},

	drawStop: function(brush, context, x, y, size, alpha, event) {
		brush._smudge = null;
		return true;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-circle-outline mdi-24px",
	name: "ellipse",
	size: 3,
	alpha: 1,
	order: 10,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		context.globalCompositeOperation = "source-over";
		brush.currentAlpha = alpha;
		brush.currentSize = size;
		brush.startPosition = { x: x, y: y };
		this.effectCallback = brush.effectCallback;
		context.globalAlpha = alpha;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		context.globalAlpha = alpha;
		context.lineWidth = size;
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		context.strokeStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x, sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if (angle) {
			var cx = this.width / 2, cy = this.height / 2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dsx = sx - cx, dsy = sy - cy, dex = ex - cx, dey = ey - cy;
			sx = cx + cos * dsx - sin * dsy;
			sy = cy + sin * dsx + cos * dsy;
			ex = cx + cos * dex - sin * dey;
			ey = cy + sin * dex + cos * dey;
		}
		var ecx = (sx + ex) / 2, ecy = (sy + ey) / 2;
		var rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
		if (rx > 0 && ry > 0) {
			context.beginPath();
			context.ellipse(ecx, ecy, rx, ry, 0, 0, 2 * Math.PI);
			context.stroke();
		}
		if (angle) { context.restore(); }
		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		brush.currentPosition = { x: x, y: y };
	},
	effectCallback: function(context, brush, adjustx, adjusty, adjustzoom) {
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if (angle) {
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W / 2 - adjustx;
			var _cy = _H / 2 - adjusty;
			context.save();
			context.translate(_cx, _cy);
			context.rotate(-angle);
			context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = this.width * adjustzoom / 2, halfH = this.height * adjustzoom / 2;
			var sRelX = brush.startPosition.x  - this.width / 2, sRelY = brush.startPosition.y  - this.height / 2;
			var eRelX = brush.currentPosition.x - this.width / 2, eRelY = brush.currentPosition.y - this.height / 2;
			sx = (cos * sRelX - sin * sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin * sRelX + cos * sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos * eRelX - sin * eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin * eRelX + cos * eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x  * adjustzoom - adjustx;
			sy = brush.startPosition.y  * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		var ecx = (sx + ex) / 2, ecy = (sy + ey) / 2;
		var rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
		if (rx > 0 && ry > 0) {
			context.globalAlpha = brush.currentAlpha;
			context.lineWidth = brush.currentSize * adjustzoom;
			context.strokeStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
			context.beginPath();
			context.ellipse(ecx, ecy, rx, ry, 0, 0, 2 * Math.PI);
			context.stroke();
		}
		if (angle) { context.restore(); }
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-eraser mdi-24px",
	name: "eraser",
	size: 10,
	alpha: 0.8,
	order: 5,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	smoothing: false,
	flow: 1,
	spacing: 0.15,
	rotation_mode: "none",
	activate: function(brush,context){
		brush._stampCache = null;
		brush._stampCacheKey = null;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		if(this.settings.enable_transparency==true){
			context.globalCompositeOperation="destination-out";
		} else {
			context.globalCompositeOperation="source-over";
		}
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;
		context.globalAlpha = alpha;
		if(self.settings.enable_transparency==true){
			if(brush._stampCacheKey !== size){
				var sz = Math.max(1, size);
				var buffer = document.createElement('canvas');
				buffer.width = sz;
				buffer.height = sz;
				var bctx = buffer.getContext('2d');
				var half = sz / 2;
				var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
				radgrad.addColorStop(0, '#000');
				radgrad.addColorStop(0.5, 'rgba(0,0,0,0.5)');
				radgrad.addColorStop(1, 'rgba(0,0,0,0)');
				bctx.fillStyle = radgrad;
				bctx.fillRect(0, 0, sz, sz);
				brush._stampCache = buffer;
				brush._stampCacheKey = size;
			}
			context.drawImage(brush._stampCache, x - size / 2, y - size / 2);
		} else {
	    	context.fillStyle = 'white';
			context.beginPath();
			context.arc(x,y, size/2, 0, 2 * Math.PI);
			context.fill();
		}
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});
jQuery.fn.drawr.register({
	icon: "mdi mdi-eyedropper mdi-24px",
	name: "eyedropper",
	order: 30,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){	

		var rgb_to_hex = function(r, g, b) {
            var rgb = b | (g << 8) | (r << 16);
            return '#' + (0x1000000 + rgb).toString(16).slice(1)
        };

		var self = this;
		var raw = context.getImageData(x, y, 1, 1).data;
		var hex = rgb_to_hex(raw[0], raw[1], raw[2]);

		if(this._activeButton === 2){
			self.brushBackColor = { r: raw[0], g: raw[1], b: raw[2] };
			self.$settingsToolbox.find('.color-picker2.active-drawrpalette').drawrpalette("set", hex);
		} else {
			self.brushColor = { r: raw[0], g: raw[1], b: raw[2] };
			self.$settingsToolbox.find('.color-picker.active-drawrpalette').drawrpalette("set", hex);
		}

	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {


	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-format-color-fill mdi-24px",
	name: "fill",
	size: 1,
	alpha: 1,
	order: 9,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var canvas = context.canvas;
		var width = canvas.width;
		var height = canvas.height;

		x = Math.floor(x);
		y = Math.floor(y);

		if (x < 0 || x >= width || y < 0 || y >= height) return;

		var imageData = context.getImageData(0, 0, width, height);
		var data = imageData.data;

		var idx = (y * width + x) * 4;
		var targetR = data[idx];
		var targetG = data[idx + 1];
		var targetB = data[idx + 2];
		var targetA = data[idx + 3];

		var fillR = color.r;
		var fillG = color.g;
		var fillB = color.b;
		var fillA = Math.round(alpha * 255);

		//nothing to do if the seed pixel is already the fill color
		if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === fillA) return;

		var tolerance = 10;

		function colorMatch(i) {
			var dr = data[i]     - targetR;
			var dg = data[i + 1] - targetG;
			var db = data[i + 2] - targetB;
			var da = data[i + 3] - targetA;
			return (dr * dr + dg * dg + db * db + da * da) <= tolerance * tolerance;
		}

		var visited = new Uint8Array(width * height);
		//use a typed array as a stack for better performance on large canvases
		var stack = new Int32Array(width * height);
		var stackSize = 0;
		stack[stackSize++] = y * width + x;

		while (stackSize > 0) {
			var pos = stack[--stackSize];
			if (visited[pos]) continue;

			var i = pos * 4;
			if (!colorMatch(i)) continue;

			visited[pos] = 1;
			data[i]     = fillR;
			data[i + 1] = fillG;
			data[i + 2] = fillB;
			data[i + 3] = fillA;

			var px = pos % width;
			var py = (pos / width) | 0;

			if (px > 0)          stack[stackSize++] = pos - 1;
			if (px < width - 1)  stack[stackSize++] = pos + 1;
			if (py > 0)          stack[stackSize++] = pos - width;
			if (py < height - 1) stack[stackSize++] = pos + width;
		}

		context.putImageData(imageData, 0, 0);
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-circle mdi-24px",
	name: "filledellipse",
	size: 3,
	alpha: 1,
	order: 11,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		context.globalCompositeOperation = "source-over";
		brush.currentAlpha = alpha;
		brush.startPosition = { x: x, y: y };
		this.effectCallback = brush.effectCallback;
		context.globalAlpha = alpha;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		context.globalAlpha = alpha;
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		context.fillStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x, sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if (angle) {
			var cx = this.width / 2, cy = this.height / 2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dsx = sx - cx, dsy = sy - cy, dex = ex - cx, dey = ey - cy;
			sx = cx + cos * dsx - sin * dsy;
			sy = cy + sin * dsx + cos * dsy;
			ex = cx + cos * dex - sin * dey;
			ey = cy + sin * dex + cos * dey;
		}
		var ecx = (sx + ex) / 2, ecy = (sy + ey) / 2;
		var rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
		if (rx > 0 && ry > 0) {
			context.beginPath();
			context.ellipse(ecx, ecy, rx, ry, 0, 0, 2 * Math.PI);
			context.fill();
		}
		if (angle) { context.restore(); }
		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		brush.currentPosition = { x: x, y: y };
	},
	effectCallback: function(context, brush, adjustx, adjusty, adjustzoom) {
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if (angle) {
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W / 2 - adjustx;
			var _cy = _H / 2 - adjusty;
			context.save();
			context.translate(_cx, _cy);
			context.rotate(-angle);
			context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = this.width * adjustzoom / 2, halfH = this.height * adjustzoom / 2;
			var sRelX = brush.startPosition.x  - this.width / 2, sRelY = brush.startPosition.y  - this.height / 2;
			var eRelX = brush.currentPosition.x - this.width / 2, eRelY = brush.currentPosition.y - this.height / 2;
			sx = (cos * sRelX - sin * sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin * sRelX + cos * sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos * eRelX - sin * eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin * eRelX + cos * eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x  * adjustzoom - adjustx;
			sy = brush.startPosition.y  * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		var ecx = (sx + ex) / 2, ecy = (sy + ey) / 2;
		var rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
		if (rx > 0 && ry > 0) {
			context.globalAlpha = brush.currentAlpha;
			context.fillStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
			context.beginPath();
			context.ellipse(ecx, ecy, rx, ry, 0, 0, 2 * Math.PI);
			context.fill();
		}
		if (angle) { context.restore(); }
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-square mdi-24px",
	name: "filledsquare",
	size: 3,
	alpha: 1,
	order: 8,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		this.effectCallback = brush.effectCallback;
		context.globalAlpha=alpha;
		context.lineWidth = size;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.lineWidth = size;
		context.fillStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x, sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if(angle){
			var cx = this.width/2, cy = this.height/2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dsx = sx-cx, dsy = sy-cy, dex = ex-cx, dey = ey-cy;
			sx = cx + cos*dsx - sin*dsy;
			sy = cy + sin*dsx + cos*dsy;
			ex = cx + cos*dex - sin*dey;
			ey = cy + sin*dex + cos*dey;
		}
		context.fillRect(sx, sy, ex-sx, ey-sy);
		if(angle){ context.restore(); }

		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if(angle){
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W / 2 - adjustx;
			var _cy = _H / 2 - adjusty;
			context.save();
			context.translate(_cx, _cy);
			context.rotate(-angle);
			context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = this.width * adjustzoom / 2, halfH = this.height * adjustzoom / 2;
			var sRelX = brush.startPosition.x  - this.width/2, sRelY = brush.startPosition.y  - this.height/2;
			var eRelX = brush.currentPosition.x - this.width/2, eRelY = brush.currentPosition.y - this.height/2;
			sx = (cos*sRelX - sin*sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin*sRelX + cos*sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos*eRelX - sin*eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin*eRelX + cos*eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x  * adjustzoom - adjustx;
			sy = brush.startPosition.y  * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		context.globalAlpha=brush.currentAlpha;
		context.lineJoin = 'miter';
		context.fillStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.fillRect(sx, sy, ex-sx, ey-sy);
		if(angle){ context.restore(); }
	}
});

//effectCallback
jQuery.fn.drawr.register({
	icon: "mdi mdi-vector-line mdi-24px",
	name: "line",
	size: 3,
	alpha: 1,
	order: 9,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.lineWidth = context.lineWidth = size;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		context.beginPath();
		context.moveTo(x, y);
		this.effectCallback = brush.effectCallback;
		context.globalAlpha=alpha;
		context.lineWidth = size;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.strokeStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		context.lineTo(brush.currentPosition.x, brush.currentPosition.y);
		context.stroke();

		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){
		context.globalAlpha=brush.currentAlpha;
		context.lineJoin = 'miter';
		context.lineWidth = brush.lineWidth*adjustzoom;
		context.strokeStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.beginPath();
		context.moveTo((brush.startPosition.x*adjustzoom)-adjustx, (brush.startPosition.y*adjustzoom)-adjusty);
		context.lineTo((brush.currentPosition.x*adjustzoom)-adjustx, (brush.currentPosition.y*adjustzoom)-adjusty);
		context.stroke();
	}
});

//effectCallback
jQuery.fn.drawr.register({
	icon: "mdi mdi-folder-open mdi-24px",
	name: "load",
	type: "action",
	order: 28,
	buttonCreated: function(brush,button){

		var self = this;

		var filePicker = $('<input type="file" class="drawr-filepicker-fix" accept="image/*">').css({
			position: 'absolute', 
			top: 0, 
			left: 0,
			width: "100%",
			height: "100%",
			opacity: 0,
			cursor: 'pointer'
		});
		button.css({
			'position' : 'relative'
		}).append(filePicker);
		filePicker[0].onchange = function(){
			var file = filePicker[0].files[0];
			if (!file || !file.type.startsWith('image/')){ return; }
			var reader = new FileReader();
			reader.onload = function(e) {
				$(self).drawr("load",e.target.result);//hacky, but works
			};
			reader.readAsDataURL(file);
		};

	}

});
jQuery.fn.drawr.register({
	icon: "mdi mdi-marker mdi-24px",
	name: "marker",
	size: 15,
	alpha: 0.3,
	order: 9,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	flow: 1,
	spacing: 0.25,
	rotation_mode: "none",
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.currentSize = size;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		brush._positions = [{x: x, y: y}];
		this.effectCallback = brush.effectCallback;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;

		context.globalAlpha=alpha;

		brush.currentSize = size;
		brush.currentAlpha = alpha;

		this.effectCallback = null;
		brush._positions = null;
		context.lineWidth = size;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";

		context.beginPath(); 
		var positions = $(this).data("positions");
		$.each(positions,function(i,position){
			if(i>0){
				context.moveTo(positions[i-1].x,positions[i-1].y);
				context.lineTo(position.x,position.y);
			}
		});
		context.stroke();
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentSize = size;
		brush.currentAlpha = alpha;
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
		if(brush._positions) brush._positions.push({x: x, y: y});
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){
		var positions = brush._positions;
		if(!positions || positions.length < 2) return;
		context.globalAlpha = brush.currentAlpha;
		context.lineWidth = brush.currentSize * adjustzoom;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.beginPath();
		for(var i = 1; i < positions.length; i++){
			context.moveTo((positions[i-1].x * adjustzoom) - adjustx, (positions[i-1].y * adjustzoom) - adjusty);
			context.lineTo((positions[i].x * adjustzoom) - adjustx, (positions[i].y * adjustzoom) - adjusty);
		}
		context.stroke();
	}
});

//effectCallback
jQuery.fn.drawr.register({
	icon: "mdi mdi-cursor-move mdi-24px",
	name: "move",
	order: 13,
	activate: function(brush,context){
		$(this).parent().css({"cursor":"move"});//"overflow":"scroll",
	},
	deactivate: function(brush,context){
	    $(this).parent().css({"cursor":"default"});//"overflow":"hidden",
	},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.dragStartX=null;brush.scrollStartX=null;
		brush.dragStartY=null;brush.scrollStartY=null;

		if(event.type=="touchmove" || event.type=="touchstart"){
			x = event.originalEvent.touches[0].pageX;
			y = event.originalEvent.touches[0].pageY;
		} else {
			x = event.pageX;
			y = event.pageY;
		}

		brush.dragStartX=x;
		brush.scrollStartX=this.scrollX;
		brush.dragStartY=y;
		brush.scrollStartY=this.scrollY;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;

		if(event.type=="touchmove" || event.type=="touchstart"){
			x = event.originalEvent.touches[0].pageX;
			y = event.originalEvent.touches[0].pageY;
		} else {
			x = event.pageX;
			y = event.pageY;
		}

		var diffx = parseInt(-(x - brush.dragStartX));
		var diffy = parseInt(-(y - brush.dragStartY));

		self.plugin.apply_scroll.call(self,brush.scrollStartX + diffx,brush.scrollStartY + diffy,true);
		//$(this).parent()[0].scrollLeft = brush.scrollStartX + diffx;
		//$(this).parent()[0].scrollTop = brush.scrollStartY + diffy;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-fountain-pen-tip mdi-24px",
	name: "pen",
	size: 3,
	alpha: 1,
	order: 2,
	pressure_affects_alpha: false,
	pressure_affects_size: true,
	smoothing: true,
	flow: 1,
	spacing: 0.1,
	rotation_mode: "none",
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha=alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		context.globalAlpha=alpha;
    	context.fillStyle = 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
		context.beginPath();
		context.arc(x,y, size/2, 0, 2 * Math.PI);
		context.fill();
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});
jQuery.fn.drawr.register({
	icon: "mdi mdi-lead-pencil mdi-24px",
	name: "pencil",
	size: 3,
	alpha: 1,
	order: 1,
	brush_fade_in: 20,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	smoothing: false,
	flow: 0.9,
	spacing: 0.2,
	size_jitter: 0.15,
	opacity_jitter: 0.2,
	rotation_mode: "random_jitter",
	angle_jitter: 1,
	activate: function(brush,context){
		brush._rawImage = new Image();
		brush._rawImage.crossOrigin = "Anonymous";
		brush._stampCache = null;
		brush._stampCacheKey = null;
		var pencilImg="data:image/png;base64,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";
		brush._rawImage.src = pencilImg;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawRotatedImage: function (context, image, x, y, angle, size) {
		context.save();
		context.translate(x,y);
		context.rotate(angle);
		if(image.width>=image.height){
			var imageHeight=image.height/(image.width/size);
			var imageWidth=size;
		} else {
			var imageWidth=image.width/(image.height/size)
			var imageHeight=size;
		}
		var destx=-imageWidth/2;
		var desty=-imageHeight/2;
		context.drawImage(image,destx,desty,imageWidth,imageHeight);
	    context.restore();
	},
	//angle is resolved by the engine's emit_spot from brush.rotation_mode. pencil's default is
	//"random_jitter" so every stamp comes in rotated by the engine — no local randomisation needed.
	drawSpot: function(brush,context,x,y,size,alpha,event,angle) {
		if(!brush._rawImage || !brush._rawImage.complete) return;
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var cacheKey = color.r + "," + color.g + "," + color.b;
		if(brush._stampCacheKey !== cacheKey){
			var img = brush._rawImage;
			var buffer = document.createElement("canvas");
			buffer.width = img.width;
			buffer.height = img.height;
			var bctx = buffer.getContext("2d");
			bctx.fillStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
			bctx.fillRect(0, 0, img.width, img.height);
			bctx.globalCompositeOperation = "destination-atop";
			bctx.drawImage(img, 0, 0);
			brush._stampCache = buffer;
			brush._stampCacheKey = cacheKey;
		}
		context.globalAlpha = alpha;
		var calculated_size = parseInt(size);
		if(calculated_size<2) calculated_size = 2;
		brush.drawRotatedImage(context, brush._stampCache, x, y, angle || 0, calculated_size);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-redo-variant mdi-24px",
	name: "redo",
	type: "action",
	order: 31,
	buttonCreated: function(brush,button){

		var self = this;

		button.css("opacity",0.5);
		self.$redoButton = button;

	},
	action: function(brush,context){
		var self = this;

		if(self.redoStack.length>0){
			var redo = self.redoStack.pop();

			//mark the current undoStack entry as a regular history entry
			//so undo can step back through it after this redo
			if(self.undoStack.length>0 && self.undoStack[self.undoStack.length-1].current==true){
				self.undoStack[self.undoStack.length-1].current = false;
			}

			var img = document.createElement("img");
			img.crossOrigin = "Anonymous";

			img.onload = function(){
				self.plugin.clear_canvas.call(self,false);
				context.globalCompositeOperation="source-over";
				context.globalAlpha = 1;
				context.drawImage(img,0,0);

				//we push the restored state as the new current so undo knows where we are
				self.undoStack.push({data:redo,current:true});
				if(self.undoStack.length>(self.settings.undo_max_levels+1)) self.undoStack.shift();

				if(typeof self.$undoButton!=="undefined"){
					self.$undoButton.css("opacity",1);
				}
				if(self.redoStack.length==0){
					self.$redoButton.css("opacity",0.5);
				}
			};
			img.src=redo;
		}

	},
	cleanup: function(){
		var self = this;
		delete self.$redoButton;
	}

});

jQuery.fn.drawr.register({

	icon: "mdi mdi-rotate-3d mdi-24px",
	name: "rotate",
	order: 11,

	activate: function(brush,context){
		$(this).parent().css({"cursor":"crosshair"});
	},
	deactivate: function(brush,context){
		$(this).parent().css({"cursor":"default"});
	},
	//reads raw page coordinates to compute angle from canvas center.
	drawStart: function(brush,context,x,y,size,alpha,event){


		var self = this;
		var parent = $(self).parent()[0];
		var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
		var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
		var box = parent.getBoundingClientRect();

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		//click position
		var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
		var py = eventY - (box.y + $(document).scrollTop()) - borderTop;

		//canvas center
		var W = self.width * self.zoomFactor;
		var H = self.height * self.zoomFactor;
		var cx = W / 2 - self.scrollX;
		var cy = H / 2 - self.scrollY;

		brush.startAngle = Math.atan2(py - cy, px - cx);
		brush.startRotation=self.rotationAngle || 0;

	},

	drawSpot: function(brush,context,x,y,size,alpha,event){

		var self = this;
		var parent = $(self).parent()[0];
		/*
		var rect = parent.getBoundingClientRect();
		 
		*/
		var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
		var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
		var box = parent.getBoundingClientRect();

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
		var py = eventY - (box.y + $(document).scrollTop()) - borderTop;

		var W = self.width * self.zoomFactor;
		var H = self.height * self.zoomFactor;
		var cx = W / 2 - self.scrollX;
		var cy = H / 2 - self.scrollY;

		var currentAngle = Math.atan2(py - cy, px - cx);
		var delta = currentAngle - brush.startAngle;

		self.plugin.apply_rotation.call(self, brush.startRotation + delta,true);

	}

});

jQuery.fn.drawr.register({
	icon: "mdi mdi-content-save mdi-24px",
	name: "save",
	type: "action",
	order: 30,
	action: function(brush,context){
		var imagedata = $(this).drawr("export","image/png");
		var element = document.createElement('a');
		element.setAttribute('href', imagedata);
		var filename = "download-" + Date.now() + ".png";
		element.setAttribute('download', filename);
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	}

});
jQuery.fn.drawr.register({
	icon: "mdi mdi-tune mdi-24px",
	name: "settings",
	type: "toggle",
	order: 33,
	buttonCreated: function(brush,button){

		var self = this;
		var context = self.getContext('2d');

		//color dialog
		self.$settingsToolbox = self.plugin.create_toolbox.call(self,"settings",null,"Settings",180);

		self.$cbPressureAlpha = self.plugin.create_label.call(self, self.$settingsToolbox, "Color");

		self.$settingsToolbox.append("<div style='margin-bottom:40px;'><input type='text' class='color-picker' style='z-index:1;position:absolute;margin:-10px 0px 0px -30px;'/></div>");
		self.$settingsToolbox.find('.color-picker').drawrpalette({ auto_apply: true }).on("choose.drawrpalette",function(event,hexcolor){
			self.brushColor = self.plugin.hex_to_rgb(hexcolor);
			if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,context);
		});

		self.$settingsToolbox.find('input.color-picker').drawrpalette("set",self.plugin.rgb_to_hex(self.brushColor.r,self.brushColor.g,self.brushColor.b));

		self.$settingsToolbox.append("<input type='text' class='color-picker2' style='z-index:0;position:absolute;margin:-40px 0px 0px -10px;'/>");
		self.$settingsToolbox.find('.color-picker2').drawrpalette({ auto_apply: true }).on("choose.drawrpalette",function(event,hexcolor){
			self.brushBackColor = self.plugin.hex_to_rgb(hexcolor);
			if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,context);
		});

		self.$settingsToolbox.find('input.color-picker2').drawrpalette("set",self.plugin.rgb_to_hex(self.brushBackColor.r,self.brushBackColor.g,self.brushBackColor.b));

		self.$alphaSlider = self.plugin.create_slider.call(self, self.$settingsToolbox,"alpha", 0,100,parseInt(100*self.settings.inital_brush_alpha)).on("input.drawr",function(){
			var v = parseFloat(this.value/100);
			self.brushAlpha = v;
			if(typeof self.active_brush.alpha!=="undefined") self.active_brush.alpha = v;
			if(!self._suppressSettingsWrite && self.active_brush && typeof self.active_brush.alpha!=="undefined"){
				self.plugin.persist_tool_setting.call(self, self.active_brush, "alpha", v);
			}
			self.plugin.is_dragging=false;
		});
		self.$sizeSlider = self.plugin.create_slider.call(self, self.$settingsToolbox,"size", 1,100,self.settings.inital_brush_size).on("input.drawr",function(){
			var v = parseInt(this.value);
			self.brushSize = v;
			if(typeof self.active_brush.size!=="undefined")  self.active_brush.size = v;
			if(!self._suppressSettingsWrite && self.active_brush && typeof self.active_brush.size!=="undefined"){
				self.plugin.persist_tool_setting.call(self, self.active_brush, "size", v);
			}
			self.plugin.is_dragging=false;
		});

		if(self.settings.enable_transparency){
			self.$paperColorDropdown = self.plugin.create_dropdown.call(self, self.$settingsToolbox, "Paper color", [
				{ value: "checkerboard", label: "Checkered" },
				{ value: "solid", label: "Solid" }
			], self.paperColorMode);
			self.$paperColorDropdown.on("change.drawr", function(){
				self.paperColorMode = $(this).val();
				self.plugin.draw_checkerboard.call(self);
				self.plugin.is_dragging = false;
				if($(this).val() === "solid"){
					self.$paperColorPicker.parent().show();
				} else {
					self.$paperColorPicker.parent().hide();
				}
			});

			self.$settingsToolbox.append("<div class='paper-color-picker-wrap' style='padding:0 8px 4px;'><input type='text' value='" + self.paperColor + "' class='paper-color-picker'/></div>");
			self.$paperColorPicker = self.$settingsToolbox.find('.paper-color-picker');
			self.$paperColorPicker.drawrpalette({ auto_apply: true }).on("choose.drawrpalette", function(event, hexcolor){
				self.paperColor = hexcolor;
				self.plugin.draw_checkerboard.call(self);
			});
			self.$paperColorPicker.parent().on("pointerdown touchstart mousedown", function(e){
				e.stopPropagation();
			});

			if(self.paperColorMode === "solid"){
				self.$paperColorPicker.parent().show();
			} else {
				self.$paperColorPicker.parent().hide();
			}

		}

		self.$cbPressureAlpha = self.plugin.create_label.call(self, self.$settingsToolbox, "Pressure affects");

		self.$cbPressureAlpha = self.plugin.create_checkbox.call(self, self.$settingsToolbox, "Alpha", false);
		self.$cbPressureAlpha.on("change.drawr", function(){
			self.active_brush.pressure_affects_alpha = this.checked;
			if(!self._suppressSettingsWrite) self.plugin.persist_tool_setting.call(self, self.active_brush, "pressure_affects_alpha", this.checked);
			self.plugin.is_dragging = false;
		});

		self.$cbPressureSize = self.plugin.create_checkbox.call(self, self.$settingsToolbox, "Size", false);
		self.$cbPressureSize.on("change.drawr", function(){
			self.active_brush.pressure_affects_size = this.checked;
			if(!self._suppressSettingsWrite) self.plugin.persist_tool_setting.call(self, self.active_brush, "pressure_affects_size", this.checked);
			self.plugin.is_dragging = false;
		});

		//---- Advanced (brush dynamics) ----------------------------------------
		//The Advanced section collects the per-spot dynamics applied uniformly by the engine:
		//spacing, flow, jitters, scatter, rotation. Hidden for tools without drawSpot.
		self.$advancedSection = self.plugin.create_collapsible.call(self, self.$settingsToolbox, "Advanced", true);

		//dropdown helper takes options list. rotation_mode values match what emit_spot expects.
		self.$rotationModeDropdown = self.plugin.create_dropdown.call(self, self.$advancedSection, "Rotation", [
			{ value: "none",           label: "None" },
			{ value: "fixed",          label: "Fixed" },
			{ value: "follow_stroke",  label: "Follow" },
			{ value: "random_jitter",  label: "Random" },
			{ value: "follow_jitter",  label: "Follow±" }
		], "none");
		self.$rotationModeDropdown.on("change.drawr", function(){
			if(!self.active_brush) return;
			self.active_brush.rotation_mode = $(this).val();
			if(!self._suppressSettingsWrite) self.plugin.persist_tool_setting.call(self, self.active_brush, "rotation_mode", $(this).val());
			self.plugin.is_dragging = false;
		});

		//all numeric dynamics use a 0..100 slider; values are mapped to the canonical range in the handler.
		//spacing uses 2..200 mapped to 0.02..2 so the min is usable.
		self.$spacingSlider    = self.plugin.create_slider.call(self, self.$advancedSection, "spacing",    2, 200, 25);
		self.$flowSlider       = self.plugin.create_slider.call(self, self.$advancedSection, "flow",       0, 100, 100);
		self.$sizeJitSlider    = self.plugin.create_slider.call(self, self.$advancedSection, "sizejitter", 0, 100, 0);
		self.$opJitSlider      = self.plugin.create_slider.call(self, self.$advancedSection, "opjitter",   0, 100, 0);
		self.$angleJitSlider   = self.plugin.create_slider.call(self, self.$advancedSection, "anglejit",   0, 100, 0);
		self.$scatterSlider    = self.plugin.create_slider.call(self, self.$advancedSection, "scatter",    0, 100, 0);
		self.$fixedAngleSlider = self.plugin.create_slider.call(self, self.$advancedSection, "angle",      0, 359, 0);
		self.$fadeInSlider     = self.plugin.create_slider.call(self, self.$advancedSection, "fadein",     0, 200, 0);

		//bind each slider to its canonical field on active_brush, with its own mapping.
		//update() sets _suppressSettingsWrite=true while repopulating, so we don't write-back defaults on every tool switch.
		var bindSlider = function($slider, field, mapToCanonical){
			$slider.on("input.drawr", function(){
				if(!self.active_brush) return;
				var v = mapToCanonical(parseFloat(this.value));
				self.active_brush[field] = v;
				if(!self._suppressSettingsWrite) self.plugin.persist_tool_setting.call(self, self.active_brush, field, v);
				self.plugin.is_dragging = false;
			});
		};
		bindSlider(self.$spacingSlider,    "spacing",        function(v){ return v / 100; });
		bindSlider(self.$flowSlider,       "flow",           function(v){ return v / 100; });
		bindSlider(self.$sizeJitSlider,    "size_jitter",    function(v){ return v / 100; });
		bindSlider(self.$opJitSlider,      "opacity_jitter", function(v){ return v / 100; });
		bindSlider(self.$angleJitSlider,   "angle_jitter",   function(v){ return v / 100; });
		bindSlider(self.$scatterSlider,    "scatter",        function(v){ return v / 100; });
		bindSlider(self.$fixedAngleSlider, "fixed_angle",    function(v){ return v * Math.PI / 180; });
		bindSlider(self.$fadeInSlider,     "brush_fade_in",  function(v){ return Math.round(v); });

		self.$cbSmoothing = self.plugin.create_checkbox.call(self, self.$advancedSection, "Smoothing", false);
		self.$cbSmoothing.on("change.drawr", function(){
			if(!self.active_brush) return;
			self.active_brush.smoothing = this.checked;
			if(!self._suppressSettingsWrite) self.plugin.persist_tool_setting.call(self, self.active_brush, "smoothing", this.checked);
			self.plugin.is_dragging = false;
		});

		//Reset Defaults — restores the tool to the values snapshotted at register() time.
		//Hidden for custom (removable) brushes since their "defaults" live in the saved record.
		self.$resetButton = self.plugin.create_button.call(self, self.$advancedSection, "Reset defaults");
		self.$resetButton.on("click.drawr", function(){
			if(!self.active_brush || self.active_brush.removable) return;
			self.plugin.reset_tool_defaults.call(self, self.active_brush);
			//reactivate to re-run the tool's activate() (e.g. to rebuild stamp caches) and repopulate UI.
			self.plugin.activate_brush.call(self, self.active_brush);
		});

	},
	//updates the UI of the settings dialog when the brush changes. settings specific function.
	update: function(){

		var self = this;
		//Suppress writes to localStorage while we programmatically sync the UI to the active brush.
		//Otherwise every tool switch would rewrite the current values as overrides.
		self._suppressSettingsWrite = true;

		//update sliders based on current brush

		//if(typeof this.$settingsToolbox!=="undefined")

		self.$alphaSlider.prop("disabled",false);
		self.$sizeSlider.prop("disabled",false);

		if(typeof self.active_brush.alpha!=="undefined"){
			self.$alphaSlider.val(self.active_brush.alpha*100).trigger("input");
		} else {
			self.$alphaSlider.prop("disabled",true);
		}

		if(typeof self.active_brush.size!=="undefined"){
			self.$sizeSlider.val(self.active_brush.size).trigger("input");
		} else {
			self.$sizeSlider.prop("disabled",true);
		}

		//update checkboxes based on current brush
		if(self.$cbPressureAlpha){
			self.$cbPressureAlpha.prop("disabled", false);
			if(typeof self.active_brush.pressure_affects_alpha!=="undefined") self.$cbPressureAlpha.prop("checked", !!self.active_brush.pressure_affects_alpha);
		}
		if(self.$cbPressureSize){
			self.$cbPressureSize.prop("disabled", false);
			if(typeof self.active_brush.pressure_affects_size!=="undefined")  self.$cbPressureSize.prop("checked",  !!self.active_brush.pressure_affects_size);
		}

		if(self.$cbPressureAlpha && typeof self.active_brush.pressure_affects_alpha=="undefined"){
			self.$cbPressureAlpha.prop("checked", false);
			self.$cbPressureAlpha.prop("disabled", true);
		}

		if(self.$cbPressureSize && typeof self.active_brush.pressure_affects_size=="undefined"){
			self.$cbPressureSize.prop("checked", false);
			self.$cbPressureSize.prop("disabled", true);
		}

		//---- Advanced section ----------------------------------------
		//Hide entirely for tools without drawSpot (shape/action tools) — dynamics don't apply to them.
		if(self.$advancedSection){
			var hasSpot = typeof self.active_brush.drawSpot !== "undefined";
			self.$advancedSection.closest(".drawr-collapsible").css("display", hasSpot ? "" : "none");
			if(hasSpot){
				//read each field from active_brush with a sensible fallback; slider setters use .val() + trigger("input")
				//to update the numeric display but we avoid re-persisting on every activate by setting val() directly
				//when the value matches what we'd write back. Cheap approach: use .val() then trigger("input") — which
				//calls our handler and writes to active_brush[field] with the same value (idempotent).
				var b = self.active_brush;
				if(self.$rotationModeDropdown){
					self.$rotationModeDropdown.val(b.rotation_mode || "none");
				}
				if(self.$spacingSlider)    self.$spacingSlider.val(Math.round(((typeof b.spacing === "number") ? b.spacing : 0.25) * 100)).trigger("input");
				if(self.$flowSlider)       self.$flowSlider.val(Math.round(((typeof b.flow === "number") ? b.flow : 1) * 100)).trigger("input");
				if(self.$sizeJitSlider)    self.$sizeJitSlider.val(Math.round((b.size_jitter || 0) * 100)).trigger("input");
				if(self.$opJitSlider)      self.$opJitSlider.val(Math.round((b.opacity_jitter || 0) * 100)).trigger("input");
				if(self.$angleJitSlider)   self.$angleJitSlider.val(Math.round((b.angle_jitter || 0) * 100)).trigger("input");
				if(self.$scatterSlider)    self.$scatterSlider.val(Math.round((b.scatter || 0) * 100)).trigger("input");
				if(self.$fixedAngleSlider) self.$fixedAngleSlider.val(Math.round(((b.fixed_angle || 0) * 180 / Math.PI) % 360)).trigger("input");
				if(self.$fadeInSlider)     self.$fadeInSlider.val(b.brush_fade_in || 0).trigger("input");
				if(self.$cbSmoothing)      self.$cbSmoothing.prop("checked", !!b.smoothing);
				//Reset hidden for custom brushes (their "defaults" are the record fields)
				if(self.$resetButton)      self.$resetButton.css("display", b.removable ? "none" : "");
			}
		}

		self._suppressSettingsWrite = false;
	},
	action: function(brush,context){
		var self = this;
		
		if(typeof this.$settingsToolbox!=="undefined"){
			brush.update.call(this,brush);
		}

		if(self.$settingsToolbox.is(":visible")){
			self.$settingsToolbox.hide();
		} else {
			self.plugin.show_toolbox.call(self, self.$settingsToolbox);
		}

	},
	cleanup: function(){
		var self = this;
		self.$settingsToolbox.find('.color-picker').off("choose.drawrpalette").drawrpalette("destroy");
		if(self.$paperColorPicker){
			self.$paperColorPicker.off("choose.drawrpalette").drawrpalette("destroy");
			delete self.$paperColorPicker;
			delete self.$paperColorDropdown;
		}
		self.$settingsToolbox.remove();
		delete self.$settingsToolbox;
		delete self.$cbPressureAlpha;
		delete self.$cbPressureSize;
		delete self.$alphaSlider;
		delete self.$sizeSlider;
		//Advanced section refs
		delete self.$advancedSection;
		delete self.$rotationModeDropdown;
		delete self.$spacingSlider;
		delete self.$flowSlider;
		delete self.$sizeJitSlider;
		delete self.$opJitSlider;
		delete self.$angleJitSlider;
		delete self.$scatterSlider;
		delete self.$fixedAngleSlider;
		delete self.$fadeInSlider;
		delete self.$cbSmoothing;
		delete self.$resetButton;
	}

});

jQuery.fn.drawr.register({
	icon: "mdi mdi-vector-square mdi-24px",
	name: "square",
	size: 3,
	alpha: 1,
	order: 7,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.currentSize = size;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		this.effectCallback = brush.effectCallback;
		context.globalAlpha=alpha;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.lineWidth = size;
		context.strokeStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x, sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if(angle){
			var cx = this.width/2, cy = this.height/2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dsx = sx-cx, dsy = sy-cy, dex = ex-cx, dey = ey-cy;
			sx = cx + cos*dsx - sin*dsy;
			sy = cy + sin*dsx + cos*dsy;
			ex = cx + cos*dex - sin*dey;
			ey = cy + sin*dex + cos*dey;
		}
		context.strokeRect(sx, sy, ex-sx, ey-sy);
		if(angle){ context.restore(); }

		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if(angle){
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W / 2 - adjustx;
			var _cy = _H / 2 - adjusty;
			context.save();
			context.translate(_cx, _cy);
			context.rotate(-angle);
			context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = this.width * adjustzoom / 2, halfH = this.height * adjustzoom / 2;
			var sRelX = brush.startPosition.x  - this.width/2, sRelY = brush.startPosition.y  - this.height/2;
			var eRelX = brush.currentPosition.x - this.width/2, eRelY = brush.currentPosition.y - this.height/2;
			sx = (cos*sRelX - sin*sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin*sRelX + cos*sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos*eRelX - sin*eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin*eRelX + cos*eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x  * adjustzoom - adjustx;
			sy = brush.startPosition.y  * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		context.globalAlpha = brush.currentAlpha;
		context.lineWidth = brush.currentSize*adjustzoom;
		context.lineJoin = 'miter';
		context.strokeStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.strokeRect(sx, sy, ex-sx, ey-sy);
		if(angle){ context.restore(); }
	}
});

//effectCallback
jQuery.fn.drawr.register({
	icon: "mdi mdi-format-text mdi-24px",
	name: "text",
	size: 22,
	alpha: 1,
	order: 14,
	//The tool object is shared across drawr instances on a page, so per-canvas DOM/state
	//(the floating input box, the pending text position) must live on `self` — never on `brush`.
	activate: function(brush,context){

	},
	deactivate: function(brush,context){
		if(typeof this.$textFloatyBox!=="undefined"){
			this.$textFloatyBox.remove();
			delete this.$textFloatyBox;
		}
	},
	canvasToViewport: function(x, y){
		//helper to make translation a bit more readable
		var angle = this.rotationAngle || 0;
		var cx = this.width / 2, cy = this.height / 2;
		var dx = x - cx, dy = y - cy;
		var cos = Math.cos(angle), sin = Math.sin(angle);
		return {
			x: (cos*dx - sin*dy) * this.zoomFactor + cx*this.zoomFactor - this.scrollX,
			y: (sin*dx + cos*dy) * this.zoomFactor + cy*this.zoomFactor - this.scrollY
		};
	},
	drawStart: function(brush,context,x,y,size,alpha,event){
		var self=this;
		self._textPosition = { x: x, y: y };
		context.globalAlpha=alpha
		if(typeof self.$textFloatyBox=="undefined"){
			var fontSizeForDisplay= parseInt(20 * self.zoomFactor);
			self.$textFloatyBox = $('<div style="z-index:6;position:absolute;width:100px;height:20px;"><input style="background:transparent;border:0px;padding:0px;font-size:' + fontSizeForDisplay + 'px;font-family:sans-serif;" type="text" value=""><button class="ok"><i class="mdi mdi-check"></i></button><button class="cancel"><i class="mdi mdi-close"></i></button></div>');
			$(self.$textFloatyBox).insertAfter($(self).parent());
			var vp = brush.canvasToViewport.call(self, x, y);
			self.$textFloatyBox.css({
				left: $(self).parent().offset().left + vp.x,
				top: $(self).parent().offset().top + vp.y,
			});
			self.$textFloatyBox.find("input").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				self.$textFloatyBox.find("input").focus();
			});
			self.$textFloatyBox.find("input").focus();
			event.preventDefault();
			event.stopPropagation();
			self.$textFloatyBox.find(".ok").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.applyText.call(self,context,brush,self._textPosition.x,self._textPosition.y,self.$textFloatyBox.find("input").val());
				self.$textFloatyBox.remove();
				delete self.$textFloatyBox;
			});
			self.$textFloatyBox.find(".cancel").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				self.$textFloatyBox.remove();
				delete self.$textFloatyBox;
			});
		} else {
			var vp = brush.canvasToViewport.call(self, x, y);
			self.$textFloatyBox.css({
				left: $(self).parent().offset().left + vp.x,
				top: $(self).parent().offset().top + vp.y,
			});
		}
	},
	applyText: function(context,brush,x,y,text){
		context.font = "20px sans-serif";
		context.textAlign = "left";
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		var angle = this.rotationAngle || 0;
		var drawX = x - 2, drawY = y + 19;
		if(angle){
			var cx = this.width / 2, cy = this.height / 2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dx = drawX - cx, dy = drawY - cy;
			drawX = cx + cos*dx - sin*dy;
			drawY = cy + sin*dx + cos*dy;
		}
		context.fillText(text, drawX, drawY);
		if(angle){ context.restore(); }
		this.plugin.record_undo_entry.call(this);
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		this._textPosition = { x: x, y: y };
		if(typeof this.$textFloatyBox!=="undefined"){
			var vp = brush.canvasToViewport.call(this, x, y);
			this.$textFloatyBox.css({
				left: $(this).parent().offset().left + vp.x,
				top: $(this).parent().offset().top + vp.y,
			});
		}
	}
});

//effectCallback

jQuery.fn.drawr.register({
	icon: "mdi mdi-undo-variant mdi-24px",
	name: "undo",
	type: "action",
	order: 30,
	buttonCreated: function(brush,button){

		var self = this;


		button.css("opacity",0.5);
		self.$undoButton = button;

	},
	action: function(brush,context){
		var self = this;

		if(self.undoStack.length>0){
			//the current property is because of the way some tools work it is needed to always keep a copy of the canvas' latest state (AFTER last draw action was done) in the undo buffer.
			//obviously you want to go back to the previous version, not the current one, so that one is ignored.
			var currentData = null;
			if(self.undoStack[self.undoStack.length-1].current==true){
				currentData = self.undoStack.pop().data;//save current canvas state for redo
			}
			$.each(self.undoStack,function(i,stackitem){
				stackitem.current=false;
			});
			if(self.undoStack.length>0) {//is there anything noncurrent
				var undo = self.undoStack.pop().data;
				//push current state onto redo stack before restoring
				if(currentData!==null){
					self.redoStack.push(currentData);
					if(typeof self.$redoButton!=="undefined"){
						self.$redoButton.css("opacity",1);
					}
				}
				var img = document.createElement("img");
				img.crossOrigin = "Anonymous";

				img.onload = function(){
					self.plugin.clear_canvas.call(self,false);
					context.globalCompositeOperation="source-over";
					context.globalAlpha = 1;
					context.drawImage(img,0,0);
				};
				img.src=undo;
			}
			if(self.undoStack.length==0) {//re-add current version of the canvas.
				self.$undoButton.css("opacity",0.5);
			}
			self.undoStack.push({data:undo,current:true});
		}

	},
	cleanup: function(){
		var self = this;
		delete self.$undoButton;
	}

});

jQuery.fn.drawr.register({
	icon: "mdi mdi-magnify mdi-24px",
	name: "zoom",
	type: "toggle",
	order: 14,
	buttonCreated: function(brush,button){

		var self = this;

		self.$zoomToolbox = self.plugin.create_toolbox.call(self,"zoom",null,"Zoom",80);
		self.plugin.create_slider.call(self, self.$zoomToolbox,"zoom", 0,400,100).on("input.drawr",function(){
			var cleaned = Math.ceil(this.value/10)*10;
			$(this).next().text(cleaned);
			self.plugin.apply_zoom.call(self,cleaned/100);
		});

	},
	action: function(brush,context){
		var self = this;
		if(self.$zoomToolbox.is(":visible")){
			self.$zoomToolbox.hide();
		} else {
			self.plugin.show_toolbox.call(self, self.$zoomToolbox);
		}
	},
	cleanup: function(){
		var self = this;
		self.$zoomToolbox.remove();
		delete self.$zoomToolbox;
	}

});

  return $;
}));