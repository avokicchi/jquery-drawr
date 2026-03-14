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

	var DRAWR_VERSION = "0.9.4";

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
			$(self).parent().on("touchstart.drawr", function(e){ e.preventDefault(); });//cancel scroll.

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

				//right-mouse drag: enter paning mode
				if(e.button === 2){
					if(self.containerBoundCheck.call(self, e)){
						self.isRightDragging = true;
						self.rightDragStart = { x: e.pageX, y: e.pageY, scrollX: self.scrollX, scrollY: self.scrollY };
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
						context.lineCap = "round";context.lineJoin = 'round';

						//reset fade-in counter at start of stroke
						self._fadeInSpotCount = 0;

						//calculate alpha and size, scaled by pressure if the brush supports it
						var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure);
						var calculatedAlpha = bp.alpha, calculatedSize = bp.size;

						$(self).data("positions",[{x:mouse_data.x,y:mouse_data.y}]);
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
			$(window).bind("pointerdown.drawr", self.drawStart);

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

				//right-mouse drag: pan the canvas
				if(self.isRightDragging){
					var dx = e.pageX - self.rightDragStart.x;
					var dy = e.pageY - self.rightDragStart.y;
					plugin.apply_scroll.call(self, self.rightDragStart.scrollX - dx, self.rightDragStart.scrollY - dy, false);
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

					var positions = $(self).data("positions");
					var currentSpot = {x:mouse_data.x,y:mouse_data.y};
					var lastSpot=positions[positions.length-1];
					var dist = plugin.distance_between(lastSpot, currentSpot);
					 var angle = plugin.angle_between(lastSpot, currentSpot);

					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;

					 var stepSize = calculatedSize/6;

					 if(stepSize<1) stepSize = 1;
					 //advance along the line between last spot and current spot using a^2 + b^2 = c^2 nonsense.
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
				$(self).parent().on("wheel.drawr", function(e){ 
					e.preventDefault(); 
					self.scrollWheel(e);
				});
			}
			$(self).parent().on("contextmenu.drawr", function(e){ e.preventDefault(); });
			//prevent browser native touch gestures (scroll, pinch-zoom) so pointer events fire uninterrupted
			$(self).parent().css("touch-action", "none");

			$(window).bind("pointermove.drawr", self.drawMove);

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

				//right-mouse drag: end pan mode
				if(self.isRightDragging){
					
					//console.warn("right drag: end");
					self.isRightDragging = false;
					return;
				}

				if($(self).data("is_drawing")==true){
					var mouse_data = plugin.get_mouse_data.call(self,e,self);
				
					//if(plugin.check_ignore(e)==true) return;
					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;
					var result;

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
			$(window).bind("pointerup.drawr pointercancel.drawr", self.drawStop);
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

			el.on("pointerdown.drawr", function(e){
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
			$(toolbox).append('<div style="clear:both;font-weight:bold;text-align:center;padding:5px 0px 5px 0px">' + title + '</div><div style="clear:both;display: inline-block;width: 50px;height: 60px;margin-top:5px;padding: 0;"><input class="slider-component slider-' + title.toLowerCase() + '" value="' + value + '" style="background:transparent;width: 50px;height: 50px;margin: 0;transform-origin: 25px 25px;transform: rotate(90deg);" type="range" min="' + min + '" max="' + max + '" step="1" /><span>' + value + '</span></div>');
			$(toolbox).find(".slider-" + title.toLowerCase()).on("pointerdown touchstart",function(e){
				e.stopPropagation();
			}).on("input.drawr",function(e){
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
				if(this.settings.enable_transparency==false){
					context.fillStyle="white";
					context.fillRect(0,0,width,height);
				} else {
					context.clearRect(0,0,width,height);
				}
			} else {
				var is_blank = !new Uint32Array(context.getImageData(0, 0, width, height).data.buffer).some(x => x !== 0);
				if(is_blank){
					if(this.settings.clear_on_init==true){
						context.fillStyle="white";
						context.fillRect(0,0,width,height);
					} else {
						context.clearRect(0,0,width,height);
					}
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

				context.globalAlpha = (0.6/100)*this.scrollTimer<1 ?  (0.6/100)*this.scrollTimer : 0.6;//brush.currentAlpha;

				this.scrollTimer-=5;
				context.lineWidth = 4;
				context.lineCap = 'square';
				context.beginPath();

				//get the axis-aligned bounding box of the rotated canvas 
				var _angle = this.rotationAngle || 0;
				var _W = this.width * this.zoomFactor;
				var _H = this.height * this.zoomFactor;
				var _abscos = Math.abs(Math.cos(_angle));
				var _abssin = Math.abs(Math.sin(_angle));
				var effectiveWidth  = _W * _abscos + _H * _abssin;
				var effectiveHeight = _W * _abssin + _H * _abscos;

				//horizontal
				var max_bar_width = container_width;
				var visible_scroll_x = container_width;
				if(this.scrollX<0) visible_scroll_x += this.scrollX;
				if(this.scrollX> effectiveWidth-container_width) visible_scroll_x -= this.scrollX-(effectiveWidth-container_width);
				if(visible_scroll_x<0) visible_scroll_x = 0;
				var percentage = 100/effectiveWidth * visible_scroll_x;
				var scroll_bar_width= max_bar_width / 100 * percentage;
				if(scroll_bar_width<1) scroll_bar_width = 1;

				var position_percentage = (100/(effectiveWidth-container_width))*this.scrollX;
				var posx=(((max_bar_width-scroll_bar_width)/100)*position_percentage);
				if(posx<0) posx=0;
				if(posx>container_width-scroll_bar_width) posx = container_width-scroll_bar_width;

				context.moveTo(posx,container_height-3);
				context.lineTo(posx+scroll_bar_width,container_height-3);
				context.stroke();

				//vertical
				var max_bar_height = container_height;
				var visible_scroll_y = container_height;
				if(this.scrollY<0) visible_scroll_y += this.scrollY;
				if(this.scrollY> effectiveHeight-container_height) visible_scroll_y -= this.scrollY-(effectiveHeight-container_height);
				if(visible_scroll_y<0) visible_scroll_y = 0;
				var percentage = 100/effectiveHeight * visible_scroll_y;
				var scroll_bar_height= max_bar_height / 100 * percentage;
				if(scroll_bar_height<1) scroll_bar_height = 1;

				var position_percentage = (100/(effectiveHeight-container_height))*this.scrollY;
				var posy=(((max_bar_height-scroll_bar_height)/100)*position_percentage);
				if(posy<0) posy=0;
				if(posy>container_height-scroll_bar_height) posy = container_height-scroll_bar_height;

				context.moveTo(container_width-2,posy);
				context.lineTo(container_width-2,posy+scroll_bar_height);
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
			$(toolbox).on("pointerdown.drawr touchstart.drawr", function(e){
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
				parent.off("touchstart.drawr");
				parent.off("wheel.drawr");
				parent.off("contextmenu.drawr");
				parent.find(".drawr-toolbox .drawr-tool-btn").off("pointerdown.drawr");
				parent.find(".drawr-toolbox .slider-component").off("input.drawr");
				parent.find(".drawr-toolbox").off("pointerdown.drawr touchstart.drawr");
				$(window).unbind("pointerup.drawr pointercancel.drawr", currentCanvas.drawStop);
				$(window).unbind("pointermove.drawr", currentCanvas.drawMove);
				$(window).unbind("pointerdown.drawr", currentCanvas.drawStart);
				$(window).unbind("wheel.drawr", currentCanvas.scrollWheel);
				$(window).off("resize.drawr", currentCanvas.onWindowResize);

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
					"debug_mode" : false
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
				currentCanvas.onWindowResize = function() {
					currentCanvas.containerWidth = _parent.width();
					currentCanvas.containerHeight = _parent.height();
				};
				$(window).on("resize.drawr", currentCanvas.onWindowResize);

				currentCanvas.plugin = plugin;
				currentCanvas.rotationAngle = 0;
				currentCanvas.draw_animations_bound = plugin.draw_animations.bind(currentCanvas);
				currentCanvas._animFrameQueued = false;

				//set up canvas
				plugin.initialize_canvas.call(currentCanvas,defaultSettings.canvas_width,defaultSettings.canvas_height,true);
				currentCanvas.undoStack = [{data:currentCanvas.toDataURL("image/png"),current:true}];
				currentCanvas.redoStack = [];
				var context = currentCanvas.getContext("2d", { alpha: defaultSettings.enable_transparency });
				currentCanvas.brushColor = { r: 0, g: 0, b: 0 };

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
	size: 40,
	alpha: 0.2,
	order: 3,
	brush_fade_in: 10,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
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
		var self = this;
		var cacheKey = size + '|' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b;
		if(brush._stampCacheKey !== cacheKey){
			var buffer = document.createElement('canvas');
			buffer.width = size;
			buffer.height = size;
			var bctx = buffer.getContext('2d');
			var half = size / 2;
			var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
			radgrad.addColorStop(0, 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')');
			radgrad.addColorStop(0.5, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0.5)');
			radgrad.addColorStop(1, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0)');
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
	icon: "mdi mdi-blur mdi-24px",
	name: "blur",
	size: 20,
	alpha: 0.8,
	order: 16,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var radius      = Math.max(2, Math.round(size / 2));
		var diameter    = radius * 2;
		var kernelRadius = Math.max(2, Math.round(radius / 4));

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		//work from a snapshot so we never blur already-blurred pixels in this pass
		var src = new Uint8ClampedArray(data);

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//taper off strength from centre
				var t     = 1 - dist / radius;
				var blend = alpha * t * t;

				//box blur: average kernel-sized neighbourhood from the snapshot
				var sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
				for (var ky = -kernelRadius; ky <= kernelRadius; ky++) {
					for (var kx = -kernelRadius; kx <= kernelRadius; kx++) {
						var nr = row + ky;
						var nc = col + kx;
						if (nr < 0 || nr >= diameter || nc < 0 || nc >= diameter) continue;
						var ki = (nr * diameter + nc) * 4;
						sumR += src[ki];
						sumG += src[ki + 1];
						sumB += src[ki + 2];
						sumA += src[ki + 3];
						count++;
					}
				}

				var i = (row * diameter + col) * 4;
				data[i]     = src[i]     + (sumR / count - src[i])     * blend;
				data[i + 1] = src[i + 1] + (sumG / count - src[i + 1]) * blend;
				data[i + 2] = src[i + 2] + (sumB / count - src[i + 2]) * blend;
				data[i + 3] = src[i + 3] + (sumA / count - src[i + 3]) * blend;
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-brush mdi-24px",
	name: "brush",
	size: 3,
	alpha: 0.5,
	order: 4,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	brush_fade_in: 20,
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
		var self = this;
		var cacheKey = size + '|' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b;
		if(brush._stampCacheKey !== cacheKey){
			var sz = Math.max(1, size);
			var buffer = document.createElement('canvas');
			buffer.width = sz;
			buffer.height = sz;
			var bctx = buffer.getContext('2d');
			var half = sz / 2;
			var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
			radgrad.addColorStop(0, 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')');
			radgrad.addColorStop(0.5, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0.5)');
			radgrad.addColorStop(1, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0)');
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
	icon: "mdi mdi-fire mdi-24px",
	name: "burn",
	size: 20,
	alpha: 0.5,
	order: 16,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//taper off strength from centre
				var t     = 1 - dist / radius;
				var blend = alpha * t * t;

				var i = (row * diameter + col) * 4;
				//burn: push each channel toward 0
				data[i]     = data[i]     * (1 - blend);
				data[i + 1] = data[i + 1] * (1 - blend);
				data[i + 2] = data[i + 2] * (1 - blend);
				//alpha channel unchanged
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-lightbulb-on mdi-24px",
	name: "dodge",
	size: 20,
	alpha: 0.5,
	order: 16,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//taper off strength from centre
				var t     = 1 - dist / radius;
				var blend = alpha * t * t;

				var i = (row * diameter + col) * 4;
				//dodge: push each channel toward 255
				data[i]     = data[i]     + (255 - data[i])     * blend;
				data[i + 1] = data[i + 1] + (255 - data[i + 1]) * blend;
				data[i + 2] = data[i + 2] + (255 - data[i + 2]) * blend;
				//alpha channel unchanged
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
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
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		context.globalAlpha = alpha;
		context.lineWidth = size;
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
			context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
		console.warn("drawing eraser with size " + size,event);
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
		self.brushColor={ r: raw[0], g: raw[1], b: raw[2]};

		var picker = self.$settingsToolbox.find('.color-picker.active-drawrpalette');
		var hex = rgb_to_hex(raw[0], raw[1], raw[2]);

		picker.drawrpalette("set",hex);

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
		var self = this;
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

		var fillR = self.brushColor.r;
		var fillG = self.brushColor.g;
		var fillB = self.brushColor.b;
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
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		context.globalAlpha = alpha;
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
			context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.lineWidth = size;
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;

		brush.currentSize = size;
		brush.currentAlpha = alpha;

		this.effectCallback = null;
		brush._positions = null;
		context.lineWidth = size;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";

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
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha=alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;

		context.globalAlpha=alpha;
    	context.fillStyle = 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')';
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
	size: 5,
	alpha: 0.8,
	order: 1,
	brush_fade_in: 20,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	activate: function(brush,context){
		var self = this;
		brush.brushImage = new Image();
	    brush.brushImage.crossOrigin = "Anonymous";
		brush.brushImage.onload = function(){
			//create offscceen buffer.
			var buffer = document.createElement('canvas');
			var bctx = buffer.getContext("2d");
			buffer.width = brush.brushImage.width;
			buffer.height = brush.brushImage.height;
			//fill buffer with color
			bctx.fillStyle = "rgb(" + self.brushColor.r + "," + self.brushColor.g + "," + self.brushColor.b + ")";
            bctx.fillRect(0,0,buffer.width,buffer.height);
            bctx.globalCompositeOperation = "destination-atop";
            bctx.drawImage(brush.brushImage,0,0);
            brush.brushImage = buffer;
		};
		var pencilImg="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACACAYAAADkkOAjAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAAB3RJTUUH4wUcCQUBi4pbhwAAIABJREFUeNrtnVl3HEdyhW9lrd0NihrZHh/7//8jP/nNy3gbaySRALprLz8o0/zydoEiqY3SVJ6DQwLoblRVRkbcuHEzUjrGMY5xjGMc4xjHOMYxjnGMYxzjGMc4xjGOcYxjHOMYxzjGMY5xjGMc41ccRfw6xjEOY0qjPObyVzekcDyGYxyGdIzPYoTfouUf4+d/rqWkRdL2e7/RY3yctyglVfErSFoltZLqaCwzfjdJGuP/l/gZk6TbYUB/HYbSRmNIGVSFkFNH4+ni98lw1mgkXTSaAsazxe9v8fWrpD5+HQb0G19Uyaskb1LGrwR2t/j7LX7xNRMMZI3vqeGhVnioEaFtg5f6FoZ2GNBvwMMESSeEpAADqeEt0s/KONFN/P8KAwkwtAnGtsTf0/hC9D4bDG+MP5skvT0M6PMdVTSaStIlTm56JqV5jQ2/W/HcSrw+eRS+f8GX4I2S12E4Sx7rGaHxOYa07TCgX3+UCDWX+P8CWGWFN6njVw8j2cygkiEE/F7wUCmcBTzrZDQVXk8DG+LvbvBM12iYn+1D/b0bTBMnpYmT+RW8RAnDSJPawEMEeJwNAHoBsC4RChsLjU18f4VUPl3LbMZZ27WfcF3j5+qFfs8eiF7hJOks6QGYJxlBsMksoidoDOA2wDXJ+NJrmvg1ARt1MQStMNQNHipED1cZFpvi1wIvdIufe/3csrTqd2xA5+ghOmRVNYBtC6+SwswKIE3v1MBrtfEz0rN7iO8b499K3uSGFF+WwrfRSP8Qfz8CPFfx39oAdwGc1h8e6Ke/jxAnsI0eZ8NkneOEkbeZ4/cjcE8Bj8KwljxSbXipin/zFn82gwtakH2VcdJTSN3gXQSe6BG4SvBIN9znU0zz5wMD/XSe5g9xEh6iwQR4ndHIQHrfLQLqwsJaMqBLnKhT/Eppdo2wV4JELOJ7W1xHHa9xglFsCJkNvEuJENnC+83xNdPnhot+qwZ0isbyGvxNClUFMqWz8tJCeq+n6hM8WICX2JAlzfBuZ4SSFvjlYt4sAfAZz/ocfzbC85wQptL1Psf/p9CWPB8JxvFzcP2/Nd6mw6oNMIwGILgDXjjFiV6RJVXRaHq8tjHPUAKPBIDtVyAFr5K+QMi5IQy28CYzvOAEIpL4aIaHTGHsEV4xcUJL/Iz0998eHujl0cRV/UX8twGGaQAyBe9zgmEt4HqmHaMrDRh34Io6hJ0LwPGA9wd7hjV+tsC71fBUMq8VYMQjfr/ZtQa9q8ctuLfrYUA5d5I4kK+iu68txW4Rflr8W8I7BGRSJ0zsA7DKYHjpgkkKyMJaPKstfsYATJRCF8Ey39cCbNMoNjDTNcJbMj6vwZ3iz3vL/LZfE1AXv/DfKsw7cNUmvFLYg0tGPoPYSxnRKbr5RvfSiuSdHuFRUkgbMcE9PNQZuGXAdcwgBDuA7GQso3IJR4NQtgBbMdyOwFAVsq1aeVF2AcBP2O4x/vtNfN1/f84e6KcSgAfl5YKTpC/j6r1ghTmDu8DL3OIkn+JrbjC0MyaoQgb0gAnqYhrcIiVP1/UaBjsjtAhZ0AzD4b3MAMMJPH8JQ2rwugqgvAKQXmFMpfLibfLEFQy8wjO4/lqYtvzAid8+0tD8RuoYXrr47wXsbW0eozH33mLyGjzkG8IIccLNMBTT5VL3FfYpXk8Vvc6MELRaCOxASDbIAJP35DXezMAK3AvphRWLpACNsOL1BTDPFq+jByYMdm/rL5Xif4jFVj8QY2k0XB01bsgnusIE83NIsrVG+QcrBdSYZFkm1iIEnTFJKfz18ecjwtEKBrlQrt1pMIE1ro/G3gPjBEzqiswryTZmfF5AOHV5x2Jhf0OKn57LJOlN/NmCe2U5ZEFI/FVA9J4XYgmgg0tPeOOEFVrYgw3G+vL3afLdlde43gvwQR3/3nmHCGRIHPSuwn4GwE2GW2HCTng+DzC8E/5dDKMVMOjKPFyA0XOx0cOswFoLyMlqx5sWVuao4L1reMwWX/Sk8y9pQJvywqS/t4GBnXHBlH/WlnmQX0mreTE+hisyPcRhJ3wUZoAFSDb+jAbK7GewOle61hPCUmsEZYChjMBJC+5LRhesoBJ6eDcmB8RbC54hJSepTkYjC9qXpBSgJjoYLfmmX8QDbRbuKrNyMsHlDhCuzA2715mNxCsMU63wLM0L4W0x6p/pccD7K+XyigvAcoHPZail90iGLHjFTbnCsMfkzzuhKw0SjVsMQ0KmtyDkLsA3PQx3gXcaEeZeWSKQOLWzZayzwYCflQcqYPEVCK9U7wkIYwFGU+MBF+BnVlxHgwfi9SgWS2cYVoUQ5OHljOtojYAsle+Y2PAzehJ6TuF6GxjFAG8nPBsPSQGL4gn3wr/Z4XoXcEdURG7KZbIUrpHH2hB+WcpJC7iDxx0/1RuVH2k8wkQFm+hCubyTGUIARqjwQEvcFF14id/VWC0bvi+QNne61/a4gVMET1nqhmsWDD2t9kH5tp3Sws4GQ5ngDRf83DVHJUBuD+wyG3Za4fEIotNzusT3f7sTokqQjRU8WmX4MhGwGzzrz2JAnYUsknek6mt89oIJknJZQ6lcoFVhFcyWBa14mIuRdC2M4wGp9GoeZoXhEXMlD8LPXJXvEu2thJGkFxMmKXmhUe+EZAVqWKeYLY0wmEG54P6CRTfEjNC3A4X4mYl2SP9/QAhfLAtsbcEu+J3g3euPLY18TBZ2QdWYmdVqHoopLOtUq3IZ6ASg92X8/sEMcjUuqTRyrrVssFEuTWWhsoMXuOKB0WCKWJwcYAA9ruMRRdg0od8CzA7wHq1V4Z8Ruul5eiQfqbzyCG/TwkAEQrQETcEQ1YO6aICBSnjFGfd4hudM3vz5pzSgEvimsiJkaS6zw6oPmGjinA0cSol0v9sxnlfwVKxtXSz9pnjMU2EfY5ygZ5Qh0qqe4UFHCxezeczNuK9nhK8NXkfwlAU84RncTYPXJIx3wTNaYPh/tHmokFXeEAWovfZnyagi4LUSC73/KQ2oBWKv4G06S8/p7oltajzcZCAdfr8iHnvYe4WHcjHP1yjfOtOjzhZ0r0UubFFMlhrP8CIdFoLjttlwX4trTcb/ANIvTeRr5UL8xlJ9r7yT1ymjKkF4puUO9gvwPHzuBbywDPPJiMu/ROOffqwBFbiYxlhn18+QPGvhVQq8n6WBEq7Yb6gzr8d0f1K+oe+NAdwa70mF0xmecEZouuH/s3nADga9WiZZwujStVxgkA2u4wF1sg739mBJCVUFLUL0CYZx2klqNnjIzgjXwkJhYQupQfjmnv2E636wJPI+A6pBptFIqh1+hauxQbV5Af6pLW1PK3+ECx7gpTZkIEn3stl1Jxw1YbWl3QsNMhCusCe8ZwFeOmEyxmhcCcs8ASdM0asUJikpgOFk6XofvdNk7PViFIaAhyrl+9EKePYK97wi5K1IDE5WfCUfVSvfhsRKQhpvIV35JANilrVZiknZJ/ddrbhIlipSeDjD8CjlKABEk0i9Q4Y0IkOpkL4mwLrtlD5GZE4EkgPKHsQzZJCTpwwonTQxhIzwUBeE4hvw3RlZYWms/NlY4LPyvWkMqZWViGoL0RPCMSHGySoIszH96W+clOvEFyx64dl/cgijWi+A8/HSA8VXNWQKpQG+AQ+FhF6PWN9i1Z6tnJBwQIvVfsKKlXJV3yNwVo8w/B2uN2WBSYH4hXEkvK4JWKyCF5N569W8c4VnRuVBazWteqeQnZ771aiIzRh01ifZPWQxwL1i4dWGHblnbY3PaflUA1p3QhclpLXy3ZMXXFxQLnDvMFkn5Yo9PqgBXox7sb6AHIREHMVnzOpKywJJAVzx+7TiHvD3H+P3lx22lwsiKG/b0lgSsOF9xFczpCjkv1rzeIVyeazv5GAJaEH5ZEZGu1qiUuJ6BeOsUBbyJOb5x3igdYdAZNrd7EhCWiu+no3i74Hw06QlNd7fKN+uUiI8XhCmRjPWTvc7F94g5a+x2jdghALufwN+o3B+xTVMytWF6X5K5VuYB+OiWtMCdRa6K8vEWOxdjBSdlO/UoFcplAvWBCMieHb90VsYEmmaHp7vk9P4DtnGg77fg1XiQbW63/Odqr8PO7Ug7mkKVgp5ihPaQRJyMT5mNa/SmljL5agsVgZgFCoRJ2Rie7KJxbLFwkLCAqxBvLJaFrmaF1+R9jfwFoQILChTWzSZNKOGcbCQuyLjXXW/K3d7QWnQg9YYP9WAasMIr62g51VuyjYJ2BqATcbYyURo1LQ0O26+2JlIF6xfECqbaCwXY1onS/mZjZBBHi3VFTLFgEkqYHSL1fZcU9UYRqLnkPKGDsGIP7aRcbmMz1kJimKxDNh3s8y4j2BMdcpIPzmEldD6PGOFlhZiCnObzq6+ReXXZQRJytBhtb/Ga57NFde2ouadkFAaeF6sSDorl4sGK67ONoGbZZXpXrgIXFjnXUAa7Xf7SF+jpdwlMijWCiv83dXwUm2FbRkhuoGGaKLXvyFEL3onxx3ivH2yByqwigvUw1blTQBWq4I3MKYZwLDc8TSTgTqhvjOansW1wa4JFiZuQnZUYHUyAwo2ObWB8gITyVpaErPXhvuYJQWQlQk7JW5sVC6bpSeZTYUw2z1tyGZldUl6wbRAbvCIm5V0Fiw2GdEaYGhPPyaEpZ2XX0VwySJjhYIg3fRicZWV6g0X+Wyk2AxtUWGps6xuQ03QaAXRHgCXnoMeqNvJftJuz9bKK4WJtQRDWAyf3GAQEwzihol7Nu/mkuFSuTyWvFppryOtMqEOl+6FC4Pz0phMhAmA4nsTafrJIWyLBvTlTvlfmKzJajkyacdiakDyIYXVmRIj3ZnSTjGzaiAWo7H2RsIVWHklQsNV+RadhGmu4JueIcNgu7pEkk5Wk0t44a0xvrdICwTcg2O6mwnwahhngCcdTKDHPouL8uYM3l+IicwA4yqAf1i2WfD74X2p/IdkYVNMr1+ZxkTmhTYjuCiTOO94CgLNFav5O1SrzwghNITBJmHcwT+j8iYHwSZhQm0tebl0P98BeHsqPOFfetwnwzMBWK3bYYWDCfCChRNmRZul+IWFnNU0T4IBeWGbja02K+oGyzoT9nz8MQa0Gb/A9JG7C2SGwXYpZENnrGBmbBfLwDas2md7YJOJvAaIvFYzcArYk6d6wiQPuNbGUm5KRibLjFIy8GzE6Amel5irMr6oQb2KTbBWJCsrvgIw0YgFuRfe3fskA7vqvk2MUwS18uaf1x9rQLL6SUAGQN0z01nup5JNSmJ/v1C+wa81zQ+1PvQ4286keLh6wnUWxkxXO4K3wsjOylY3V3QNAx7BVzVmOB2KsS68r1FTW2G4o7HGe93TZhSKa4TlGTgtedeLscylAXJCkgWvTR79Ud9vnx7el2X90KgjBqpN+dcZB8OUcURKG0wXVFsM/yaGKqb9qaBKIZcbTfVCmaDBaqLcdTPBV2vufTNOZt1JqcmBrTs/p/ZmRkG4tBW/4PqDaYoW85jSfY+A2fgaGsEjMsUxGvezZVwrMqsJ99thjv83Ys5/eR8T/SE9ElcLC7Vhgm0nXCX5RdD95rvVeIUzUu0ND1amTuRWopRhBeCLM0ApmVmuXBkHFfD5KbR9ifezkWYKpSfc5wADEhQHM97HRVNgwhqr91GU73vciBWHHSwmGMxm9/fGgPczFqmsbrkYe73pB7b8lB/gmTa461G5rreGS+YOSxbkKuACMrWjhQnqVIJV+aW8YdNqxJrMSLiF+mrEH3XcDGHcJctyS7UD+r0RVWPSFDL0DQRi1BDNVkaY4Xlkaf4Ej+ziOtIaMyACt/jU+HyPDIVltLdoZEn6+/QxBuRNs2XKttW0MpXut7QE5aLvk1l4bZV5dt6oMNG+k3U14nFRvrOBxcIWzGpt9SiZVHNR3lmDu01XU+nVRt6xUees+0NYKvPk9ML82bTDN01IBBbQJT34rQnFVR7ewmSgNbb8plwzTnw6w7PdJP3rp0haw04q6pvSZKzyoryxJLOGzuQQwVZF+tyLZS00tMVSzlX3e8QX8wizhY/ZMI5rpIPupbaVAc92pwTRwWC9PTD1OYvutyY5ibgaR5ZgwaOpCUqAZKbfJ6tNbmboszmIsIOlEt920we0z6t2UvbFuIcaE5Q0vierwbB6vFnMHwy/8NyIs4nR9vaVB/yuxsPfa13XGDPMifHjCKoXalE0pMI+YwPz3hiL7U2gZsNhlRnUpLxV3Wa6IhKciqFkQwgqlLcu3qyATQPkhgbyeyk0BpQuEv75oKZV5Qsp+6a8bS2JvcJwCmN7obwZErtq1CaR7Yye547TakfDMoAg5NZorlaCRYbfRxPCUf87GnAlmUe+xDFDYd8vlm06PVAo379ewgAK5R3pF4STRffnkaX7F7gn0g+NKQ82eGVuI/KqfKrxPen7nRmfZEDcRnKxlF2mTmQq32BVLFD+1aYO3MBLjHDDg9XPCu0fZMLYPSnfIkMNMetviQ3f20JUmiGUOx56MS/Ec8DIog+67+fD8LtYPWwxMJxoiSfTJpUvJBcBvFdnpSMK7lvlvQAKeO4Ni3KLYetf9IENF0rzPBU4nNJUdDIvESyue51LULPNkr6GO54NL7Awyr3ktaXfKx7mZqRYib+ZPFYNJjoob11XWniT8pZ3ywuSi2B8EonB0rKhcgceXC2EPMfSCVP02gA7yUaXDlMwtijv6RjsWcl4o2mHjf5a3++21acY0Cu96/be6V5ozV2QlYFsgsHe+IrV4j0LoK47CtrverZZalrsgNsS2Vdr5OMGZvaGSZ11r5GeDdRWSLsHLBxuE07G9h2UBgKu+As8T2+UwAmGMyrXMz9byJptAc87XBSbcpH7cryVDIobHAfonLaPMaBVuSB9M0+UsqIT4rHXjrhvO6XpIy78Al6Brru2SZVJLzewpDNC7GxekO1XSlMRJpwwgIagGnKAgXo7lcV4Ju6BY0joTcX3Z+UtAh9xP88gQ8/Ku+QXUFZ2AO5sU7OnhCyBVze8jhX6sFO8neyzqZH6ICIxmG5GWBWvlHcQlVW9a90fYTTZCiCH01nW5avBG2byCIPRaluLGbCLyqR84x67fG0A5lK+MbGyZ7MaTrgBO9wg/0ig+xu7NzZdmJTvOfvS6l6cTCdHJ5RgKKLrdrLL0bwni6Tc9k1VAQ+3a/Dl3NkdSGwwoQseZAoHjdW3/LA2gsYW/z7t4Aie0DchtFyRHXyHB5iMuDdQm3DPTfei8dnkn4Vpj4gT/PyJAgA3Aeab3jX4nqAyJPBmV/vkIc9m3IvV0Tpof1oQhKlrBueoNa/BjI/eZzV2XYaHSH62BvSTEaco8wApTrlXlWeP5QautFXemm5SrrPl79Lrr6bdWa0S3SnfbrwgJL5FWj/DqIOxzatladz73duDZVOlwgqdUr77Id3ft/FarpFMWyw0XZVvGEjX8Mr4sMbUBZOB/WRgr3Tf1bXV/Q6LYPW3oPtjMyl6e7YCdADfIwPgK4z4BvzD5l2VSWEzA6qVn3jTmCssle9u4ORyhXH3piwTKKGvZfrIhpeKnueMuN3CoFLLtzcAp4ni/zo+2B4Tv9qKTg9/Rhi7AojejFe66X6XCHdONMZW91Giclbe+HwzQzvbovEsq7KqAEVinfJm5sEyNdd+T1Y/K3eiQXpOSffTwKMNeHYFvOQiwwfdjhBqVt7VtAJGSYB7MpA8GFVfmmiLxdIUDp6Ut9WdEbPTe9PNDbjZJ6PdkyqQ2GozeagMHHLvE8VWTBroWUiesg/PCTwTF9Rq4LiHV3lt5aLKirsBRlxBgcCWNp2VjYJxVIk8POGeJ5ujZGS9ZdqF1Qi54zgttrvwwsNMSoS2YJX2woqpFH1ddmpS3B9eIsVlZ6/RQgxVjEtcvfNOGipMOIF/aSuZK/OqXLjeIIV+ZfpiGX2xd1xmYbIMqjAHKBoKY8OTF2wtCVhs0bKf9Q0LjTTHqFwjHkw9WZrRVHHBDcpPbQymWKAmu7CibbZfKe0krQGeZZLOtFO0NKbzbFxGZ1xOYfqaUnl/w3PMRrjaOqzM0koEHdz/GX/HRVozDGzGahuNguCCmXW/GaC0zGUGBhmtqr/AoLlj9ww+h4Xd1gzT02wy4KMVd4udMFfsFI9n5VuxKyzYYJgutT6+Kd/23ZtRPsrSwAsumi1bqJWpjB9KWmZmVRek8J2B405514oalexe+f53tqElB8WD31qrB1GDw+MWuN2XQHww8RnltY/KG6IvEGQ1FjZak8jymIfV+C3vj31S3sp32fGwvfK9aq7ZKk3X45r0akccxmfAMlCS1pxMQsz9dYmOmEu46M7cXDA+heGK6T3dPTW1V0xGsFoONxeWJh8l95D+pp8lQX0zt0XfdH+Q24jsz7PIygynMob5BKMflIv/A35e4t4rU28uxojTG1MWy90uJws7tRnaioUXLFy6ntvLOKwq1MgYpbxRRW1q0kr5ludJ0liadJTNDlblrc7YE5o0Pd1kiXT+bMAtdfAKZpTBcASLrZulmgVc6d72mMpWPvsKUa/zDCz0Ba6dgn3X1HBve7A6WqX8PHlvTN7pvg90bSGJpZ7R5MKVkabFTilmj2AtLWMrrdyTXv+tyTt4GlCBgu2E6/pW0sJKdmcCpdJWDgk3hjj2wVl03wOxsmwuGLjeTFIxIFsp7Wuxoq/vtmRXWE919zIZykt5gvKjJQ+l1fxI1J2NS3KeiB3KGgv36T5Sg61vTXDHE5opJ9nM+8+6PxZCFtYKK/04PhqVb1YgTvIjq/5/sdA9nQ08MiNK2OOKhzMpb+BY28Om3qdTvi3HVXmy7CtlXQuMe7XYfVJ+WC13YLAFsQCmR8NClRUSufeNh5XwlGWeYfEARvdk8gtZBhdQ9qB+imHlwZ4DvVptBWvKXrkTd1K+XWqxco171AHPiElBawYWwKUlT/WWtaPXWLEXc/1B97smuh1gfdoh3U6GNYLpUCqrpqeG4zJl4Gj0e2PUQ7AC42bYRFZyYeFyNXa3AogfjIroTBUoU2ayZV2wmmOl/LRE2fV5q5bSGP3FPteFa4VpoEurAVIWM8AjPRreLQBRUiVgUL57RZJu5B16S5tH8w6rFdk6IyNH5VucXU7Z46Ir06K4hLVQvjeKq0YGXunRAjxTgAtmQbDYEb8Xpi+SabEZltxbsZ7U674RabDPcI5mslrXagoE0hij8v7am+77CVEewuOxahC/q83TYpUCf06DyXL+nDyTt/WYrdwguHA2b2qVHwkp3R/rRNnko3kNanSnHT1QZdqW3qralFBw5TGr8Ydd6r4VymxYg3poWQhlIbnYuWYX5weQiPNOUZmhtjLtTbGjV18ta13NWKjJmpQfdLfpvlkmMS01ULMpQ7kVfbA5WV3SOoMwZBrKE3pOeJhn4xacWpfJRSdUeusdHFIBvF1NmVdZSAsm9ZywikfogRM1MFgsp6qwNC7GMdS6E15kCyZYRkZs4v1/XHZCo9p0v/2JCQcbTtUGugvdn726mJflAqGxufhv3amlTVAtri9polfEvE7vdmo2yndSyCrlMvQ/KW9/4hdemxhqMpxEPdFsALIyYZl0f7JisSM3CTviMOpnvI3uovt9YrPhqd683rIj1CvNiGgMwZSPtRF2DmD9BMbhBd14MBUDD7TrTYF5suI3yc8ezyYt7Ov7RPWsfP/BMgM/jrLaETWtRjoSePaW+veQtXZW2d4MRG7KT+Crle9BK81Ne2eK0rxjYxMlwynEPJNpc1xv5H0Lpf1+ScRVJP8GKAD86Evp/jBfNsJs35MY+Dkhfi7bhOL0KxSVe3z+s5WB/vySpFV2s9z10EHKwSYL1KIU9jPfD9/bDVGQ1e783M+ZD8b5JOa5MNCnHabZW8n4lhmG8E73Jw7KeBiGA3oZbxe3l0wsWM2TVdHZaq/C4tqUn8c66X6j42pZpme9flgMcWGqD6Z+if8l6U9RXtMrP7es58J4yYB4gO4UPdFr44f2Dh8p7Xcuga1MwVeBY6I+mligU77hcA9gsruETEe02Re7gMiAdDC+qla+4yMgrJzA2pKRZsOnylSBs8GE1QB5s6NEYDIwmlyEnqfV/TanzTAX+zKthntGfS/8/2cz3BUljNlKJ+9trnACb0HugscCFdCSpD90weRPO7hhxSRz/1ZhD9z7/lBqIqvpsH1/p/vmStTcbMpPKLwY41waBVBYer0o38s/wbhTSPFOtKVlNXvtZDixi/Exk4FsSmsmA//sFbDovmflajTHcwxL/x61Ve87J+xOZP+SASVZhzeBYsV5xA1MSOl75V2ySniGySaDu1AnPMjBPNhmJY2wQwqmz7saWcndGZsJ1xrcC0H6pHy7jzfAHJD18fjuxbzEgMUzKN/XXhrTuyjvw1ibhGJQvvcsdTLjfKzmvV0/VVqNU/p+A8A/fYDx7I49AzpFQFVBD8I6Sm/gTkasLWCFvRczkX5hJCAJK04IuZLRPBW9HFu+kVxjHY39lZkJ+eG5hWllNisV8DiB2bzQjIxps4K0n10xwyhkqkWWP4gBZxOaDaYHEj7XewytJvGl1PeqD9gH9iEGdAYHIeWdN2SFULY2oQyhslR/Bu5Zkf6XO8q+UfddMSqbyHqHoidolQnKR8tsqMq72WsCNDLOobCVDTt7pUZOzU7WI/ydDVjtGdc3m/SXQHlV3r6X23t6WySkRNhwKhgApmdNxvcXzOMnG1CqibG9CXspl7pvNHA2+cRiOGmxDMmxxmY4oYLHIFk4K9/WQ4BXG7j2rUe+hWbF6t1ewIDezm5QvplxMbWeZ0I8zfkGr1GaBycgXo0TWs1I0muuylvWXZVvPhhMhTAp75zCumMPeevzjzWgVBGmy/dTerj9JD2Uxfih2tjmwkA0i4LMsAarUlOk9WzKwX6HJ1lMcuqYRMbALqbWW5X3JCrgmXp4K3ZBlUkuAv5uiesOpiUqTJw3WzLArhpJj1Oi8l9Qdp53AAAF/0lEQVSbCC9AMdHsFHRn46EK8GFPEbZ8pw84J/V9BsQOD1+g9MAQ5uljbRNDOn+0tM/rNesOKTjD5XfKT9+RVaInZFXeDmbcWW3euIEhjyv4GYQmNTnfmIGlzx2UH/00K9djk4WedtLqyqr4lT0PPweDSgOGVVkhurdnUBhH5luenxBqP8mAWuV73tl3ZlN+bLe3kb2a9rhVfjLNYuA54LO8qk7v5ZiA4HyEkZL3GXXfL9GP4ZQBe25xcUlv2on6ZPIWZqMjVIaN8qbsvk99ttQ6TV4yiJsRq+RiWNm/6b4/dvKMb5TvDqac442k/4kCtv+M36cFcvsYD1TtxH7KHJIH4tGXDSaGzQJqW00rKIHBABo11Zvuewq2JlmYDDOwOdNkr2eXsdmkpRMMkEXJm/KjvicDnCXkuNedAipPLkw80En5gXUMHUP08De92wHh3ew3eyZ+PHdjOLFR3qOIJ1E/6d3Zbanx6J8k/Zs+sA/QhxoQRd2KN3cGUDvZCmdGNKG4yTYvlElMyo+tlJVBErE3KG8CxaYNJxhZUi7KAHdpeIXliBMMZi/bSXwW+SRuETobfzMr72yyKD88Tna/pdXwth0juVj2OShvnkkNdm+qg7d612GM28i/0vdHVvTR0zz9WOOR7huNN5L+QdLfmkyVN9dglXn666IvNib3w1Gk+2MaSXQ9Kj+NeDNl4GTk4qT7Vv8n4CQ2OucxjiQaV91rqWUE3qb7hp3UZPvuDgr0GoBq1qS4G7QxOMBwRxyXQibD2Jv4tb5nvjf9hGOvU/0/RgO6WCX9LVwwTwu+WpWbR1FSHsBD6Cj3qK2CzzS9U97u1vslVjtYYzWqP1iYJfc02XtTn+STEXCF7sXq5LPS370YMXmyMDpZtueTOplMhNkgWfPkdb6OnuT6UxvGp4YwCrdWuMhB+YEiBUAchUyrZTdeISeLe0L2tBomKVDTmpV3MmtMc9Sa0dU7HoE7bZO7Zxc2mWfxY85H5ccpdHYvhWWnPJbA283wuifzsKuF4+QdnwFyU/PvQZ/BeMmAknt8o7zb/A0rlqlqg8whWK2K1eQWmqAJ2KaFV1kRgq42wdxbRXKOe/Nn5Wd8eajolJ/6fLMCcGqUQJnng/LmCrOx0MweSRuUVqhlOBrwrG/ATgO8Tx+5mUeKuD6nsWdAg/Iu7x1wjvc2diBaY4V3Vu5YdjiZzepI7E3zrVW76x1s0inff94r76ZBNpptfcmzdFbFX4wtXw3TrTvcFKkJUguT8vZ5Cdsl7/EE7iUZalIOTrrXMX92o3ihmPr3wD7SvWaYuzCc2fzKJAOzVYPp2oNVhtmGpDBgXYOLGu39jWVcBM+F8u72bkDOQG+m4SF9wKr+TfnxUClzZHOnVHzuEXpuhgN/06N44Wd/B+6jBCm4mbe5Ke8/WEv6oxF3lFB2JkoaEBKSUZ1htL3ylil+snJnrDhDU628P9FZ9ycg+wY8kn5kqEvzlNQ4sTvHNSYbN5QFBv2Ox0vnhQW9UyHWeNDJCFblZ3N1wDq1AcTSPAkVchv4JW4aZFNy9ulhxjaAU6qtrubCpwDPNCvfH1/aZ3N3Zq28uzy91iDpPyJOfLT62l/N+KED584xrWdFezWtSSK9HhAeZNV7niXmfYlZaQ+GcVw6MhtR+QBPd1IucHtlOGtUflDM3v5wnmExKVdhJoP8Ln7W28jm/lWPDzmxMHmjTvkWWylv+Uav0hoOYjXYD2NZlDdNYA/DB2QmLLFwU+Bif28x9nfa4aJWwyCL8UhvIohn08n+Y+tEhwHdjzbWcE7KZRO1cSaUL0j5joUEPjvzNuywnrzFeafuRCmq4KFqwzJ+BpZ7l+/i757Ns8yHWfx8BsT0/6S8JW1ppY+zYaZWuQTjbDU17idP+MlP39kstE0oDqbQlYqT6StVmgcrUh7jVzQgjtQ9q1Muhroge6Nwy5sXJOKQRySwCQDBN8/c6JVvwT0M43cwvDfOMQ4P9JN9PvHOtvP/4oWfH+MYxzjGMY5xjGMc4xjHOMYxjnGMYxzjGMc4xjGOcYy/2vF/tNdwrZT670MAAAAASUVORK5CYII=";
		brush.brushImage.src = pencilImg;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawRotatedImage: function (context, image, x, y, angle, size) {
		context.save();
		context.translate(x,y);
		var randomAngle = (Math.random()*360)+1;
		context.rotate(randomAngle * Math.PI / 180); 
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
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		context.globalAlpha = alpha;
		var calculated_size = parseInt(size);
		if(calculated_size<2) calculated_size = 2;
		brush.drawRotatedImage(context,brush.brushImage,x,y,0,calculated_size);
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
		self.$settingsToolbox = self.plugin.create_toolbox.call(self,"settings",{ left: $(self).parent().offset().left + $(self).parent().innerWidth() - 80, top: $(self).parent().offset().top },"Settings",80);

		if(self.settings.color_mode=="presets"){
			var colors = ["#FFFFFF","#0074D9","#2ECC40","#FFDC00","#FF4136","#111111"];
			$.each(colors,function(i,color){
				self.plugin.create_button.call(self,self.$settingsToolbox[0],"color",{"icon":""},{"background":color}).on("touchstart.drawr mousedown.drawr",function(){
					self.brushColor = self.plugin.hex_to_rgb(color);
					if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,context);
					self.plugin.is_dragging=false;
				});
			});
		}else {
			self.$settingsToolbox.append("<input type='text' class='color-picker'/>");
			self.$settingsToolbox.find('.color-picker').drawrpalette({ auto_apply: true }).on("choose.drawrpalette",function(event,hexcolor){
				self.brushColor = self.plugin.hex_to_rgb(hexcolor);
				if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,context);
			});
		}
		self.$alphaSlider = self.plugin.create_slider.call(self, self.$settingsToolbox,"alpha", 0,100,parseInt(100*self.settings.inital_brush_alpha)).on("input.drawr",function(){
			self.brushAlpha = parseFloat(this.value/100);
			if(typeof self.active_brush.alpha!=="undefined") self.active_brush.alpha = parseFloat(this.value/100);;
			self.plugin.is_dragging=false;
		});
		self.$sizeSlider = self.plugin.create_slider.call(self, self.$settingsToolbox,"size", 1,100,self.settings.inital_brush_size).on("input.drawr",function(){
			self.brushSize = this.value;
			if(typeof self.active_brush.size!=="undefined")  self.active_brush.size = this.value;
			self.plugin.is_dragging=false;
		});

		if(self.settings.enable_transparency){
			self.$paperColorDropdown = self.plugin.create_dropdown.call(self, self.$settingsToolbox, "Paper color", [
				{ value: "checkerboard", label: "Checkerboard" },
				{ value: "solid", label: "Solid color" }
			], "checkerboard");
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

			self.$settingsToolbox.append("<div class='paper-color-picker-wrap' style='padding:0 8px 4px;'><input type='text' value='#ffffff' class='paper-color-picker'/></div>");
			self.$paperColorPicker = self.$settingsToolbox.find('.paper-color-picker');
			self.$paperColorPicker.drawrpalette({ auto_apply: true }).on("choose.drawrpalette", function(event, hexcolor){
				self.paperColor = hexcolor;
				self.plugin.draw_checkerboard.call(self);
			});
			self.$paperColorPicker.parent().on("pointerdown touchstart mousedown", function(e){
				e.stopPropagation();
			});

			self.paperColorMode = "checkerboard";
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
			self.plugin.is_dragging = false;
		});

		self.$cbPressureSize = self.plugin.create_checkbox.call(self, self.$settingsToolbox, "Size", false);
		self.$cbPressureSize.on("change.drawr", function(){
			self.active_brush.pressure_affects_size = this.checked;
			self.plugin.is_dragging = false;
		});

	},
	//updates the UI of the settings dialog when the brush changes. settings specific function.
	update: function(){

		var self = this;

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

	},
	action: function(brush,context){
		var self = this;
		
		if(typeof this.$settingsToolbox!=="undefined"){
			brush.update.call(this,brush);
		}

		self.$settingsToolbox.toggle();

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
	}

});

jQuery.fn.drawr.register({
	icon: "mdi mdi-blur-off mdi-24px",
	name: "sharpen",
	size: 20,
	alpha: 0.8,
	order: 17,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var radius       = Math.max(2, Math.round(size / 2));
		var diameter     = radius * 2;
		var kernelRadius = Math.max(2, Math.round(radius / 4));

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		//work from a snapshot so we never sharpen already-sharpened pixels in this pass
		var src = new Uint8ClampedArray(data);

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//taper off strength from centre
				var t     = 1 - dist / radius;
				var blend = alpha * t * t;

				//box blur: average kernel-sized neighbourhood from the snapshot
				var sumR = 0, sumG = 0, sumB = 0, count = 0;
				for (var ky = -kernelRadius; ky <= kernelRadius; ky++) {
					for (var kx = -kernelRadius; kx <= kernelRadius; kx++) {
						var nr = row + ky;
						var nc = col + kx;
						if (nr < 0 || nr >= diameter || nc < 0 || nc >= diameter) continue;
						var ki = (nr * diameter + nc) * 4;
						sumR += src[ki];
						sumG += src[ki + 1];
						sumB += src[ki + 2];
						count++;
					}
				}

				var i = (row * diameter + col) * 4;
				var blurR = sumR / count;
				var blurG = sumG / count;
				var blurB = sumB / count;

				//unsharp mask: push pixel away from the blurred average
				data[i]     = src[i]     + (src[i]     - blurR) * blend;
				data[i + 1] = src[i + 1] + (src[i + 1] - blurG) * blend;
				data[i + 2] = src[i + 2] + (src[i + 2] - blurB) * blend;
				//alpha channel unchanged
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-cursor-pointer mdi-24px",
	name: "smudge",
	size: 20,
	alpha: 1,
	order: 13,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {
		brush._smudge = null;
	},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;
		var imageData = context.getImageData(
			Math.round(x) - radius,
			Math.round(y) - radius,
			diameter, diameter
		);
		brush._smudge = {
			buf:      new Float32Array(imageData.data),
			radius:   radius,
			diameter: diameter,
			strength: alpha
		};
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var s = brush._smudge;
		if (!s) return;

		var radius   = s.radius;
		var diameter = s.diameter;
		var buf      = s.buf;
		var strength = s.strength;

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//full strength at centre, zero at edge
				var t     = 1 - dist / radius;
				var blend = strength * t * t;

				var i = (row * diameter + col) * 4;

				//save original canvas pixel before we overwrite it
				var origR = data[i];
				var origG = data[i + 1];
				var origB = data[i + 2];
				var origA = data[i + 3];

				//push smudge pixel (including alpha) onto canvas
				data[i]     = origR + (buf[i]     - origR) * blend;
				data[i + 1] = origG + (buf[i + 1] - origG) * blend;
				data[i + 2] = origB + (buf[i + 2] - origB) * blend;
				data[i + 3] = origA + (buf[i + 3] - origA) * blend;

				//gradually pick up the original canvas pixel into the buffer so the smear trail slowly transitions to the underlying colour
				var pickup  = 0.18 * t;
				buf[i]     += (origR - buf[i])     * pickup;
				buf[i + 1] += (origG - buf[i + 1]) * pickup;
				buf[i + 2] += (origB - buf[i + 2]) * pickup;
				buf[i + 3] += (origA - buf[i + 3]) * pickup;
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		brush._smudge = null;
		return true;
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
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.lineWidth = size;
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
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
	activate: function(brush,context){
		
	},
	deactivate: function(brush,context){
		if(typeof brush.$floatyBox!=="undefined"){
			brush.$floatyBox.remove();
			delete brush.$floatyBox;
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
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
		context.globalAlpha=alpha
		if(typeof brush.$floatyBox=="undefined"){
			var fontSizeForDisplay= parseInt(20 * self.zoomFactor);
			brush.$floatyBox = $('<div style="z-index:6;position:absolute;width:100px;height:20px;"><input style="background:transparent;border:0px;padding:0px;font-size:' + fontSizeForDisplay + 'px;font-family:sans-serif;" type="text" value=""><button class="ok"><i class="mdi mdi-check"></i></button><button class="cancel"><i class="mdi mdi-close"></i></button></div>');
			$(brush.$floatyBox).insertAfter($(this).parent());
			var vp = brush.canvasToViewport.call(self, x, y);
			brush.$floatyBox.css({
				left: $(this).parent().offset().left + vp.x,
				top: $(this).parent().offset().top + vp.y,
			});
			brush.$floatyBox.find("input").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.$floatyBox.find("input").focus();
			});
			brush.$floatyBox.find("input").focus();
			event.preventDefault();
			event.stopPropagation();
			brush.$floatyBox.find(".ok").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.applyText.call(self,context,brush,brush.currentPosition.x,brush.currentPosition.y,brush.$floatyBox.find("input").val());
				brush.$floatyBox.remove();
				delete brush.$floatyBox;
			});
			brush.$floatyBox.find(".cancel").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.$floatyBox.remove();
				delete brush.$floatyBox;
			});
		} else {
			var vp = brush.canvasToViewport.call(self, x, y);
			brush.$floatyBox.css({
				left: $(this).parent().offset().left + vp.x,
				top: $(this).parent().offset().top + vp.y,
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
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
		if(typeof brush.$floatyBox!=="undefined"){
			var vp = brush.canvasToViewport.call(this, x, y);
			brush.$floatyBox.css({
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

		self.$zoomToolbox = self.plugin.create_toolbox.call(self,"zoom",{ left: $(self).parent().offset().left + $(self).parent().innerWidth() - 80, top: $(self).parent().offset().top },"Zoom",80);
		self.plugin.create_slider.call(self, self.$zoomToolbox,"zoom", 0,400,100).on("input.drawr",function(){
			var cleaned = Math.ceil(this.value/10)*10;
			$(this).next().text(cleaned);
			self.plugin.apply_zoom.call(self,cleaned/100);
		});

	},
	action: function(brush,context){
		var self = this;
		self.$zoomToolbox.toggle();
	},
	cleanup: function(){
		var self = this;
		self.$zoomToolbox.remove();
		delete self.$zoomToolbox;
	}

});

  return $;
}));