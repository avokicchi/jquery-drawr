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
		plugin.get_mouse_data = function (event,relativeTo) {//body event, but relative to other element extend with pressure later.
			if(typeof relativeTo!=="undefined"){
				var borderTop = parseInt(window.getComputedStyle(relativeTo, null).getPropertyValue("border-top-width"));
				var borderLeft = parseInt(window.getComputedStyle(relativeTo, null).getPropertyValue("border-left-width"));
				var bounding_box = {
					left: relativeTo.offsetLeft - $(relativeTo).scrollLeft() + borderLeft,
					top: relativeTo.offsetTop - $(relativeTo).scrollTop() + borderTop
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
		plugin.scroll_bar_width = function () {
		    var outer = document.createElement("div");
		    outer.style.visibility = "hidden";
		    outer.style.width = "100px";
		    outer.style.msOverflowStyle = "scrollbar"; // needed for WinJS apps
		    document.body.appendChild(outer);
		    var widthNoScroll = outer.offsetWidth;
		    outer.style.overflow = "scroll";
		    var inner = document.createElement("div");
		    inner.style.width = "100%";
		    outer.appendChild(inner);        
		    var widthWithScroll = inner.offsetWidth;
		    outer.parentNode.removeChild(outer);
		    return widthNoScroll - widthWithScroll;
		};

		plugin.is_dragging = false;

        plugin.bind_draw_events = function(){
        	var self=this;
        	var context = self.getContext("2d", { alpha: self.settings.enable_tranparency });
			$(self).data("is_drawing",false);$(self).data("lastx",null);$(self).data("lasty",null);
			$(self).parent().on("touchstart", function(e){ e.preventDefault(); });//cancel scroll.
			$(window).on("touchstart mousedown", function(e){
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
						mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0]);
						$(self).data("is_drawing",true);
						context.lineWidth = self.active_brush.size;
					//	alert(context.lineCap);
						context.lineCap = "round";context.lineJoin = 'round';
	 					var calculatedAlpha = self.brushAlpha * (mouse_data.pressure * 2);
	 					context.globalAlpha = calculatedAlpha < 1 ? calculatedAlpha : 1;
						//context.strokeStyle = "skyblue";
						$(self).data("positions",[{x:mouse_data.x,y:mouse_data.y}]);
						if(typeof self.active_brush.drawStart!=="undefined") self.active_brush.drawStart.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,e);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,mouse_data.pressure,e);
					}
				}
			}).on("touchmove mousemove", function(e){
				var mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0]);
				if($(self).data("is_drawing")==true){
					var positions = $(self).data("positions");
					var currentSpot = {x:mouse_data.x,y:mouse_data.y};
					var lastSpot=positions[positions.length-1];
					var dist = plugin.distance_between(lastSpot, currentSpot);
 					var angle = plugin.angle_between(lastSpot, currentSpot);
 					var stepSize = self.brushSize/6;
 					var calculatedAlpha = self.brushAlpha * (mouse_data.pressure * 2);
 					context.globalAlpha = calculatedAlpha < 1 ? calculatedAlpha : 1;
 					if(stepSize<1) stepSize = 1;
					for (var i = stepSize; i < dist; i+=stepSize) {//advance along the line between last spot and current spot using a^2 + b^2 = c^2 nonsense.
					    x = lastSpot.x + (Math.sin(angle) * i);
					    y = lastSpot.y + (Math.cos(angle) * i);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,context,x,y,mouse_data.pressure,e);
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
			}).on("touchend mouseup", function(e){
				if($(self).data("is_drawing")==true){
					var mouse_data = plugin.get_mouse_data.call(self,e);
					if(typeof self.active_brush.drawStop!=="undefined") self.active_brush.drawStop.call(self,self.active_brush,context,mouse_data.x,mouse_data.y,e);
				}
				$(self).data("is_drawing",false).data("lastx",null).data("lasty",null);
				$(".drawr-toolbox").data("dragging", false);
				if(!plugin.is_dragging){
					if(e.target.tagName!=="INPUT"){
		    			e.preventDefault();
		    		}
	    		}
    			plugin.is_dragging=false;
			});

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
        	if(typeof this.$colorToolbox!=="undefined") this.$colorToolbox.find("input:first").val(this.brushAlpha*100).trigger("input");
        	if(typeof this.$colorToolbox!=="undefined") this.$colorToolbox.find("input:last").val(this.brushSize).trigger("input");
			this.active_brush.activate.call(this,this.active_brush,context);
        };

        /* Inserts a button into a toolbox */
        plugin.create_button = function(toolbox,type,data,css){
        	var self=this;
        	var el = $("<button style='float:left;display:block;margin:0px;'><i class='" + data.icon + "'></i></button>");
    	    el.css({ "outline" : "none", "text-align":"center","padding-left": "0px","padding-right": "0px","width" : "50%", "background" : "#eeeeee", "color" : "#000000","border":"0px","min-height":"40px","user-select": "none", "text-align": "center" });
    		if(typeof css!=="undefined") el.css(css);
    		el.addClass("type-" + type);
        	el.data("data",data).data("type",type);
    		el.on("mousedown touchstart", function(e){
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
        	if($(toolbox).find(".seperator").length>0 && type=="action"){
        		el.insertBefore($(toolbox).find(".seperator"));
        	} else {
	        	$(toolbox).append(el);
	        }
        	return el;
        };

        /* create a slider */
        plugin.create_slider = function(toolbox,title,min,max,value){
        	var self=this;
		    $(toolbox).append('<div style="clear:both;font-weight:bold;text-align:center;padding:5px 0px 5px 0px">' + title + '</div><div style="clear:both;display: inline-block;width: 50px;height: 60px;margin-top:5px;padding: 0;"><input value="' + value + '" style="width: 50px;height: 50px;margin: 0;transform-origin: 25px 25px;transform: rotate(90deg);" type="range" min="' + min + '" max="' + max + '" step="1" /><span>' + value + '</span></div>');
	    	$(toolbox).find("input:last").on("mousedown touchstart",function(e){
	    		e.stopPropagation();
	    	}).on("input",function(e){
	    		 $(this).next().text($(this).val());
	    	});
	    	return $(toolbox).find("input:last");
        }

        //set some default settings. :)
        plugin.initialize_canvas = function(width,height){
        	$(this).css({ "display" : "block", "background-size": "20px 20px", "user-select": "none", "webkit-touch-callout": "none" });
        	$(this).parent().css({	"overflow": "scroll", "user-select": "none", "webkit-touch-callout": "none" });
        	if(this.settings.enable_tranparency==true) $(this).css({"background-image" : "url(" + tspImg + ")"});
			this.width=width;
			this.height=height;
			$(this).width(width);
			$(this).height(height);
			this.zoomFactor = 1;
			this.brushColor = { r: 0, g: 0, b: 0 };
			this.plugin = plugin;
			//this.brushSize = this.settings.inital_brush_size;
			//this.brushAlpha = this.settings.inital_brush_alpha;
			this.pen_pressure = false;//switches mode once it detects.
			if(typeof this.$zoomToolbox!=="undefined") this.$zoomToolbox.find("input").val(100).trigger("input");
			//TODO: fix zoomlevel slider value, update it
			$(this).parent()[0].scrollLeft = 0;
			$(this).parent()[0].scrollTop = 0;
			var context = this.getContext("2d", { alpha: this.settings.enable_tranparency });
    		if(this.settings.enable_tranparency==false){
    			context.fillStyle="white";
    			context.fillRect(0,0,width,height);
			} else {
    			context.clearRect(0,0,width,height);
			}
			//memory canvas
			var context = this.$memoryCanvas[0].getContext("2d");
			context.fillStyle="blue";
			context.fillRect(0,0,width,height);
			var parent_width = $(this).parent().innerWidth() - plugin.scroll_bar_width();
			var parent_height = $(this).parent().innerHeight() - plugin.scroll_bar_width();
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
			window.requestAnimationFrame(plugin.draw_animations.bind(this));

        };

        plugin.draw_animations = function(){
        	var context = this.$memoryCanvas[0].getContext("2d");
        	context.clearRect(0,0,this.$memoryCanvas[0].width,this.$memoryCanvas[0].height);
 
        	if(typeof this.effectCallback!=="undefined" && this.effectCallback!==null){
        		this.effectCallback.call(this,context,this.active_brush,$(this).parent()[0].scrollLeft,$(this).parent()[0].scrollTop,this.zoomFactor);
        	}
    		
        	//window.requestAnimationFrame(plugin.draw_animations);
        	window.requestAnimationFrame(plugin.draw_animations.bind(this));
        };

        /* Create floating dialog and appends it hidden after the canvas */
        plugin.create_toolbox = function(id,position,title){
        	var self = this;
			var toolbox = document.createElement("div");
			toolbox.innerHTML="<div style='padding:5px 0px 5px 0px'>" + title + "</div>";
			toolbox.className = "drawr-toolbox drawr-toolbox-" + id;
			toolbox.ownerCanvas = self;
			$(toolbox).css({
				"position" : "absolute", "z-index" : 6, "cursor" : "move", "width" : "80px", "height" : "auto", "color" : "#fff",
				"padding" : "2px", "background" : "linear-gradient(to bottom, rgba(69,72,77,1) 0%,rgba(0,0,0,1) 100%)", "border-radius" : "2px",
				"box-shadow" : "0px 2px 5px -2px rgba(0,0,0,0.75)",	"user-select": "none", "font-family" : "sans-serif", "font-size" :"12px", "text-align" : "center"
			});
			$(toolbox).insertAfter($(this).parent());
			$(toolbox).offset(position);
        	$(toolbox).hide();
	        $(toolbox).on("mousedown touchstart", function(e){
	        	var ownerCanvas = this.ownerCanvas;
				var mouse_data = plugin.get_mouse_data.call(ownerCanvas,e,this);
	    		$(this).data("offsetx", mouse_data.x).data("offsety", mouse_data.y).data("dragging", true);
	    		plugin.is_dragging=true;
	    		e.preventDefault();
	    	});
			return $(toolbox);
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
	            $(".drawr-toolbox").hide();
	            $(".drawr-toolbox-brush").show();
				currentCanvas.$brushToolbox.find("button:first").mousedown();	            
	        } else if ( action === "stop" ) {
	        	//reset togglers
	        	currentCanvas.$brushToolbox.find('button.type-toggle').each(function(){
					if($(this).data("state")==true){
						$(this).trigger("mousedown");
					}
				});
	            $(".drawr-toolbox").hide();
	        } else if ( action === "load" ) {
	        	var img = document.createElement("img");
	        	img.crossOrigin = "Anonymous";

	        	img.onload = function(){
	        		var context = currentCanvas.getContext("2d", { alpha: currentCanvas.settings.enable_tranparency });
	        		plugin.initialize_canvas.call(currentCanvas,img.width,img.height);
        			context.drawImage(img,0,0);
	        	};
	        	img.src=param;
	        } else if ( action === "destroy" ) {
	        	alert("unimplemented");
	        	//$(currentCanvas).removeClass("active-drawr")
	        	//destroy toolboxes
	        	//unbind events
	        	//remove canvas css
	        	//remove properties stored on canvas
	        } else if ( typeof action == "object" || typeof action =="undefined" ){//not an action, but an init call
	        	
				if($(currentCanvas).hasClass("active-drawr")) return false;//prevent double init
				currentCanvas.className = currentCanvas.className + " active-drawr";
				$(currentCanvas).parent().addClass("drawr-container");

	        	//determine settings
		    	var defaultSettings = {
		    		"enable_tranparency" : true,
		    		"canvas_width" : $(currentCanvas).parent().innerWidth() - plugin.scroll_bar_width(),
		    		"canvas_height" : $(currentCanvas).parent().innerHeight() - plugin.scroll_bar_width()
		    	};
	        	if(typeof action == "object") defaultSettings = Object.assign(defaultSettings, action);
	        	currentCanvas.settings = defaultSettings;

	        	//set up special effects layer
				currentCanvas.$memoryCanvas=$("<canvas class='sfx-canvas'></canvas>");
				currentCanvas.$memoryCanvas.insertBefore(currentCanvas);

	        	//set up canvas
        		plugin.initialize_canvas.call(currentCanvas,defaultSettings.canvas_width,defaultSettings.canvas_height);
				var context = currentCanvas.getContext("2d", { alpha: defaultSettings.enable_tranparency });			

				//brush dialog
        		currentCanvas.$brushToolbox = plugin.create_toolbox.call(currentCanvas,"brush",{ left: $(currentCanvas).parent().offset().left, top: $(currentCanvas).parent().offset().top },"Brushes");

        		$.fn.drawr.availableBrushes.sort(function(a,b) {return (a.order > b.order) ? 1 : ((b.order > a.order) ? -1 : 0);} ); 

				$.each($.fn.drawr.availableBrushes,function(i,brush){
	    			plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"brush",brush);
				});
				currentCanvas.$brushToolbox.append("<div style='clear:both;border-top:2px solid #000;' class='seperator'></div>");
	    		plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"toggle",{"icon":"mdi mdi-palette-outline mdi-24px"}).on("touchstart mousedown",function(){
	    			currentCanvas.$colorToolbox.toggle();
	    		});
	    		plugin.create_button.call(currentCanvas,currentCanvas.$brushToolbox[0],"toggle",{"icon":"mdi mdi-magnify mdi-24px"}).on("touchstart mousedown",function(){
	    			currentCanvas.$zoomToolbox.toggle();
	    		});
				//color dialog
        		currentCanvas.$colorToolbox = plugin.create_toolbox.call(currentCanvas,"color",{ left: $(currentCanvas).parent().offset().left + $(currentCanvas).parent().innerWidth() - 80, top: $(currentCanvas).parent().offset().top },"Color");
	    		var colors = ["#FFFFFF","#0074D9","#2ECC40","#FFDC00","#FF4136","#111111"];
	    		$.each(colors,function(i,color){
		    		plugin.create_button.call(currentCanvas,currentCanvas.$colorToolbox[0],"color",{"icon":""},{"background":color}).on("touchstart mousedown",function(){
		    			currentCanvas.brushColor = plugin.hex_to_rgb(color);
						if(typeof currentCanvas.active_brush.activate!=="undefined") currentCanvas.active_brush.activate.call(currentCanvas,currentCanvas.active_brush,context);
						plugin.is_dragging=false;
		    		});
	    		});
	    		plugin.create_slider.call(currentCanvas, currentCanvas.$colorToolbox,"alpha", 0,100,parseInt(100*defaultSettings.inital_brush_alpha)).on("input",function(){
		    		currentCanvas.brushAlpha = parseFloat(this.value/100);
		    		currentCanvas.active_brush.alpha = parseFloat(this.value/100);;
		    		plugin.is_dragging=false;
        		});
        		plugin.create_slider.call(currentCanvas, currentCanvas.$colorToolbox,"size", 2,100,defaultSettings.inital_brush_size).on("input",function(){
		    		currentCanvas.brushSize = this.value;
		    		currentCanvas.active_brush.size = this.value;
		    		plugin.is_dragging=false;
        		});
	    		//size dialog
        		//zoom dialog
        		currentCanvas.$zoomToolbox = plugin.create_toolbox.call(currentCanvas,"zoom",{ left: $(currentCanvas).parent().offset().left + $(currentCanvas).parent().innerWidth() - 80, top: $(currentCanvas).parent().offset().top },"Zoom");
        		plugin.create_slider.call(currentCanvas, currentCanvas.$zoomToolbox,"zoom", 0,400,100).on("input",function(){
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
		    			//$(currentCanvas).parent()[0].scrollLeft = $(currentCanvas).parent()[0].scrollLeft * zoomDiff;
		    			//$(currentCanvas).parent()[0].scrollTop = $(currentCanvas).parent()[0].scrollTop * zoomDiff;
		    			//doesn't seem to work. m aybe my logic on this is off. I think what you really want is the scroll position at 100% zoom level times the zoomfactor. that currently is not recorded, though.
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
 
}( jQuery ));
