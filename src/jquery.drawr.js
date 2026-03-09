/*!
 * jquery-drawr
 * Copyright (c) 2019–present Lieuwe Prins
 * Released under the MIT License
 */

(function( $ ) {
 
	$.fn.drawr = function( action, param, param2 ) {
		var plugin = this;
		plugin.distance_between = function(p1, p2) {
		  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
		};
		plugin.angle_between = function(p1, p2) {
		  return Math.atan2( p2.x - p1.x, p2.y - p1.y );
		};
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
				"type" : event.type,
				"touchtype" : (event.type=="touchmove" || event.type=="touchstart" || event.type=="touchend") && typeof event.originalEvent.touches[0].touchType!=="undefined" ? event.originalEvent.touches[0].touchType : "direct"
			};
			plugin.eventArr.push(fakeevent);
			if(plugin.eventArr.length>25){
				plugin.eventArr.shift();
			}
		};

		plugin.debug = function(text){
			if($("#debug-output").length>0){
				$("#debug-output").append(text + "<br/>");
			}
		};

		//checks if a drawing event should be ignored.
		//rule: if the majority of the last 25 events is stylus, ignore touch. 
		//if true, it should be ignored
		plugin.check_ignore = function(event){
			var other = 0;
			var stylus = 0;
			$.each(plugin.eventArr,function(i,ev){
				if((ev.type=="touchmove" || ev.type=="touchstart") && ev.touchtype=="stylus"){
					stylus++;
				} else {
					other++;
				}
			});
			//$("#debug").val($("#debug").val()+"\n" + JSON.stringify({"other":other,"stylus":stylus}));
			//$("#debug").val($("#debug").val()+"\n" + JSON.stringify({"test":event.type,"test2":event.originalEvent.touches[0].touchType}));
			//$("#debug")[0].scrollTop = $("#debug")[0].scrollHeight;
			if(stylus>other){
				if((event.type=="touchmove" || event.type=="touchstart") && typeof event.originalEvent.touches[0].touchType!=="undefined" && event.originalEvent.touches[0].touchType=="stylus"){
					return false;
				} else {
					return true;
				}
			}
			return false;
		};
		//Function to get x/y/pressure data from mouse/touch/pointer events
		//It can get it relative to body, or another component
		plugin.get_mouse_data = function (event,relativeTo,scrollEl) {
			
			if(event.type!=="touchend") plugin.record_event(event);

			if(typeof relativeTo!=="undefined" && relativeTo!==null){
				var borderTop = parseInt(window.getComputedStyle(relativeTo, null).getPropertyValue("border-top-width"));
				var borderLeft = parseInt(window.getComputedStyle(relativeTo, null).getPropertyValue("border-left-width"));
				var translate_x = typeof scrollEl!=="undefined" ? scrollEl.scrollX : 0;
				var translate_y = typeof scrollEl!=="undefined" ? scrollEl.scrollY : 0;

				var box = relativeTo.getBoundingClientRect();
				box.x += $(document).scrollLeft();
				box.y += $(document).scrollTop();
				bounding_box = {
					left: box.x - translate_x + borderLeft,
					top: box.y - translate_y + borderTop 
				};

			} else {
				var bounding_box = {
					left: 0,
					top: 0 
				};			
			}
			var x, y, pressure;
			if(event.type=="touchmove" || event.type=="touchstart"){
				pressure = typeof event.originalEvent.touches[0].force!=="undefined" ? event.originalEvent.touches[0].force : 1;
				if(typeof event.originalEvent.touches[0].touchType!=="undefined" && event.originalEvent.touches[0].touchType=="stylus"){
					this.pen_pressure=true;
				} else {
					//TODO: add support for 3D touch of apple and other devices (oddly enough, the fairphone 3 seems to support this)
					if(typeof event.originalEvent.touches[0].force!=="undefined" && pressure > 0){
						this.pen_pressure=false;//this works, but at least on fairphone, the values are too low. testing needed on iOS devices. [edit] yeeeah this breaks touch on iphone and it's for 3d touch, not touch pressure.
					} else {
						this.pen_pressure=false;
					}
				}
				if(pressure==0 && this.pen_pressure==false) pressure = 1;
				x = (event.originalEvent.touches[0].pageX-bounding_box.left)/this.zoomFactor;
				y = (event.originalEvent.touches[0].pageY-bounding_box.top)/this.zoomFactor;
				pressure = this.pen_pressure ? pressure : 1;
			} else {
				x = (event.pageX - bounding_box.left)/this.zoomFactor;
				y = (event.pageY-bounding_box.top)/this.zoomFactor;
				pressure = 1;
			}
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
		plugin.draw_hsl = function(hue,canvas){
			var ctx = canvas.getContext('2d');
			for(var row=0; row<100; row++){
				var grad = ctx.createLinearGradient(0, 0, 100,0);
				grad.addColorStop(0, 'hsl('+hue+', 0%, '+(100-row)+'%)');
				grad.addColorStop(1, 'hsl('+hue+', 100%, '+(50-row/2)+'%)');
				ctx.fillStyle=grad;
				ctx.fillRect(0, row, 100, 1);
			}	
		};
		plugin.is_dragging = false;

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
				var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
				var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
				var box = parent.getBoundingClientRect();
				var eventX = (event.type=="touchmove"||event.type=="touchstart") ? event.originalEvent.touches[0].pageX : event.pageX;
				var eventY = (event.type=="touchmove"||event.type=="touchstart") ? event.originalEvent.touches[0].pageY : event.pageY;
				var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
				var py = eventY - (box.y + $(document).scrollTop()) - borderTop;
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

			self.containerBoundCheck = function(event){
				var parent = $(self).parent()[0];
				var box = parent.getBoundingClientRect();
				var eventX = (event.type=="touchmove"||event.type=="touchstart") ? event.originalEvent.touches[0].clientX : event.originalEvent.clientX;
				var eventY = (event.type=="touchmove"||event.type=="touchstart") ? event.originalEvent.touches[0].clientY : event.originalEvent.clientY;
				return eventX >= box.left && eventX <= box.right && eventY >= box.top && eventY <= box.bottom;
			};

			//handles touchstart and mousedown. sets the important is_drawing flag if drawing started within the canvas area
			//this is important as drawing continues even when you leave, as long as it started in a valid area. 
			//calls plugin drawStart and drawSpot functions
			self.drawStart = function(e){
				var mouse_data = plugin.get_mouse_data.call(self,e);

				if(plugin.check_ignore(e)==true) return;
				//console.warn(e.button);

				//right-mouse drag: enter paning mode
				if(e.type === "mousedown" && e.button === 2){
					if(self.containerBoundCheck.call(self, e)){
						self.isRightDragging = true;
						//console.warn("right drag: start");
						self.rightDragStart = { x: e.pageX, y: e.pageY, scrollX: self.scrollX, scrollY: self.scrollY };
					}
					return;
				}

				//pinch: save snapshot and enter gesture mode
				if(e.type === "touchstart" && e.originalEvent.touches.length >= 2){
					//erase any dot drawn by the first touch before the gesture was detected
					if(self._gestureAbortSnapshot){
						context.putImageData(self._gestureAbortSnapshot, 0, 0);
						self._gestureAbortSnapshot = null;
					}
					var t1 = e.originalEvent.touches[0], t2 = e.originalEvent.touches[1];
					self.gestureStart = {
						dist:	 plugin.distance_between({x:t1.pageX,y:t1.pageY},{x:t2.pageX,y:t2.pageY}),
						angle:	Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX),
						zoom:	 self.zoomFactor,
						rotation: self.rotationAngle || 0,
						midX:	 (t1.pageX + t2.pageX) / 2,
						midY:	 (t1.pageY + t2.pageY) / 2,
						scrollX:  self.scrollX,
						scrollY:  self.scrollY
					};
					self.isGesturing = true;
					$(self).data("is_drawing", false);
					return;
				}

				if(self.$brushToolbox.is(":visible") && self.boundCheck.call(self,e)==true && self.containerBoundCheck.call(self,e)==true){//yay! We're drawing!
					if(plugin.is_dragging==false){
						mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);
						//save snapshot so the next gesture detection can erase this stroke start
						if(e.type === "touchstart") self._gestureAbortSnapshot = context.getImageData(0, 0, self.width, self.height);
						$(self).data("is_drawing",true);
					//	alert(context.lineCap);
						context.lineCap = "round";context.lineJoin = 'round';

						//calculate alpha
						 var calculatedAlpha = self.brushAlpha;
						 if(self.active_brush.pressure_affects_alpha==true){
							 calculatedAlpha = calculatedAlpha * (mouse_data.pressure * 2);
							 if(calculatedAlpha>1) calculatedAlpha = 1;
						}
						var calculatedSize = self.active_brush.size;
						 if(self.active_brush.pressure_affects_size==true){
							 calculatedSize = calculatedSize * (mouse_data.pressure * 2);
							 if(calculatedSize<1) calculatedSize = 1;
						}

						//context.lineWidth
						 //context.globalAlpha = calculatedAlpha < 1 ? calculatedAlpha : 1;
						$(self).data("positions",[{x:mouse_data.x,y:mouse_data.y}]);
						if(typeof self.active_brush.drawStart!=="undefined") self.active_brush.drawStart.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,calculatedAlpha,e);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,calculatedSize,calculatedAlpha,e);
						plugin.request_redraw.call(self);
					}
				}
			};
			$(window).bind("touchstart.drawr mousedown.drawr", self.drawStart);

			//handles touchmove and mousemove events. if is_drawing is true, will call plugins drawSpot
			//also handles toolbox dragging
			self.drawMove = function(e){

				//apply pinch zoom and rotation while gesturing
				if(self.isGesturing){
					var touches = e.originalEvent && e.originalEvent.touches;
					if(touches && touches.length >= 2){
						var t1 = touches[0], t2 = touches[1];
						var gs = self.gestureStart;
						var newDist  = plugin.distance_between({x:t1.pageX,y:t1.pageY},{x:t2.pageX,y:t2.pageY});
						var newAngle = Math.atan2(t2.pageY - t1.pageY, t2.pageX - t1.pageX);
						var newZoom  = Math.max(0.1, Math.min(5, gs.zoom * (newDist / gs.dist)));
						var newMidX  = (t1.pageX + t2.pageX) / 2;
						var newMidY  = (t1.pageY + t2.pageY) / 2;
						//console.warn(touches)
						//console.warn(newDist,newAngle,newZoom,newMidX,newMidY)
						/*keep the canvas point under the initial pinch centre pinned to the
						current finger midpoint, conmbine zoom-centering and panning in one step */
						var rect  = $(self).parent()[0].getBoundingClientRect();
						var cLeft = rect.left + window.scrollX;
						var cTop  = rect.top  + window.scrollY;
						var newScrollX = (gs.midX - cLeft + gs.scrollX) * (newZoom / gs.zoom) - (newMidX - cLeft);
						var newScrollY = (gs.midY - cTop  + gs.scrollY) * (newZoom / gs.zoom) - (newMidY - cTop);
						self.zoomFactor = newZoom;
						$(self).width(self.width * newZoom);
						$(self).height(self.height * newZoom);
						plugin.draw_checkerboard.call(self);
						plugin.apply_scroll.call(self, newScrollX, newScrollY, true);
						plugin.apply_rotation.call(self, gs.rotation + (newAngle - gs.angle));
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

					 var calculatedAlpha = self.brushAlpha;
					 if(self.active_brush.pressure_affects_alpha==true){
						 calculatedAlpha = calculatedAlpha * (mouse_data.pressure * 2);
						 if(calculatedAlpha>1) calculatedAlpha = 1;
					}
					var calculatedSize = self.active_brush.size;
					 if(self.active_brush.pressure_affects_size==true){
						 calculatedSize = calculatedSize * (mouse_data.pressure * 2);
						 if(calculatedSize<1) calculatedSize = 1;
					}

					 var stepSize = calculatedSize/6;

					 if(stepSize<1) stepSize = 1;
					 //advance along the line between last spot and current spot using a^2 + b^2 = c^2 nonsense.
					for (var i = stepSize; i < dist; i+=stepSize) {
						x = lastSpot.x + (Math.sin(angle) * i);
						y = lastSpot.y + (Math.cos(angle) * i);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,x,y,calculatedSize,calculatedAlpha,e);
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
				//handles scrollwheel zooming
				self.scrollWheel = function(e){
					var delta = new Number(e.originalEvent.deltaY * -0.005);

					if(delta<0){
						if(delta<-0.1) delta=-0.1;
					} else if(delta>0){
						if(delta>0.1) delta=0.1;
					}

					var newZoomies = self.zoomFactor + delta;
					var containerOffset = $(self).parent().offset();
					var focalX = e.pageX - containerOffset.left;
					var focalY = e.pageY - containerOffset.top;
					//console.warn("zoomlevel: ",newZoomies);
					plugin.apply_zoom.call(self, newZoomies, focalX, focalY);
				};
				$(self).parent().on("wheel.drawr", function(e){ 
					e.preventDefault(); 
					self.scrollWheel(e);
				});
			}
			$(self).parent().on("contextmenu.drawr", function(e){ e.preventDefault(); });

			$(window).bind("touchmove.drawr mousemove.drawr", self.drawMove);

			//handles mouseup and touchend to finish drawing. disables is_drawing flag, 
			//and on some tools finalizes transfer of what was drawn on the fx canvas to the main canvas
			//stops toolbox drag
			self.drawStop = function(e){

				//end gesture mode when fewer than two touches remain
				if(self.isGesturing){
					var remaining = e.originalEvent && e.originalEvent.touches;
					if(!remaining || remaining.length < 2) self.isGesturing = false;

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

					 var calculatedAlpha = self.brushAlpha;
					 if(self.active_brush.pressure_affects_alpha==true){
						 calculatedAlpha = calculatedAlpha * (mouse_data.pressure * 2);
						 if(calculatedAlpha>1) calculatedAlpha = 1;
					}
					var calculatedSize = self.active_brush.size;
					 if(self.active_brush.pressure_affects_size==true){
						 calculatedSize = calculatedSize * (mouse_data.pressure * 2);
						 if(calculatedSize<1) calculatedSize = 1;
					}

					var result=undefined;

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
			$(window).bind("touchend.drawr mouseup.drawr", self.drawStop);
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
			var context = this.getContext("2d", { alpha: this.settings.enable_transparency });
			this.$brushToolbox.find(".drawr-tool-btn.type-brush").each(function(){
				$(this).removeClass("active");
				$(this).css({ "background" : "#eeeeee", "color" : "#000000" });
			});
			$(button).css({ "background" : "orange","color" : "white" });
			$(button).addClass("active");
			plugin.activate_brush.call(this,$(button).data("data"));
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
			this.active_brush.activate.call(this,this.active_brush,context);
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

			el.on("mousedown.drawr touchstart.drawr", function(e){
				if($(this).data("type")=="brush") plugin.select_button.call(self,this);
				if(typeof data.action!=="undefined") {
					var ctx = self.getContext("2d", { alpha: self.settings.enable_transparency });
					data.action.call(self,data,ctx);
				}
				if($(this).data("type")=="toggle") {//toggle data attribute and select effect
					if(typeof $(this).data("state")=="undefined") $(this).data("state",false);
					$(this).data("state",!$(this).data("state"));
					if($(this).data("state")==true){
						$(this).css({ "background" : "orange", "color" : "white" });
					} else {
						$(this).css({ "background" : "#eeeeee", "color" : "#000000" });
					}
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

		/* create a slider */
		plugin.create_slider = function(toolbox,title,min,max,value){
			var self=this;
			$(toolbox).append('<div style="clear:both;font-weight:bold;text-align:center;padding:5px 0px 5px 0px">' + title + '</div><div style="clear:both;display: inline-block;width: 50px;height: 60px;margin-top:5px;padding: 0;"><input class="slider-component slider-' + title.toLowerCase() + '" value="' + value + '" style="background:transparent;width: 50px;height: 50px;margin: 0;transform-origin: 25px 25px;transform: rotate(90deg);" type="range" min="' + min + '" max="' + max + '" step="1" /><span>' + value + '</span></div>');
			$(toolbox).find(".slider-" + title.toLowerCase()).on("mousedown touchstart",function(e){
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

			if(this.settings.enable_transparency_image==true){
				if(!this.$bgCanvas){
					this.$bgCanvas = $("<canvas class='drawr-bg-canvas'></canvas>");
					this.$bgCanvas.css({"position":"absolute","z-index":0,"top":0,"left":0,"pointer-events":"none"});
					this.$bgCanvas.insertBefore(this);
				}
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
			var borderTop = parseInt(window.getComputedStyle($(this).parent()[0], null).getPropertyValue("border-top-width"));
			var borderLeft = parseInt(window.getComputedStyle($(this).parent()[0], null).getPropertyValue("border-left-width"));

			this.$memoryCanvas.css({
				"z-index": 5,
				"position":"absolute",
				"width" : parent_width,
				"height" : parent_height/*,
				"top" : ($(this).parent().offset().top + borderTop) + "px",
				"left" : ($(this).parent().offset().left + borderLeft) + "px"
				position is now absolute inside relative parent.
				*/
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

			//scroll indicators
			if(this.scrollTimer>0){

				context.globalAlpha = (0.6/100)*this.scrollTimer<1 ?  (0.6/100)*this.scrollTimer : 0.6;//brush.currentAlpha;

				this.scrollTimer-=5;
				context.lineWidth = 4;
				context.lineCap = 'square';
				context.beginPath(); 

				//horizontal
				var max_bar_width = container_width;
				var visible_scroll_x = container_width;
				if(this.scrollX<0) visible_scroll_x += this.scrollX;
				if(this.scrollX> (this.width*this.zoomFactor)-container_width) visible_scroll_x -= this.scrollX-((this.width*this.zoomFactor)-container_width);
				if(visible_scroll_x<0) visible_scroll_x = 0;	
				var percentage = 100/this.width * visible_scroll_x;
				var scroll_bar_width= max_bar_width / 100 * percentage;
				scroll_bar_width/=this.zoomFactor;
				if(scroll_bar_width<1) scroll_bar_width = 1;

				var position_percentage = (100/((this.width*this.zoomFactor)-container_width))*this.scrollX;	
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
				if(this.scrollY> (this.height*this.zoomFactor)-container_height) visible_scroll_y -= this.scrollY-((this.height*this.zoomFactor)-container_height);
				if(visible_scroll_y<0) visible_scroll_y = 0;	
				var percentage = 100/(this.height*this.zoomFactor) * visible_scroll_y;
				var scroll_bar_height= max_bar_height / 100 * percentage;
			//	scroll_bar_height/=this.zoomFactor;
				if(scroll_bar_height<1) scroll_bar_height = 1;

				var position_percentage = (100/((this.width*this.zoomFactor)-container_height))*this.scrollY;	
				var posy=(((max_bar_height-scroll_bar_height)/100)*position_percentage);
				if(posy<0) posy=0;
				if(posy>container_height-scroll_bar_height) posy = container_height-scroll_bar_height;

				context.moveTo(container_width-2,posy);
				context.lineTo(container_width-2,posy+scroll_bar_height);
				context.stroke();
			}

			//we only keep the loop alive when there is work to do (effectCallback preview or scroll indicators fading in n out). Everything else is triggered via request_redraw.
			if((typeof this.effectCallback!=="undefined" && this.effectCallback!==null) || this.scrollTimer > 0){
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
			$(toolbox).on("mousedown.drawr touchstart.drawr", function(e){
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
			var sz = 20 * self.zoomFactor;
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, W, H);
			ctx.fillStyle = '#cccccc';
			for(var row = 0; row * sz < H; row++){
				for(var col = row % 2; col * sz < W; col += 2){
					ctx.fillRect(col * sz, row * sz, sz, sz);
				}
			}
			var angle = self.rotationAngle || 0;
			var sx = self.scrollX || 0;
			var sy = self.scrollY || 0;
			self.$bgCanvas.css("transform","translate(" + -sx + "px," + -sy + "px) rotate(" + angle + "rad)");
		};

		//call this to change scroll
		//if setTimer is set the scrollbars will show for a brief moment
		//we should probably do that with more operations later on. rotation could affect scroll, so
		plugin.apply_scroll = function(x,y,setTimer){
			var self = this;
			var angle = self.rotationAngle || 0;
			var transform = "translate(" + -x + "px," + -y + "px) rotate(" + angle + "rad)";
			$(self).css("transform",transform);
			if(self.$bgCanvas) self.$bgCanvas.css("transform",transform);
			self.scrollX = x;
			self.scrollY = y;
			if(setTimer==true){
				self.scrollTimer= 250;
			}
			plugin.request_redraw.call(self);
		};

		//call this to set canvas rotation angle (radians).
		plugin.apply_rotation = function(angle){
			var self = this;
			self.rotationAngle = angle;
			var transform = "translate(" + -self.scrollX + "px," + -self.scrollY + "px) rotate(" + angle + "rad)";
			$(self).css("transform",transform);
			if(self.$bgCanvas) self.$bgCanvas.css("transform",transform);
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
		plugin.get_tool_by_name = function(toolset,toolname){
			var found = null;
			for(var tool of $.fn.drawr.availableTools){
				if(tool.name == toolname){
					found = tool;
				}
			}
			if(found==null){
				throw new Error("Tool " + toolname + " not found, as referenced in " + toolset);
			}
			return found;
		};

		plugin.load_toolset = function(toolset){
			//console.warn("loading toolset",toolset);
			var self = this;
			self.current_toolset = toolset;

			if(toolset=="default"){
				$.fn.drawr.availableTools.sort(function(a,b) {return (a.order > b.order) ? 1 : ((b.order > a.order) ? -1 : 0);} ); 
				$.each($.fn.drawr.availableTools,function(i,tool){
					var type = "brush";
					if(typeof tool.type!=="undefined"){
						type=tool.type;
					}
					plugin.create_button.call(self,self.$brushToolbox[0],type,tool);
				});
			} else {
				for(var tool_name of self.toolsets[toolset]){
					var tool = plugin.get_tool_by_name(toolset,tool_name);
					var type = "brush";
					if(typeof tool.type!=="undefined"){
						type=tool.type;
					}
					plugin.create_button.call(self,self.$brushToolbox[0],type,tool);
				}
			}
		};

		//call with $(selector).drawr("export",mime)
		//mime is optional, will default to png. returns a data url.
		if ( action == "export" ) {
			var currentCanvas = this.first()[0];
			var mime = typeof param=="undefined" ? "image/png" : param;
			return currentCanvas.toDataURL(mime);
		} 

		/*
		this displays this level of the undo stack as a popup. handy for debugging undo problems.
		if ( action == "debug_undo" ) {
			var currentCanvas = this.first()[0];
			var level = typeof param=="undefined" ? 0 : param;
			var url = currentCanvas.undoStack[level].data;
			var img=document.createElement("img");
			img.src=url;
			img.className="undo-image";
			$(".undo-image").detach();
			$(document.body).append(img);
			$(".undo-image").css({
				left:"50%",
				top:"50%",
				position:"absolute",
				zIndex:1234134,
				border:"1px dotted red",
				boxShadow: "2px 2px 5px rgba(0,0,0,0.3)"
			});
			return null;
		}*/

		//todo: document whatever this is 
		if( action == "button" ){
			var collection = $();
			this.each(function() {
				var currentCanvas = this;
				var newButton = plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],typeof param.type=="undefined" ? "action" : param.type,param);
				collection=collection.add(newButton);
			});
			return collection;
		}

		//call with $(selector).drawr("clear") to clear the canvas.
		if( action == "clear" ){
			this.each(function() {
				var currentCanvas = this;
				currentCanvas.plugin.clear_canvas.call(currentCanvas,true);
			});
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
				currentCanvas.$brushToolbox.find(".drawr-tool-btn:first").mousedown();				
			} else if ( action === "stop" ) {
				if(!$(currentCanvas).hasClass("active-drawr")) {
					console.error("The element you are running this command on is not a drawr canvas.");
					return false;//can't stop if not initialized.
				}
				//reset togglers
				currentCanvas.$brushToolbox.find('.drawr-tool-btn.type-toggle').each(function(){
					if($(this).data("state")==true){
						$(this).trigger("mousedown");
					}
				});
				$(".drawr-toolbox").hide();
			} else if ( action === "createtoolset" ) {

				if(typeof currentCanvas.toolsets=="undefined") currentCanvas.toolsets = {};
				if(typeof param!=="string" || typeof param2!=="object" || Array.isArray(param2)==false){
					throw new Error("Invalid parameters");
				}
				currentCanvas.toolsets[param] = param2;

				console.warn("createtoolset called",currentCanvas.toolsets);

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
				parent.find(".drawr-toolbox .drawr-tool-btn").off("mousedown.drawr touchstart.drawr");
				parent.find(".drawr-toolbox .slider-component").off("input.drawr");
				parent.find(".drawr-toolbox").on("mousedown.drawr touchstart.drawr");
				parent.find('.drawr-toolbox .color-picker').off("choose.drawrpalette").drawrpalette("destroy");
				$(window).unbind("touchend.drawr mouseup.drawr", currentCanvas.drawStop);
				$(window).unbind("touchmove.drawr mousemove.drawr", currentCanvas.drawMove);
				$(window).unbind("touchstart.drawr mousedown.drawr", currentCanvas.drawStart);
				$(window).unbind("wheel.drawr mousedown.drawr", currentCanvas.scrollWheel);
				$(window).off("resize.drawr", currentCanvas.onWindowResize);

				$.each($.fn.drawr.availableTools,function(i,tool){
					if(typeof tool.cleanup!=="undefined"){
						tool.cleanup.call(this);
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
					"enable_transparency_image" : true,
					"enable_scrollwheel_zooming" : true,
					"canvas_width" : $(currentCanvas).parent().innerWidth(),
					"canvas_height" : $(currentCanvas).parent().innerHeight(),
					"undo_max_levels" : 5,
					"color_mode" : "picker",
					"clear_on_init" : true,
					"toolbox_cols" : 3
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
