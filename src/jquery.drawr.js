/*!
* jquery.drawr.js
* https://github.com/lieuweprins/jquery-drawr
* Copyright (c) 2019 Lieuwe Prins
* Licensed under the MIT license (http://www.opensource.org/licenses/mit-license.php)
*/

(function( $ ) {
 
    $.fn.drawr = function( action, param ) {
    	var plugin = this;
    	var tspImg="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7DAAAOwwHHb6hkAAAAB3RJTUUH4wUIDDYyGYFdggAAAC5JREFUOMtjfPXqFQNuICoqikeWiYECMKp5ZGhm/P//Px7p169fjwbYqGZKNAMA5EEI4kUyPZcAAAAASUVORK5CYII=";
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
		plugin.get_mouse_data = function (event,relativeTo,scrollEl) {//body event, but relative to other element extend with pressure later.
			if(typeof relativeTo!=="undefined" && relativeTo!==null){
				var borderTop = parseInt(window.getComputedStyle(relativeTo, null).getPropertyValue("border-top-width"));
				var borderLeft = parseInt(window.getComputedStyle(relativeTo, null).getPropertyValue("border-left-width"));
				var translate_x = typeof scrollEl!=="undefined" ? scrollEl.scrollX : 0;
				var translate_y = typeof scrollEl!=="undefined" ? scrollEl.scrollY : 0;

				var bounding_box = {
					left: relativeTo.offsetLeft - translate_x + borderLeft,
					top: relativeTo.offsetTop - translate_y + borderTop
				};
			} else {
				var bounding_box = {
					left: 0,
					top: 0 
				};			
			}
			if(event.type=="touchmove" || event.type=="touchstart"){
				var pressure = typeof event.originalEvent.touches[0].force!=="undefined" ? event.originalEvent.touches[0].force : 1;
				if(typeof event.originalEvent.touches[0].touchType!=="undefined" && event.originalEvent.touches[0].touchType=="stylus"){
					this.pen_pressure=true;
				} else {
					this.pen_pressure=false;
				}
				if(pressure==0 && this.pen_pressure==false) pressure = 1;
				return { x: (event.originalEvent.touches[0].pageX-bounding_box.left)/this.zoomFactor, y: (event.originalEvent.touches[0].pageY-bounding_box.top)/this.zoomFactor, pressure: pressure };
			} else {
				return { x: (event.pageX - bounding_box.left)/this.zoomFactor, y: (event.pageY-bounding_box.top)/this.zoomFactor, pressure: 1 };
			}
		};
		plugin.draw_hsl = function(hue,canvas){
			var ctx = canvas.getContext('2d');
			for(row=0; row<100; row++){
				var grad = ctx.createLinearGradient(0, 0, 100,0);
				grad.addColorStop(0, 'hsl('+hue+', 0%, '+(100-row)+'%)');
				grad.addColorStop(1, 'hsl('+hue+', 100%, '+(50-row/2)+'%)');
				ctx.fillStyle=grad;
				ctx.fillRect(0, row, 100, 1);
			}	
	    };
		plugin.is_dragging = false;

        plugin.bind_draw_events = function(){
        	var self=this;
        	var context = self.getContext("2d", { alpha: self.settings.enable_tranparency });
			$(self).data("is_drawing",false);$(self).data("lastx",null);$(self).data("lasty",null);
			$(self).parent().on("touchstart.drawr", function(e){ e.preventDefault(); });//cancel scroll.

			self.drawStart = function(e){
				var parent = $(self).parent()[0];
				var canvasRect = {
					left: self.offsetLeft,
					top: self.offsetTop,
					width: $(self).parent()[0].offsetWidth - parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-right-width")) - parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width")),
					height: $(self).parent()[0].offsetHeight - parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-bottom-width")) - parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"))
				};
				var mouse_data = plugin.get_mouse_data.call(self,e);
				if(self.$brushToolbox.is(":visible") && mouse_data.x*self.zoomFactor>canvasRect.left && mouse_data.x*self.zoomFactor<(canvasRect.left + canvasRect.width) && mouse_data.y*self.zoomFactor>canvasRect.top && mouse_data.y*self.zoomFactor<(canvasRect.top + canvasRect.height)){//yay! We're drawing!
					if(plugin.is_dragging==false){
						mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);
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
					}
				}
			};
			$(window).bind("touchstart.drawr mousedown.drawr", self.drawStart);
			self.drawMove = function(e){
				var mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);
				if($(self).data("is_drawing")==true){
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

 					//var calculatedAlpha = self.brushAlpha * (mouse_data.pressure * 2);
 					//context.globalAlpha = calculatedAlpha < 1 ? calculatedAlpha : 1;

 					if(stepSize<1) stepSize = 1;
					for (var i = stepSize; i < dist; i+=stepSize) {//advance along the line between last spot and current spot using a^2 + b^2 = c^2 nonsense.
					    x = lastSpot.x + (Math.sin(angle) * i);
					    y = lastSpot.y + (Math.cos(angle) * i);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,x,y,calculatedSize,calculatedAlpha,e);
					    positions.push({x:x,y:y});
					}
					$(self).data("positions",positions);
				}
				mouse_data = plugin.get_mouse_data.call(self,e);
				$(".drawr-toolbox").each(function(){
	        		if($(this).data("dragging")==true){
	        			$(this).offset({
			                top: (mouse_data.y - $(this).data("offsety")) * self.zoomFactor,
			                left: (mouse_data.x - $(this).data("offsetx")) * self.zoomFactor
			            });
	        		}
	        	});
			};
			$(window).bind("touchmove.drawr mousemove.drawr", self.drawMove);
			self.drawStop = function(e){
				if($(self).data("is_drawing")==true){
					var mouse_data = plugin.get_mouse_data.call(self,e,self);

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
	  
				}
				$(self).data("is_drawing",false).data("lastx",null).data("lasty",null);
				$(".drawr-toolbox").data("dragging", false);
				if(!plugin.is_dragging){
					if(e.target.tagName!=="INPUT"){
		    			e.preventDefault();
		    		}
	    		}
    			plugin.is_dragging=false;
			};
			$(window).bind("touchend.drawr mouseup.drawr", self.drawStop);
        };

        plugin.record_undo_entry = function(){
        	this.$undoButton.css("opacity",1);
  			this.undoStack.push({data: this.toDataURL("image/png"),current: true});
  			if(this.undoStack.length>(this.settings.undo_max_levels+1)) this.undoStack.shift();
        };

        plugin.select_button = function(button){
        	var context = this.getContext("2d", { alpha: this.settings.enable_tranparency });
        	this.$brushToolbox.find("button.type-brush").each(function(){
        		$(this).removeClass("active");
        		$(this).css({ "background" : "#eeeeee", "color" : "#000000" });
        	});
        	$(button).css({ "background" : "orange","color" : "white" });
        	$(button).addClass("active");
        	plugin.activate_brush.call(this,$(button).data("data"));
        	/*if(typeof this.active_brush!=="undefined" && typeof this.active_brush.deactivate!=="undefined"){
				this.active_brush.deactivate.call(this,this.active_brush,context);
			}
        	this.active_brush = $(button).data("data");
			this.active_brush.activate.call(this,this.active_brush,context);*/
        };

        plugin.activate_brush = function(brush){
        	var context = this.getContext("2d", { alpha: this.settings.enable_tranparency });
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
        	var el = $("<button style='float:left;display:block;margin:0px;'><i class='" + data.icon + "'></i></button>");
    	    el.css({ "outline" : "none", "text-align":"center","padding": "0px 0px 0px 0px","width" : "50%", "background" : "#eeeeee", "color" : "#000000","border":"0px","min-height":"30px","user-select": "none", "text-align": "center", "border-radius" : "0px" });
    		if(typeof css!=="undefined") el.css(css);
    		el.addClass("type-" + type);
        	el.data("data",data).data("type",type);
    		el.on("mousedown.drawr touchstart.drawr", function(e){
        		if($(this).data("type")=="brush") plugin.select_button.call(self,this);
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
        	$(this).css({ "display" : "block", "user-select": "none", "webkit-touch-callout": "none" });
        	$(this).parent().css({	"overflow": "hidden", "user-select": "none", "webkit-touch-callout": "none" });
        	if(this.settings.enable_tranparency==true) $(this).css({"background-image" : "url(" + tspImg + ")"});

        	if(this.width!==width || this.height!==height){//if statement because it resets otherwise.
				this.width=width;
				this.height=height;
			}
			
			if(reset==true){
				this.zoomFactor = 1;
				if(typeof this.$zoomToolbox!=="undefined") this.$zoomToolbox.find("input").val(100).trigger("input");
				plugin.apply_scroll.call(this,0,0,false);
				$(this).width(width);
				$(this).height(height);
			}

			$(currentCanvas).css({
    			"background-size": (20*this.zoomFactor) + "px " + (20*this.zoomFactor) + "px "
    		});

			this.pen_pressure = false;//switches mode once it detects.
			
			var context = this.getContext("2d", { alpha: this.settings.enable_tranparency });

    		if(this.settings.clear_on_init==true){
	    		if(this.settings.enable_tranparency==false){
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
			var borderTop = parseInt(window.getComputedStyle($(this).parent()[0], null).getPropertyValue("border-top-width"));
			var borderLeft = parseInt(window.getComputedStyle($(this).parent()[0], null).getPropertyValue("border-left-width"));

			this.$memoryCanvas.css({
				"z-index": 5,
				"position":"absolute",
				"width" : parent_width,
				"height" : parent_height,
				"top" : ($(this).parent().offset().top + borderTop) + "px",
				"left" : ($(this).parent().offset().left + borderLeft) + "px"
			});
			this.$memoryCanvas[0].width=parent_width;
			this.$memoryCanvas[0].height=parent_height;
			this.$memoryCanvas.width(parent_width);
			this.$memoryCanvas.height(parent_height);

        };

        plugin.draw_animations = function(){
        	if(!$(this).hasClass("active-drawr")) return;//end drawing loop
        	var context = this.$memoryCanvas[0].getContext("2d");
        	context.clearRect(0,0,this.$memoryCanvas[0].width,this.$memoryCanvas[0].height);
 
        	if(typeof this.effectCallback!=="undefined" && this.effectCallback!==null){
        		this.effectCallback.call(this,context,this.active_brush,this.scrollX,this.scrollY,this.zoomFactor);
        	}

        	var container_width = $(this).parent().width();
        	var container_height = $(this).parent().height();

			context.globalAlpha = 0.5;//brush.currentAlpha;
			context.lineWidth = 1;
			context.lineJoin = context.lineCap = "round";
			context.strokeStyle = "black";

			//draw lines outlining canvas size

			context.beginPath(); 
			context.moveTo(0,-1-this.scrollY);
			context.lineTo(this.width,-1-this.scrollY);
			context.stroke();

    		context.beginPath(); 
			context.moveTo(0,(this.height*this.zoomFactor)-this.scrollY);
			context.lineTo(this.width,(this.height*this.zoomFactor)-this.scrollY);
			context.stroke();

			context.beginPath(); 
			context.moveTo(-1-this.scrollX,0);
			context.lineTo(-1-this.scrollX,this.height);
			context.stroke();

    		context.beginPath(); 
			context.moveTo((this.width*this.zoomFactor)-this.scrollX,0);
			context.lineTo((this.width*this.zoomFactor)-this.scrollX,this.height);
			context.stroke();

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

        	//window.requestAnimationFrame(plugin.draw_animations);
        	window.requestAnimationFrame(plugin.draw_animations.bind(this));
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
	        	var ownerCanvas = this.ownerCanvas;
				var mouse_data = plugin.get_mouse_data.call(ownerCanvas,e,this);
	    		$(this).data("offsetx", mouse_data.x).data("offsety", mouse_data.y).data("dragging", true);
	    		plugin.is_dragging=true;
	    		e.preventDefault();
	    	});
			return $(toolbox);
        };

        plugin.apply_scroll = function(x,y,setTimer){
        	var self = this;
        	$(self).css("transform","translate(" + -x + "px," + -y + "px)");
        	self.scrollX = x;
        	self.scrollY = y;
        	if(setTimer==true){
        		self.scrollTimer= 250;
        	}
        };

        plugin.get_styles = function(el){
    	    var inlineStyles = {};
            for (var i = 0, l = el.style.length; i < l; i++){
                var styleProperty = el.style[i];
                var styleValue = getComputedStyle(el, null).getPropertyValue(styleProperty);
                inlineStyles[styleProperty]=styleValue;
            }
            return inlineStyles;
        };

    	if ( action == "export" ) {
	        var currentCanvas = this.first()[0];
	        var mime = typeof param=="undefined" ? "image/png" : param;
	        return currentCanvas.toDataURL(mime);
	    } 

	    if( action == "button" ){
	    	var collection = $();
	    	this.each(function() {
	    		var currentCanvas = this;
	    		var newButton = plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"action",param);
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
	            $(".drawr-toolbox").hide();
	            $(".drawr-toolbox-brush").show();
	            $(".drawr-toolbox-palette").show();
				currentCanvas.$brushToolbox.find("button:first").mousedown();	            
	        } else if ( action === "stop" ) {
	        	if(!$(currentCanvas).hasClass("active-drawr")) {
                    console.error("The element you are running this command on is not a drawr canvas.");
                    return false;//can't stop if not initialized.
                }
	        	//reset togglers
	        	currentCanvas.$brushToolbox.find('button.type-toggle').each(function(){
					if($(this).data("state")==true){
						$(this).trigger("mousedown");
					}
				});
	            $(".drawr-toolbox").hide();
	        } else if ( action === "load" ) {
	        	if(!$(currentCanvas).hasClass("active-drawr")) {
                    console.error("The element you are running this command on is not a drawr canvas.");
                    return false;//can't load if not initialized.
                }
	        	var img = document.createElement("img");
	        	img.crossOrigin = "Anonymous";

	        	img.onload = function(){
	        		var context = currentCanvas.getContext("2d", { alpha: currentCanvas.settings.enable_tranparency });
	        		plugin.initialize_canvas.call(currentCanvas,img.width,img.height,true);
	        		currentCanvas.undoStack = [{data: currentCanvas.toDataURL("image/png"),current:true}];
        			context.drawImage(img,0,0);
	        	};
	        	img.src=param;
	        } else if ( action === "destroy" ) {
	        	if(!$(currentCanvas).hasClass("active-drawr")) {
                    console.error("The element you are running this command on is not a drawr canvas.");
                    return false;//can't destroy if not initialized.
                }
	        	var parent = $(currentCanvas).parent();
				parent.off("touchstart.drawr");
				parent.find(".drawr-toolbox button").off("mousedown.drawr touchstart.drawr");
				parent.find(".drawr-toolbox .slider-component").off("input.drawr");
				parent.find(".drawr-toolbox").on("mousedown.drawr touchstart.drawr");
				parent.find('.drawr-toolbox .color-picker').off("choose.drawrpalette").drawrpalette("destroy");
				$(window).unbind("touchend.drawr mouseup.drawr", currentCanvas.drawStop);
				$(window).unbind("touchmove.drawr mousemove.drawr", currentCanvas.drawMove);
				$(window).unbind("touchstart.drawr mousedown.drawr", currentCanvas.drawStart);
				currentCanvas.$memoryCanvas.remove();
				currentCanvas.$brushToolbox.remove();
				currentCanvas.$settingsToolbox.remove();
				currentCanvas.$zoomToolbox.remove();

				delete currentCanvas.$memoryCanvas;
				delete currentCanvas.$brushToolbox;
				delete currentCanvas.$settingsToolbox;
				delete currentCanvas.$zoomToolbox;

				delete currentCanvas.plugin;
				delete currentCanvas.settings;
				delete currentCanvas.undoStack;
				delete currentCanvas.brushColor;
				delete currentCanvas.$undoButton;
				delete currentCanvas.active_brush;
				delete currentCanvas.zoomFactor;
				delete currentCanvas.scrollX;
				delete currentCanvas.scrollY;
				delete currentCanvas.brushSize;
				delete currentCanvas.brushAlpha;
				delete currentCanvas.pen_pressure;
				delete currentCanvas.drawStart;
				delete currentCanvas.drawMove;
				delete currentCanvas.drawStop;
				delete scrollTimer;

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
	        } else if ( typeof action == "object" || typeof action =="undefined" ){//not an action, but an init call
	        	
				if($(currentCanvas).hasClass("active-drawr")) return false;//prevent double init
				currentCanvas.className = currentCanvas.className + " active-drawr";
				$(currentCanvas).parent().addClass("drawr-container");

	        	//determine settings
		    	var defaultSettings = {
		    		"enable_tranparency" : true,
		    		"canvas_width" : $(currentCanvas).parent().innerWidth(),
		    		"canvas_height" : $(currentCanvas).parent().innerHeight(),
		    		"undo_max_levels" : 5,
		    		"color_mode" : "picker",
		    		"clear_on_init" : true
		    	};
	        	if(typeof action == "object") defaultSettings = Object.assign(defaultSettings, action);
	        	currentCanvas.settings = defaultSettings;

	        	//set up special effects layer
				currentCanvas.$memoryCanvas=$("<canvas class='sfx-canvas'></canvas>");
				currentCanvas.$memoryCanvas.insertBefore(currentCanvas);

				currentCanvas.plugin = plugin;

	        	//set up canvas
        		plugin.initialize_canvas.call(currentCanvas,defaultSettings.canvas_width,defaultSettings.canvas_height,true);
        		currentCanvas.undoStack = [{data:currentCanvas.toDataURL("image/png"),current:true}];
				var context = currentCanvas.getContext("2d", { alpha: defaultSettings.enable_tranparency });			
				currentCanvas.brushColor = { r: 0, g: 0, b: 0 };
				window.requestAnimationFrame(plugin.draw_animations.bind(currentCanvas));

				//brush dialog
        		currentCanvas.$brushToolbox = plugin.create_toolbox.call(currentCanvas,"brush",{ left: $(currentCanvas).parent().offset().left, top: $(currentCanvas).parent().offset().top },"Brushes",80);

        		$.fn.drawr.availableBrushes.sort(function(a,b) {return (a.order > b.order) ? 1 : ((b.order > a.order) ? -1 : 0);} ); 

				$.each($.fn.drawr.availableBrushes,function(i,brush){
	    			plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"brush",brush);
				});
				//currentCanvas.$brushToolbox.append("<div style='clear:both;border-top:2px solid #000;' class='seperator'></div>");
	    		plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"toggle",{"icon":"mdi mdi-palette-outline mdi-24px"}).on("touchstart.drawr mousedown.drawr",function(){
	    			currentCanvas.$settingsToolbox.toggle();
	    		});
	    		plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"toggle",{"icon":"mdi mdi-magnify mdi-24px"}).on("touchstart.drawr mousedown.drawr",function(){
	    			currentCanvas.$zoomToolbox.toggle();
	    		});	    		
	    		currentCanvas.$undoButton=plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"action",{"icon":"mdi mdi-undo-variant mdi-24px"}).on("touchstart.drawr mousedown.drawr",function(){
				    if(currentCanvas.undoStack.length>0){
						if(currentCanvas.undoStack[currentCanvas.undoStack.length-1].current==true){
							currentCanvas.undoStack.pop();//ignore current version of canvas
						}
						$.each(currentCanvas.undoStack,function(i,stackitem){
							stackitem.current=false;
						});
						if(currentCanvas.undoStack.length==0) return;
						var undo = currentCanvas.undoStack.pop().data;
						var img = document.createElement("img");
						img.crossOrigin = "Anonymous";

						img.onload = function(){
							currentCanvas.plugin.initialize_canvas.call(currentCanvas,img.width,img.height,false);
							context.drawImage(img,0,0);
						};
						img.src=undo;
						if(currentCanvas.undoStack.length==0) {//don't allow stack to be emtpy.
							currentCanvas.$undoButton.css("opacity",0.5);
							currentCanvas.undoStack.push({data:undo,current:false});
						}
					}
	    		});
	    		currentCanvas.$undoButton.css("opacity",0.5);
				//color dialog
        		currentCanvas.$settingsToolbox = plugin.create_toolbox.call(currentCanvas,"settings",{ left: $(currentCanvas).parent().offset().left + $(currentCanvas).parent().innerWidth() - 80, top: $(currentCanvas).parent().offset().top },"Settings",80);

        		if(currentCanvas.settings.color_mode=="presets"){
        			var colors = ["#FFFFFF","#0074D9","#2ECC40","#FFDC00","#FF4136","#111111"];
		    		$.each(colors,function(i,color){
			    		plugin.create_button.call(currentCanvas,currentCanvas.$settingsToolbox[0],"color",{"icon":""},{"background":color}).on("touchstart.drawr mousedown.drawr",function(){
			    			currentCanvas.brushColor = plugin.hex_to_rgb(color);
							if(typeof currentCanvas.active_brush.activate!=="undefined") currentCanvas.active_brush.activate.call(currentCanvas,currentCanvas.active_brush,context);
							plugin.is_dragging=false;
			    		});
		    		});
        		}else {
	    			currentCanvas.$settingsToolbox.append("<input type='text' class='color-picker'/>");
					currentCanvas.$settingsToolbox.find('.color-picker').drawrpalette().on("choose.drawrpalette",function(event,hexcolor){
						currentCanvas.brushColor = plugin.hex_to_rgb(hexcolor);
						if(typeof currentCanvas.active_brush.activate!=="undefined") currentCanvas.active_brush.activate.call(currentCanvas,currentCanvas.active_brush,context);
					});
				}
	    		plugin.create_slider.call(currentCanvas, currentCanvas.$settingsToolbox,"alpha", 0,100,parseInt(100*defaultSettings.inital_brush_alpha)).on("input.drawr",function(){
		    		currentCanvas.brushAlpha = parseFloat(this.value/100);
		    		currentCanvas.active_brush.alpha = parseFloat(this.value/100);;
		    		plugin.is_dragging=false;
        		});
        		plugin.create_slider.call(currentCanvas, currentCanvas.$settingsToolbox,"size", 2,100,defaultSettings.inital_brush_size).on("input.drawr",function(){
		    		currentCanvas.brushSize = this.value;
		    		currentCanvas.active_brush.size = this.value;
		    		plugin.is_dragging=false;
        		});
	    		//size dialog
        		//zoom dialog
        		currentCanvas.$zoomToolbox = plugin.create_toolbox.call(currentCanvas,"zoom",{ left: $(currentCanvas).parent().offset().left + $(currentCanvas).parent().innerWidth() - 80, top: $(currentCanvas).parent().offset().top },"Zoom",80);
        		plugin.create_slider.call(currentCanvas, currentCanvas.$zoomToolbox,"zoom", 0,400,100).on("input.drawr",function(){
		    		//currentCanvas.brushAlpha = parseFloat(this.value/100);
		    		var cleaned = Math.ceil(this.value/10)*10;
		    		$(this).next().text(cleaned);
		    		var factor = (1/100)*cleaned;
		    		var zoomDiff=1+(factor-currentCanvas.zoomFactor);
		    		currentCanvas.zoomFactor = factor;
		    		$(currentCanvas).width(currentCanvas.width*factor);
		    		$(currentCanvas).height(currentCanvas.height*factor);
		    		$(currentCanvas).css({
		    			"background-size": (20*factor) + "px " + (20*factor) + "px "
		    		});
		    		if(zoomDiff!==1){
		    			plugin.apply_scroll.call(currentCanvas,currentCanvas.scrollX * zoomDiff,currentCanvas.scrollY * zoomDiff,true);
		    			//doesn't seem to work perfectly but it'll do for now
		    		}
        		});

				plugin.bind_draw_events.call(currentCanvas);
			}
		});
		return this;
 
    };

    /* Register a new brush */
    $.fn.drawr.register = function (brush){
		if(typeof $.fn.drawr.availableBrushes=="undefined") $.fn.drawr.availableBrushes=[];
		$.fn.drawr.availableBrushes.push(brush);
    };

    //go to center? do dis: plugin.apply_scroll.call(currentCanvas,((currentCanvas.width*currentCanvas.zoomFactor)-$(currentCanvas).parent().width())/2,((currentCanvas.height*currentCanvas.zoomFactor)-$(currentCanvas).parent().height())/2,true);
 
}( jQuery ));
