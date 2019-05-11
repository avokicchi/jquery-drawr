/*!
* jquery.drawrpalette.js
* https://github.com/lieuweprins/jquery-drawrpalette
* Copyright (c) 2019 Lieuwe Prins
* Licensed under the MIT license (http://www.opensource.org/licenses/mit-license.php)
*/

(function( $ ) {
 
    $.fn.drawrpalette = function( action, param ) {
    
        var plugin = this;
        
        plugin.offset = 5;
        plugin.pickerSize = 200;
        
        plugin.get_mouse_value = function(event,$relativeTo){
            var mouse_data = {};
            if(event.type=="touchmove" || event.type=="touchstart"){
                mouse_data.x = event.originalEvent.touches[0].pageX-$relativeTo.offset().left - plugin.offset;
                mouse_data.y = event.originalEvent.touches[0].pageY-$relativeTo.offset().top - plugin.offset;
            } else {
                mouse_data.x = event.pageX-$relativeTo.offset().left - plugin.offset;
                mouse_data.y = event.pageY-$relativeTo.offset().top - plugin.offset;
            }
            
            return mouse_data;
        };
               
        plugin.rgb_to_hex = function(r, g, b) {
            var rgb = b | (g << 8) | (r << 16);
            return '#' + (0x1000000 + rgb).toString(16).slice(1)
        };
        
        plugin.hex_to_rgb = function (hex) {
		    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
		    return result ? {
		        r: parseInt(result[1], 16),
		        g: parseInt(result[2], 16),
		        b: parseInt(result[3], 16)
		    } : null;
		};
        
        plugin.hsv_to_rgb = function (h, s, v) {
            var r, g, b, i, f, p, q, t;
            if (arguments.length === 1) {
                s = h.s, v = h.v, h = h.h;
            }
            i = Math.floor(h * 6);
            f = h * 6 - i;
            p = v * (1 - s);
            q = v * (1 - f * s);
            t = v * (1 - (1 - f) * s);
            switch (i % 6) {
                case 0: r = v, g = t, b = p; break;
                case 1: r = q, g = v, b = p; break;
                case 2: r = p, g = v, b = t; break;
                case 3: r = p, g = q, b = v; break;
                case 4: r = t, g = p, b = v; break;
                case 5: r = v, g = p, b = q; break;
            }
            return {
                r: Math.round(r * 255),
                g: Math.round(g * 255),
                b: Math.round(b * 255)
            };
        }
        
        plugin.rgb_to_hsv = function (r, g, b) {
            if (arguments.length === 1) {
                g = r.g, b = r.b, r = r.r;
            }
            var max = Math.max(r, g, b), min = Math.min(r, g, b),
            d = max - min,
            h,
            s = (max === 0 ? 0 : d / max),
            v = max / 255;

            switch (max) {
                case min: h = 0; break;
                case r: h = (g - b) + d * (g < b ? 6: 0); h /= 6 * d; break;
                case g: h = (b - r) + d * 2; h /= 6 * d; break;
                case b: h = (r - g) + d * 4; h /= 6 * d; break;
            }

            return {
                h: h,
                s: s,
                v: v
                };
        }
        
        plugin.hsv_to_xy = function(h,s,v){
            var x = s * plugin.pickerSize + plugin.offset;
            var y = (1 - v) * plugin.pickerSize + plugin.offset;
            return { 'x' : x, 'y' : y };
        };
        
        plugin.xy_to_hsv = function(x,y){
            var s = x/plugin.pickerSize;
            var v = (plugin.pickerSize-y)/plugin.pickerSize;
            return { 's' : s, 'v' : v };
        };
            	
		plugin.draw_hsv = function(size,canvas){
            var hsv = this.hsv;          
			var ctx = canvas.getContext('2d');
            ctx.clearRect(0,0,canvas.width,canvas.height);

            //draw hsl color space
			for(row=0; row<size; row++){
				var grad = ctx.createLinearGradient(0, 0, size,0);               
                var value = (size-row)/size;
                
                var rgb = plugin.hsv_to_rgb(hsv.h,0,value);
                grad.addColorStop(0, 'rgb('+rgb.r+', '+rgb.g+','+rgb.b+')');
                var rgb = plugin.hsv_to_rgb(hsv.h,1,value);
                grad.addColorStop(1, 'rgb('+rgb.r+', '+rgb.g+','+rgb.b+')');

				ctx.fillStyle=grad;
				ctx.fillRect(plugin.offset, row+plugin.offset, size, 1);
			}	
            //draw hue
            for(row=0; row<size; row++){
                ctx.fillStyle="hsl(" + ((360/size)*row) + ", 100%, 50%)";
                ctx.fillRect(size+plugin.offset+5, row+plugin.offset, 40, 1);
            }	
            
            ctx.fillStyle = "black";
            ctx.fillRect(size+plugin.offset+3,plugin.offset+(hsv.h * size)-3,44,6);
            ctx.fillStyle = "white";
            ctx.fillRect(size+plugin.offset+5,plugin.offset+(hsv.h * size)-1,40,2);
                        
            var pos = plugin.hsv_to_xy(this.hsv.h,this.hsv.s,this.hsv.v);
            
            ctx.beginPath();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "black";
            ctx.arc(pos.x, pos.y, 5, 0, 2 * Math.PI);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "white";
            ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI);
            ctx.stroke();
	    };
        
        plugin.update_color = function(){
            var hsv = this.hsv;
            var rgb = plugin.hsv_to_rgb(hsv.h,hsv.s,hsv.v);
            var color="rgb(" + rgb.r + "," + rgb.g + "," + rgb.b + ")";
            this.$button.css("background-color",color);
            /*if(hsv.v<0.5){
                this.$button.css("color","white");
            } else {
                this.$button.css("color","black");
            }*/
            plugin.draw_hsv.call(this,plugin.pickerSize,this.$dropdown.find("canvas")[0]);
        };
        
        plugin.update_value = function(){
            var rgb = plugin.hsv_to_rgb(this.hsv.h,this.hsv.s,this.hsv.v);
            var hex = plugin.rgb_to_hex(rgb.r, rgb.g, rgb.b);
            $(this).val(hex);
        };

        plugin.cancel = function(){
            var rgb = plugin.hex_to_rgb($(this).val());
            var hsv = plugin.rgb_to_hsv(rgb.r,rgb.g,rgb.b);
            this.hsv = hsv;
            plugin.update_color.call(this);
            $(this).trigger("cancel.drawrpalette",$(this).val());
        };
	
		this.each(function() {

			var currentPicker = this;	
			if ( action === "destroy") {
                if(!$(currentPicker).hasClass("active-drawrpalette")) {
                    console.error("The element you are running this command on is not a drawrpalette.");
                    return false;//can't destroy if not initialized.
                }
                //remove event listeners
                currentPicker.$button.off("mousedown.drawrpalette touchstart.drawrpalette");
                currentPicker.$dropdown.find(".ok").off("mouseup.drawrpalette touchend.drawrpalette");
                currentPicker.$dropdown.find(".cancel").off("mouseup.drawrpalette touchend.drawrpalette");
                currentPicker.$dropdown.off("mousedown.drawrpalette touchstart.drawrpalette");
                currentPicker.$button.off("mousedown.drawrpalette touchstart.drawrpalette");

                $(window).unbind("mousedown.drawrpalette touchstart.drawrpalette",currentPicker.paletteStart);
                $(window).unbind("mousemove.drawrpalette touchmove.drawrpalette",currentPicker.paletteMove);
                $(window).unbind("mouseup.drawrpalette touchend.drawrpalette",currentPicker.paletteStop);

                //show original input
                $(currentPicker).show();
                //remove components
                currentPicker.$button.remove();
                currentPicker.$dropdown.remove();
                //remove wrapper...
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
            } else if ( action == "set" ){
                if(!$(currentPicker).hasClass("active-drawrpalette")) {
                    console.error("The element you are running this command on is not a drawrpalette.");
                    return false;//can't set if not initialized.
                }
                $(currentPicker).val(param);
                var rgb = plugin.hex_to_rgb(param);
                var hsv = plugin.rgb_to_hsv(rgb.r,rgb.g,rgb.b);
                currentPicker.hsv = hsv;
                plugin.update_color.call(currentPicker);

            } else if ( typeof action == "object" || typeof action =="undefined" ){//not an action, but an init call

                var inlineStyles = {};
                for (var i = 0, l = currentPicker.style.length; i < l; i++){
                    var styleProperty = currentPicker.style[i];
                    var styleValue = getComputedStyle(currentPicker, null).getPropertyValue(styleProperty);
                    inlineStyles[styleProperty]=styleValue;
                }
                var inlineClasses = currentPicker.className!=="" ? currentPicker.className.split(" ") : [];
	        	
				if($(currentPicker).hasClass("active-drawrpalette")) return false;//prevent double init
				currentPicker.className = currentPicker.className + " active-drawrpalette";

	        	//determine settings
		    	var defaultSettings = {
		    		"enable_alpha" : false,
                    "append_to" : currentPicker,
		    	};
	        	if(typeof action == "object") defaultSettings = Object.assign(defaultSettings, action);
	        	currentPicker.settings = defaultSettings;
				currentPicker.plugin = plugin;
                
                $(this).wrap("<div class='drawrpallete-wrapper'></div>");
                this.$wrapper = $(this).parent();
                this.$wrapper.css({"position":"relative","display":"inline-block"});

                $(this).hide();

                currentPicker.$button=$("<button>&nbsp;</button>");
                currentPicker.$button.css({
                   "width" : "40px",
                   "height" : "40px",
                   "border" : "2px solid #ccc",
                   "background-color" : "#eee",
                   "cursor":"pointer",
                   "text-align" : "text",
                   "padding" : "0px",
                   "font-size": "2em",
                   "background-image": "url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAcAAAAHCAYAAADEUlfTAAAAG0lEQVR42mNgwAfKy8v/48I4FeA0AacVDFQBAP9wJkE/KhUMAAAAAElFTkSuQmCC')",
                   "background-repeat" : "no-repeat",
                   "background-position" : "24px 25px"
                });
                currentPicker.$button.css(inlineStyles);
                $.each(inlineClasses,function(i,className){
                    currentPicker.$button.addClass(className);
                });
                this.$wrapper.append(currentPicker.$button);
                
                var canvas_height = plugin.pickerSize+(plugin.offset*2);
                var canvas_width = plugin.pickerSize+40+(plugin.offset*2)+5;
				currentPicker.$dropdown=$("<div><canvas style='display:block;' class='drawrpallete-canvas' width=" + canvas_width + " height=" + canvas_height + " style='height:" + canvas_height + "px;width:" + canvas_width + "px;'></canvas></div>");
                currentPicker.$dropdown.append('<div style="height:28px;text-align:right;margin-top:-2px;padding:0px 5px;"><button class="cancel">cancel</button><button style="margin-left:5px;width:40px;" class="ok">ok</button></div>');
				this.$wrapper.append(currentPicker.$dropdown);
                currentPicker.$dropdown.css({
                   "background" : "#eee",
                   "width" : canvas_width + "px",
                   "height" : (canvas_height+ 28) + "px",
                   "position" : "absolute",
                   "z-index" : 8
                });
                
                currentPicker.$dropdown.find(".ok").css("color","black").on("mouseup.drawrpalette touchend.drawrpalette",function(){
                    plugin.update_value.call(currentPicker);
                    $(currentPicker).trigger("choose.drawrpalette",$(currentPicker).val());
                    currentPicker.$dropdown.hide();
                    $(currentPicker).trigger("close.drawrpalette");
                });
                
                currentPicker.$dropdown.find(".cancel").css("color","black").on("mouseup.drawrpalette touchend.drawrpalette",function(){
                    plugin.cancel.call(currentPicker);
                    currentPicker.$dropdown.hide();
                    $(currentPicker).trigger("close.drawrpalette");
                });
                
                currentPicker.$dropdown.on("mousedown.drawrpalette touchstart.drawrpalette",function(e){
                    var mouse_data = plugin.get_mouse_value(e,currentPicker.$dropdown);
                    if(mouse_data.x>0 && mouse_data.x<plugin.pickerSize && mouse_data.y>0 && mouse_data.y<plugin.pickerSize){
                        currentPicker.slidingHsl=true;
                        var hsv = plugin.xy_to_hsv(mouse_data.x,mouse_data.y);
                        currentPicker.hsv.s=hsv.s;
                        currentPicker.hsv.v=hsv.v;
                        plugin.update_color.call(currentPicker);
                        var rgb = plugin.hsv_to_rgb.call(currentPicker,currentPicker.hsv.h,currentPicker.hsv.s,currentPicker.hsv.v);
                        var hex = plugin.rgb_to_hex.call(currentPicker,rgb.r,rgb.g,rgb.b);
                        $(currentPicker).trigger("preview.drawrpalette",hex);
                    } else if(mouse_data.x>plugin.pickerSize+5 && mouse_data.x<plugin.pickerSize+45 && mouse_data.y>0 && mouse_data.y<plugin.pickerSize){
                        currentPicker.slidingHue=true;
                        var hue=parseFloat(1/plugin.pickerSize)*(mouse_data.y);
                        currentPicker.hsv.h=hue;
                        plugin.update_color.call(currentPicker);
                        var rgb = plugin.hsv_to_rgb.call(currentPicker,currentPicker.hsv.h,currentPicker.hsv.s,currentPicker.hsv.v);
                        var hex = plugin.rgb_to_hex.call(currentPicker,rgb.r,rgb.g,rgb.b);
                        $(currentPicker).trigger("preview.drawrpalette",hex);
                    }
                    e.preventDefault();
                    e.stopPropagation();
                });
				currentPicker.$dropdown.hide();
               
                currentPicker.$button.on("mousedown.drawrpalette touchstart.drawrpalette",function(e){
                    currentPicker.slidingHue=false;
                    currentPicker.slidingHsl=false;

                    var elementLeft = currentPicker.$button.offset().left;
                    var elementRight = elementLeft + currentPicker.$dropdown.outerWidth();

                    var viewportLeft = $(window).scrollLeft();
                    var viewportRight = viewportLeft + $(window).width();

                    currentPicker.$dropdown.show();

                    if(elementRight < viewportRight){//falls within viewport in normal mode
                       // position normally     
                        currentPicker.$dropdown.offset({
                            "top" : currentPicker.$button.offset().top + currentPicker.$button.outerHeight(),
                            "left" : currentPicker.$button.offset().left
                        });                 
                    } else {
                        currentPicker.$dropdown.offset({
                           "top" : currentPicker.$button.offset().top + currentPicker.$button.outerHeight(),
                            "left" : currentPicker.$button.offset().left - currentPicker.$dropdown.outerWidth() + currentPicker.$button.outerWidth()
                        });
                    }

                    var rgb = plugin.hex_to_rgb($(currentPicker).val());
                    var hsv = plugin.rgb_to_hsv(rgb.r,rgb.g,rgb.b);
                    currentPicker.hsv = hsv;
                    plugin.update_color.call(currentPicker);
                    $(currentPicker).trigger("open.drawrpalette");
                    e.preventDefault();
                    e.stopPropagation();
                });

                currentPicker.paletteStart = function(){
                    if(currentPicker.$dropdown.is(":visible")){
                        plugin.cancel.call(currentPicker);
                        currentPicker.$dropdown.hide();
                        $(currentPicker).trigger("close.drawrpalette");    
                    }
                };
                $(window).bind("mousedown.drawrpalette touchstart.drawrpalette",currentPicker.paletteStart);
                currentPicker.paletteMove = function(e){
                    var ctx = currentPicker.$dropdown.find("canvas")[0].getContext("2d");
                    var mouse_data = plugin.get_mouse_value(e,currentPicker.$dropdown);                   
                    if(mouse_data.y>plugin.pickerSize) mouse_data.y=plugin.pickerSize;
                    if(mouse_data.y<0) mouse_data.y=0;
                    if(mouse_data.x<0) mouse_data.x=0;
                    if(currentPicker.slidingHsl==true){
                        if(mouse_data.x>plugin.pickerSize) mouse_data.x=plugin.pickerSize;
                        var hsv = plugin.xy_to_hsv(mouse_data.x,mouse_data.y);
                        currentPicker.hsv.s=hsv.s;
                        currentPicker.hsv.v=hsv.v;
                        plugin.update_color.call(currentPicker);
                        var rgb = plugin.hsv_to_rgb.call(currentPicker,currentPicker.hsv.h,currentPicker.hsv.s,currentPicker.hsv.v);
                        var hex = plugin.rgb_to_hex.call(currentPicker,rgb.r,rgb.g,rgb.b);
                        $(currentPicker).trigger("preview.drawrpalette",hex);
                    } else if(currentPicker.slidingHue==true){
                        var hue=parseFloat(1/plugin.pickerSize)*(mouse_data.y);
                        currentPicker.hsv.h=hue;
                        plugin.update_color.call(currentPicker);
                        var rgb = plugin.hsv_to_rgb.call(currentPicker,currentPicker.hsv.h,currentPicker.hsv.s,currentPicker.hsv.v);
                        var hex = plugin.rgb_to_hex.call(currentPicker,rgb.r,rgb.g,rgb.b);
                        $(currentPicker).trigger("preview.drawrpalette",hex);
                    }
                };
                $(window).bind("mousemove.drawrpalette touchmove.drawrpalette",currentPicker.paletteMove);
                currentPicker.paletteStop = function(e){
                    currentPicker.slidingHue=false;
                    currentPicker.slidingHsl=false;
                };
                $(window).bind("mouseup.drawrpalette touchend.drawrpalette",currentPicker.paletteStop);

                if($(this).val()!==""){
                    var rgb = plugin.hex_to_rgb($(this).val());
                    var hsv = plugin.rgb_to_hsv(rgb.r,rgb.g,rgb.b);
                    currentPicker.hsv = hsv;
                    plugin.update_color.call(currentPicker);
                } else {
                    currentPicker.hsv = { "h" : 0, "s" : 0, "v" : 0 };
                    $(this).val("#000000");
                    plugin.update_color.call(currentPicker);
                }

            }
		});
		return this;
 
    };

}( jQuery ));
