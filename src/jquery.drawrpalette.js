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