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

	//Default dropdown chrome, injected once and prepended to <head> so any later stylesheet
	//(Bootstrap's `.card`, or user overrides) wins the cascade by source order.
	var DEFAULT_STYLES_ID = 'drawrpallete-default-styles';
	var DEFAULT_STYLES =
		'.drawrpallete-dropdown{background:#eee;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);}';
	function injectDefaultStyles() {
		if (document.getElementById(DEFAULT_STYLES_ID)) return;
		var style = document.createElement('style');
		style.id = DEFAULT_STYLES_ID;
		style.appendChild(document.createTextNode(DEFAULT_STYLES));
		document.head.insertBefore(style, document.head.firstChild);
	}

	//layout constants; coordinates in update/hit-test paths are relative to the wrapper,
	//offset-adjusted by CONFIG.offset (the inner padding of the canvas artwork).
	var CONFIG = {
		offset: 5,
		pickerSize: 200,
		hueStripWidth: 40,
		hueStripGap: 5,
		alphaStripWidth: 40,
		alphaStripGap: 5,
		indicatorOuterH: 6,
		indicatorInnerH: 2,
		indicatorOverhang: 3,
		crosshairOuterR: 5,
		crosshairInnerR: 4,
		toolbarHeight: 40,
		buttonSize: 40
	};

	//CSS checkerboard used behind anything that can show transparency (swatch button).
	var CHECKERBOARD_CSS = {
		"background-image":
			"linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)," +
			"linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)",
		"background-size": "10px 10px",
		"background-position": "0 0, 5px 5px",
		"background-repeat": "repeat"
	};

	//Pure color math. Aliased onto `plugin` below for backwards-compat with external callers.
	var ColorMath = {
		rgb_to_hex: function(r, g, b) {
			return '#' + (0x1000000 + (b | (g << 8) | (r << 16))).toString(16).slice(1);
		},
		//accepts 6- or 8-char hex (with or without leading #); returns {r,g,b,a} or null. a defaults to 1.
		hex_to_rgb: function(hex) {
			if (typeof hex !== 'string') return null;
			var m8 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			if (m8) return {
				r: parseInt(m8[1], 16), g: parseInt(m8[2], 16),
				b: parseInt(m8[3], 16), a: parseInt(m8[4], 16) / 255
			};
			var m6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
			if (m6) return {
				r: parseInt(m6[1], 16), g: parseInt(m6[2], 16),
				b: parseInt(m6[3], 16), a: 1
			};
			return null;
		},
		hsv_to_rgb: function(h, s, v) {
			if (arguments.length === 1) { s = h.s; v = h.v; h = h.h; }
			var i = Math.floor(h * 6), f = h * 6 - i,
				p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s),
				ch = [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i % 6];
			return { r: Math.round(ch[0] * 255), g: Math.round(ch[1] * 255), b: Math.round(ch[2] * 255) };
		},
		rgb_to_hsv: function(r, g, b) {
			if (arguments.length === 1) { g = r.g; b = r.b; r = r.r; }
			var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min,
				s = (max === 0 ? 0 : d / max), v = max / 255, h;
			if	  (max === min) { h = 0; }
			else if (max === r)   { h = ((g - b) + d * (g < b ? 6 : 0)) / (6 * d); }
			else if (max === g)   { h = ((b - r) + d * 2) / (6 * d); }
			else				  { h = ((r - g) + d * 4) / (6 * d); }
			return { h: h, s: s, v: v };
		},
		rgb_to_hsl: function(r, g, b) {
			r /= 255; g /= 255; b /= 255;
			var max = Math.max(r, g, b), min = Math.min(r, g, b), h, s, l = (max + min) / 2;
			if (max === min) { h = s = 0; }
			else {
				var d = max - min;
				s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
				if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
				else if (max === g) h = (b - r) / d + 2;
				else                h = (r - g) / d + 4;
				h /= 6;
			}
			return { h: h, s: s, l: l };
		},
		hsv_to_xy: function(h, s, v) {
			return { x: s * CONFIG.pickerSize + CONFIG.offset, y: (1 - v) * CONFIG.pickerSize + CONFIG.offset };
		},
		xy_to_hsv: function(x, y) {
			return { s: x / CONFIG.pickerSize, v: (CONFIG.pickerSize - y) / CONFIG.pickerSize };
		},
		get_mouse_value: function(event, $relativeTo) {
			//pointer events only. touch/mouse are unified through pointer*.
			return {
				x: event.pageX - $relativeTo.offset().left - CONFIG.offset,
				y: event.pageY - $relativeTo.offset().top  - CONFIG.offset
			};
		},
		rgba_to_hex8: function(r, g, b, a) {
			var ah = Math.round(a * 255).toString(16);
			if (ah.length < 2) ah = '0' + ah;
			return ColorMath.rgb_to_hex(r, g, b) + ah;
		},
		//formats a color per `format`: "hex" | "hex8" | "rgba" | "hsla".
		format_color: function(rgb, alpha, format) {
			var a = +alpha.toFixed(3);
			if (format === 'hex8') return ColorMath.rgba_to_hex8(rgb.r, rgb.g, rgb.b, alpha);
			if (format === 'rgba') return 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' + a + ')';
			if (format === 'hsla') {
				var hsl = ColorMath.rgb_to_hsl(rgb.r, rgb.g, rgb.b);
				return 'hsla(' + Math.round(hsl.h * 360) + ', ' + Math.round(hsl.s * 100) + '%, ' + Math.round(hsl.l * 100) + '%, ' + a + ')';
			}
			return ColorMath.rgb_to_hex(rgb.r, rgb.g, rgb.b);
		}
	};

	$.fn.drawrpalette = function( action, param ) {

		var plugin = this;

		//backwards-compat aliases. External code may have reached into plugin.*; keep them
		//reachable with unchanged signatures even though internals use ColorMath directly.
		plugin.offset          = CONFIG.offset;
		plugin.pickerSize      = CONFIG.pickerSize;
		plugin.rgb_to_hex      = ColorMath.rgb_to_hex;
		plugin.hex_to_rgb      = ColorMath.hex_to_rgb;
		plugin.hsv_to_rgb      = ColorMath.hsv_to_rgb;
		plugin.rgb_to_hsv      = ColorMath.rgb_to_hsv;
		plugin.hsv_to_xy       = ColorMath.hsv_to_xy;
		plugin.xy_to_hsv       = ColorMath.xy_to_hsv;
		plugin.get_mouse_value = ColorMath.get_mouse_value;

		function dropdown_width(settings) {
			return CONFIG.pickerSize + CONFIG.hueStripGap + CONFIG.hueStripWidth
				 + (settings.enable_alpha ? CONFIG.alphaStripGap + CONFIG.alphaStripWidth : 0)
				 + CONFIG.offset * 2;
		}
		function dropdown_height(settings) {
			//when the toolbar is present we tuck it up by `offset` (see drawrpallete-toolbar
			//margin-top in buildDropdown) so the blank bottom-offset strip of the canvas isn't
			//visible as extra space above the buttons, so shorten the dropdown by the same amount.
			return CONFIG.pickerSize + CONFIG.offset * 2
				 + (settings.auto_apply ? 0 : CONFIG.toolbarHeight - CONFIG.offset);
		}

		//returns the color string currently represented by the picker's hsv+a, in the configured format.
		function current_string(picker) {
			var rgb = ColorMath.hsv_to_rgb(picker.hsv.h, picker.hsv.s, picker.hsv.v);
			return ColorMath.format_color(rgb, picker.hsv.a, picker.settings.format);
		}

		//redraws the HSV square, hue strip, optional alpha strip, and indicators onto the cached ctx.
		function draw_canvas(picker) {
			var hsv = picker.hsv, ctx = picker.ctx,
				size = CONFIG.pickerSize,
				hueX = CONFIG.offset + size + CONFIG.hueStripGap,
				alphaX = hueX + CONFIG.hueStripWidth + CONFIG.alphaStripGap,
				rgb, grad, ay, fullRgb;

			ctx.clearRect(0, 0, dropdown_width(picker.settings), CONFIG.pickerSize + CONFIG.offset * 2);

			//saturation/value square: pure-hue base + horizontal white→transparent + vertical transparent→black.
			//Two layered gradients render in three draw calls with no inter-row seams.
			rgb = ColorMath.hsv_to_rgb(hsv.h, 1, 1);
			ctx.fillStyle = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
			ctx.fillRect(CONFIG.offset, CONFIG.offset, size, size);

			grad = ctx.createLinearGradient(CONFIG.offset, 0, CONFIG.offset + size, 0);
			grad.addColorStop(0, 'rgba(255,255,255,1)');
			grad.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = grad;
			ctx.fillRect(CONFIG.offset, CONFIG.offset, size, size);

			grad = ctx.createLinearGradient(0, CONFIG.offset, 0, CONFIG.offset + size);
			grad.addColorStop(0, 'rgba(0,0,0,0)');
			grad.addColorStop(1, 'rgba(0,0,0,1)');
			ctx.fillStyle = grad;
			ctx.fillRect(CONFIG.offset, CONFIG.offset, size, size);

			//hue strip: single vertical gradient with 7 stops (0, 60, 120, 180, 240, 300, 360).
			grad = ctx.createLinearGradient(0, CONFIG.offset, 0, CONFIG.offset + size);
			for (var hi = 0; hi <= 6; hi++) {
				grad.addColorStop(hi / 6, 'hsl(' + (hi * 60) + ', 100%, 50%)');
			}
			ctx.fillStyle = grad;
			ctx.fillRect(hueX, CONFIG.offset, CONFIG.hueStripWidth, size);

			//hue indicator bar
			ctx.fillStyle = 'black';
			ctx.fillRect(hueX - CONFIG.indicatorOverhang,
						 CONFIG.offset + (hsv.h * size) - (CONFIG.indicatorOuterH / 2),
						 CONFIG.hueStripWidth + CONFIG.indicatorOverhang * 2,
						 CONFIG.indicatorOuterH);
			ctx.fillStyle = 'white';
			ctx.fillRect(hueX,
						 CONFIG.offset + (hsv.h * size) - (CONFIG.indicatorInnerH / 2),
						 CONFIG.hueStripWidth,
						 CONFIG.indicatorInnerH);

			//alpha strip
			if (picker.settings.enable_alpha) {
				//checkerboard background (5px × 5px cells, 8 columns × 40 rows)
				var cellSize = 5, cols = CONFIG.alphaStripWidth / cellSize;
				for (var ry = 0; ry < size; ry += cellSize) {
					for (var cx = 0; cx < cols; cx++) {
						ctx.fillStyle = (((cx + Math.floor(ry / cellSize)) % 2) === 0) ? '#ccc' : '#fff';
						ctx.fillRect(alphaX + cx * cellSize,
									 CONFIG.offset + ry,
									 cellSize,
									 Math.min(cellSize, size - ry));
					}
				}
				//vertical gradient transparent → opaque of the current fully-saturated color
				fullRgb = ColorMath.hsv_to_rgb(hsv.h, hsv.s, hsv.v);
				grad = ctx.createLinearGradient(0, CONFIG.offset, 0, CONFIG.offset + size);
				grad.addColorStop(0, 'rgba(' + fullRgb.r + ',' + fullRgb.g + ',' + fullRgb.b + ',0)');
				grad.addColorStop(1, 'rgba(' + fullRgb.r + ',' + fullRgb.g + ',' + fullRgb.b + ',1)');
				ctx.fillStyle = grad;
				ctx.fillRect(alphaX, CONFIG.offset, CONFIG.alphaStripWidth, size);

				//alpha indicator bar
				ay = CONFIG.offset + (hsv.a * size);
				ctx.fillStyle = 'black';
				ctx.fillRect(alphaX - CONFIG.indicatorOverhang,
							 ay - (CONFIG.indicatorOuterH / 2),
							 CONFIG.alphaStripWidth + CONFIG.indicatorOverhang * 2,
							 CONFIG.indicatorOuterH);
				ctx.fillStyle = 'white';
				ctx.fillRect(alphaX,
							 ay - (CONFIG.indicatorInnerH / 2),
							 CONFIG.alphaStripWidth,
							 CONFIG.indicatorInnerH);
			}

			//crosshair
			var pos = ColorMath.hsv_to_xy(hsv.h, hsv.s, hsv.v);
			ctx.beginPath(); ctx.lineWidth = 3; ctx.strokeStyle = 'black';
			ctx.arc(pos.x, pos.y, CONFIG.crosshairOuterR, 0, 2 * Math.PI); ctx.stroke();
			ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = 'white';
			ctx.arc(pos.x, pos.y, CONFIG.crosshairInnerR, 0, 2 * Math.PI); ctx.stroke();
		}

		//legacy alias: draw_hsv(size, canvas) with `this` = picker. Size arg is ignored (uses CONFIG).
		plugin.draw_hsv = function(size, canvas) {
			var picker = this;
			if (!picker.ctx && canvas)    picker.ctx = canvas.getContext('2d');
			if (!picker.$canvas && canvas) picker.$canvas = $(canvas);
			draw_canvas(picker);
		};

		function update_color(picker) {
			var rgb = ColorMath.hsv_to_rgb(picker.hsv.h, picker.hsv.s, picker.hsv.v);
			var swatch = picker.settings.enable_alpha
				? 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + picker.hsv.a + ')'
				: 'rgb('  + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
			picker.$button.css('background-color', swatch);
			picker.$button.attr('title', current_string(picker));
			draw_canvas(picker);
		}
		plugin.update_color = function() { update_color(this); };

		function update_value(picker) {
			$(picker).val(current_string(picker));
		}
		plugin.update_value = function() { update_value(this); };

		function trigger_preview(picker) {
			$(picker).trigger('preview.drawrpalette', current_string(picker));
		}
		plugin.trigger_preview = trigger_preview;

		function cancel_picker(picker) {
			var parsed = ColorMath.hex_to_rgb($(picker).val());
			if (parsed) {
				picker.hsv = ColorMath.rgb_to_hsv(parsed.r, parsed.g, parsed.b);
				picker.hsv.a = parsed.a;
			}
			update_color(picker);
			$(picker).trigger('cancel.drawrpalette', $(picker).val());
		}
		plugin.cancel = function() { cancel_picker(this); };

		//records a binding on the picker so destroy can iterate-unbind instead of hand-enumerating.
		function bind(picker, $target, events, handler) {
			$target.on(events, handler);
			picker._bindings.push({ $target: $target, events: events, handler: handler });
		}

		function open_dropdown(picker) {
			picker.slidingHue = picker.slidingHsl = picker.slidingAlpha = false;
			picker.$dropdown.show();
			picker.$button.attr('aria-expanded', 'true');

			var bLeft    = picker.$button.offset().left,
				bTop     = picker.$button.offset().top,
				bBottom  = bTop + picker.$button.outerHeight(),
				dW       = picker.$dropdown.outerWidth(),
				dH       = picker.$dropdown.outerHeight(),
				vpRight  = $(window).scrollLeft() + $(window).width(),
				vpBottom = $(window).scrollTop() + $(window).height(),
				left     = (bLeft + dW < vpRight) ? bLeft : bLeft - dW + picker.$button.outerWidth(),
				top      = (bBottom + dH < vpBottom) ? bBottom : Math.max(0, bTop - dH);
			picker.$dropdown.offset({ top: top, left: left });

			var rgb = ColorMath.hex_to_rgb($(picker).val());
			if (rgb) {
				picker.hsv = ColorMath.rgb_to_hsv(rgb.r, rgb.g, rgb.b);
				picker.hsv.a = rgb.a;
			} else {
				console.error('drawrpalette: current input value "' + $(picker).val() + '" is not a parseable hex. Keeping previous state.');
			}
			update_color(picker);
			$(picker).trigger('open.drawrpalette');
		}

		function close_dropdown(picker, returnFocusToSwatch) {
			picker.$dropdown.hide();
			picker.$button.attr('aria-expanded', 'false');
			if (returnFocusToSwatch) picker.$button.trigger('focus');
			$(picker).trigger('close.drawrpalette');
		}

		function commit(picker) {
			update_value(picker);
			$(picker).trigger('choose.drawrpalette', $(picker).val());
		}

		function captureInlineStyles(el) {
			var inlineStyles = {},
				inlineClasses = el.className !== '' ? el.className.split(' ') : [];
			for (var i = 0, l = el.style.length; i < l; i++) {
				var prop = el.style[i];
				inlineStyles[prop] = getComputedStyle(el, null).getPropertyValue(prop);
			}
			return { styles: inlineStyles, classes: inlineClasses };
		}

		function buildSwatchButton(picker, inline) {
			var $btn = $('<button type="button">&nbsp;</button>').css({
				"width":			CONFIG.buttonSize + "px",
				"height":			CONFIG.buttonSize + "px",
				"border":			"2px solid #ccc",
				"background-color":	"#eee",
				"cursor":			"pointer",
				"text-align":		"center",
				"padding":			"0",
				"font-size":		"2em",
				"border-radius":	"4px",
				"box-sizing":		"border-box",
				"transition":		"border-color 0.15s, box-shadow 0.15s",
				"outline":			"none"
			});
			if (picker.settings.enable_alpha) $btn.css(CHECKERBOARD_CSS);
			$btn.css(inline.styles).attr({
				"aria-haspopup":	"dialog",
				"aria-expanded":	"false",
				"aria-label":		picker.settings.aria_label || "Pick color"
			});
			$.each(inline.classes, function(i, cls) { if (cls) $btn.addClass(cls); });
			return $btn;
		}

		function buildDropdown(picker) {
			var settings = picker.settings,
				cW       = dropdown_width(settings),
				cH       = dropdown_height(settings),
				canvasH  = CONFIG.pickerSize + CONFIG.offset * 2,
				dpr      = window.devicePixelRatio || 1;

			//`card` is a no-op without Bootstrap; `drawrpallete-dropdown` is the hook for
			//custom/default styling since we no longer hard-code background/border/shadow inline.
			var $dd = $('<div class="drawrpallete-dropdown card" role="dialog" aria-label="Color picker" tabindex="-1">' +
				'<canvas class="drawrpallete-canvas" tabindex="0" role="application" ' +
				'aria-label="Saturation, value, and hue selector"></canvas></div>');
			var $canvas = $dd.find('canvas');

			$canvas.attr({ width: cW * dpr, height: canvasH * dpr })
				   .css({ display: 'block', width: cW + 'px', height: canvasH + 'px' });

			if (!settings.auto_apply) {
				//flex layout centers buttons of any height (native, Bootstrap btn-sm, etc.) inside the
				//toolbar strip, so neither overflow nor flush-to-edge when one or the other is styled.
				$dd.append(
					'<div class="drawrpallete-toolbar" ' +
						'style="height:' + CONFIG.toolbarHeight + 'px;display:flex;' +
						'align-items:center;justify-content:flex-end;gap:5px;' +
						'margin-top:-' + CONFIG.offset + 'px;' +
						'padding:0px 8px;box-sizing:border-box;">' +
					'<button type="button" class="cancel btn btn-sm btn-secondary">cancel</button>' +
					'<button type="button" class="ok btn btn-sm btn-primary">ok</button>' +
					'</div>'
				);
			}
			$dd.css({
				"width":         cW + "px",
				"height":        cH + "px",
				"position":      "absolute",
				"z-index":       8,
				"box-sizing":    "border-box"
			}).hide();

			picker.$dropdown = $dd;
			picker.$canvas   = $canvas;
			picker.ctx       = $canvas[0].getContext('2d');
			if (dpr !== 1) picker.ctx.scale(dpr, dpr);
		}

		//returns 'sv' | 'hue' | 'alpha' | null for offset-adjusted pointer coords.
		function hit_test(picker, m) {
			var size       = CONFIG.pickerSize,
				hueStart   = size + CONFIG.hueStripGap,
				hueEnd     = hueStart + CONFIG.hueStripWidth,
				alphaStart = hueEnd + CONFIG.alphaStripGap,
				alphaEnd   = alphaStart + CONFIG.alphaStripWidth;
			if (m.y < 0 || m.y > size) return null;
			if (m.x >= 0 && m.x <= size) return 'sv';
			if (m.x >= hueStart && m.x <= hueEnd) return 'hue';
			if (picker.settings.enable_alpha && m.x >= alphaStart && m.x <= alphaEnd) return 'alpha';
			return null;
		}

		function apply_region(picker, region, m) {
			var size = CONFIG.pickerSize;
			m.y = Math.max(0, Math.min(m.y, size));
			if (region === 'sv') {
				m.x = Math.max(0, Math.min(m.x, size));
				var sv = ColorMath.xy_to_hsv(m.x, m.y);
				picker.hsv.s = sv.s;
				picker.hsv.v = sv.v;
			} else if (region === 'hue') {
				picker.hsv.h = m.y / size;
			} else if (region === 'alpha') {
				picker.hsv.a = m.y / size;
			}
			update_color(picker);
			trigger_preview(picker);
		}

		function bindCanvasEvents(picker) {
			//prevent touch scroll from bubbling to the window close-on-outside handler.
			bind(picker, picker.$dropdown, 'touchstart.drawrpalette', function(e) {
				e.preventDefault(); e.stopPropagation();
			});

			bind(picker, picker.$dropdown, 'pointerdown.drawrpalette', function(e) {
				var m = ColorMath.get_mouse_value(e, picker.$dropdown);
				var region = hit_test(picker, m);
				if (region === 'sv')         picker.slidingHsl   = true;
				else if (region === 'hue')   picker.slidingHue   = true;
				else if (region === 'alpha') picker.slidingAlpha = true;
				if (region) apply_region(picker, region, m);
				picker.$canvas.trigger('focus');
				e.preventDefault(); e.stopPropagation();
			});

			//auto_apply commits on pointerup-within-region only, not pointerdown, to avoid double-firing.
			//Only an sv-square release auto-closes; hue/alpha-only drags commit but keep the dropdown
			//open so the user can continue picking against the newly chosen hue or alpha.
			bind(picker, picker.$dropdown, 'pointerup.drawrpalette', function() {
				var wasSv = picker.slidingHsl;
				var wasDragging = picker.slidingHsl || picker.slidingHue || picker.slidingAlpha;
				picker.slidingHsl = picker.slidingHue = picker.slidingAlpha = false;
				if (picker.settings.auto_apply && wasDragging) {
					commit(picker);
					if (wasSv) close_dropdown(picker, true);
				}
			});
		}

		function bindOkCancel(picker) {
			if (picker.settings.auto_apply) return;
			var $ok     = picker.$dropdown.find('.ok'),
				$cancel = picker.$dropdown.find('.cancel');
			bind(picker, $ok, 'pointerup.drawrpalette', function() {
				commit(picker);
				close_dropdown(picker, true);
			});
			bind(picker, $cancel, 'pointerup.drawrpalette', function() {
				cancel_picker(picker);
				close_dropdown(picker, true);
			});
		}

		function bindWindowEvents(picker) {
			picker.paletteStart = function(e) {
				if (!picker.$dropdown.is(':visible')) return;
				//don't close when the click originated inside our own wrapper (swatch, dropdown, toolbar).
				if (picker.$wrapper[0].contains(e.target)) return;
				cancel_picker(picker);
				close_dropdown(picker, false);
			};
			picker.paletteMove = function(e) {
				if (!picker.slidingHsl && !picker.slidingHue && !picker.slidingAlpha) return;
				var m = ColorMath.get_mouse_value(e, picker.$dropdown);
				var region = picker.slidingHsl ? 'sv' : (picker.slidingHue ? 'hue' : 'alpha');
				apply_region(picker, region, m);
				if (picker.settings.auto_apply) commit(picker);
			};
			picker.paletteStop = function() {
				picker.slidingHue = picker.slidingHsl = picker.slidingAlpha = false;
			};
			$(window).on('pointerdown.drawrpalette', picker.paletteStart);
			$(window).on('pointermove.drawrpalette', picker.paletteMove);
			$(window).on('pointerup.drawrpalette',   picker.paletteStop);
		}

		function bindSwatch(picker) {
			bind(picker, picker.$button, 'pointerdown.drawrpalette', function(e) {
				open_dropdown(picker);
				e.preventDefault(); e.stopPropagation();
			});
			bind(picker, picker.$button, 'mouseenter.drawrpalette focus.drawrpalette', function() {
				picker.$button.css({ 'border-color': '#2684ff', 'box-shadow': '0 0 0 3px rgba(38,132,255,0.2)' });
			});
			bind(picker, picker.$button, 'mouseleave.drawrpalette blur.drawrpalette', function() {
				picker.$button.css({ 'border-color': '#ccc', 'box-shadow': 'none' });
			});
		}

		function bindKeyboard(picker) {
			//open dropdown from swatch via Enter/Space; pointerdown already preventDefaults click
			//so we explicitly handle keyboard activation.
			bind(picker, picker.$button, 'keydown.drawrpalette', function(e) {
				if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
					e.preventDefault();
					open_dropdown(picker);
					picker.$canvas.trigger('focus');
				}
			});

			bind(picker, picker.$canvas, 'keydown.drawrpalette', function(e) {
				var svStep = 1 / 50, hStep = 1 / 360, aStep = 1 / 50, handled = true;
				if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
					if (e.shiftKey) {
						var dir = (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 1;
						picker.hsv.h = Math.max(0, Math.min(1, picker.hsv.h + dir * hStep));
					} else if (e.altKey && picker.settings.enable_alpha) {
						var adir = (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? 1 : -1;
						picker.hsv.a = Math.max(0, Math.min(1, picker.hsv.a + adir * aStep));
					} else if (e.key === 'ArrowLeft')       picker.hsv.s = Math.max(0, picker.hsv.s - svStep);
					else      if (e.key === 'ArrowRight')   picker.hsv.s = Math.min(1, picker.hsv.s + svStep);
					else      if (e.key === 'ArrowDown')    picker.hsv.v = Math.max(0, picker.hsv.v - svStep);
					else      if (e.key === 'ArrowUp')      picker.hsv.v = Math.min(1, picker.hsv.v + svStep);
					update_color(picker);
					trigger_preview(picker);
					if (picker.settings.auto_apply) commit(picker);
				} else if (e.key === 'Escape') {
					cancel_picker(picker);
					close_dropdown(picker, true);
				} else if (e.key === 'Enter' && !picker.settings.auto_apply) {
					commit(picker);
					close_dropdown(picker, true);
				} else {
					handled = false;
				}
				if (handled) e.preventDefault();
			});

			//focus trap within the dropdown (only meaningful when toolbar buttons exist).
			bind(picker, picker.$dropdown, 'keydown.drawrpalette', function(e) {
				if (e.key !== 'Tab' || picker.settings.auto_apply) return;
				var focusables = picker.$dropdown.find('canvas, button').toArray();
				if (focusables.length < 2) return;
				var idx = focusables.indexOf(document.activeElement);
				if (e.shiftKey && idx <= 0) {
					e.preventDefault();
					focusables[focusables.length - 1].focus();
				} else if (!e.shiftKey && idx === focusables.length - 1) {
					e.preventDefault();
					focusables[0].focus();
				}
			});
		}

		function initFromValue(picker) {
			var val = $(picker).val();
			if (val !== '') {
				var rgb = ColorMath.hex_to_rgb(val);
				if (rgb) {
					picker.hsv = ColorMath.rgb_to_hsv(rgb.r, rgb.g, rgb.b);
					picker.hsv.a = rgb.a;
					return;
				}
				console.error('drawrpalette: invalid initial value "' + val + '", defaulting to black.');
			}
			picker.hsv = { h: 0, s: 0, v: 0, a: 1 };
			$(picker).val(current_string(picker));
		}

		this.each(function() {

			var currentPicker = this;

			if (action === "destroy") {
				if (!$(currentPicker).hasClass("active-drawrpalette")) {
					console.error("The element you are running this command on is not a drawrpalette.");
					return false;
				}
				if (currentPicker._bindings) {
					for (var bi = 0; bi < currentPicker._bindings.length; bi++) {
						var b = currentPicker._bindings[bi];
						b.$target.off(b.events, b.handler);
					}
				}
				$(window).off("pointerdown.drawrpalette", currentPicker.paletteStart);
				$(window).off("pointermove.drawrpalette", currentPicker.paletteMove);
				$(window).off("pointerup.drawrpalette",   currentPicker.paletteStop);
				$(currentPicker).show();
				currentPicker.$button.remove();
				currentPicker.$dropdown.remove();
				$(currentPicker).unwrap();
				delete currentPicker.$wrapper;
				delete currentPicker.$button;
				delete currentPicker.$dropdown;
				delete currentPicker.$canvas;
				delete currentPicker.ctx;
				delete currentPicker.hsv;
				delete currentPicker.slidingHue;
				delete currentPicker.slidingHsl;
				delete currentPicker.slidingAlpha;
				delete currentPicker.paletteStart;
				delete currentPicker.paletteMove;
				delete currentPicker.paletteStop;
				delete currentPicker._bindings;
				delete currentPicker.settings;
				$(currentPicker).removeClass("active-drawrpalette");
				return;
			}

			if (action === "set") {
				if (!$(currentPicker).hasClass("active-drawrpalette")) {
					console.error("The element you are running this command on is not a drawrpalette.");
					return false;
				}
				var setRgb = ColorMath.hex_to_rgb(param);
				if (!setRgb) {
					console.error('drawrpalette: "' + param + '" is not a valid hex color.');
					return;
				}
				currentPicker.hsv = ColorMath.rgb_to_hsv(setRgb.r, setRgb.g, setRgb.b);
				currentPicker.hsv.a = setRgb.a;
				$(currentPicker).val(current_string(currentPicker));
				update_color(currentPicker);
				return;
			}

			if (typeof action !== "object" && typeof action !== "undefined") return;

			//prevent double-init
			if ($(currentPicker).hasClass("active-drawrpalette")) return;

			injectDefaultStyles();

			var inline = captureInlineStyles(currentPicker);
			$(currentPicker).addClass("active-drawrpalette");

			var opts = typeof action === "object" ? action : {};
			var settings = $.extend({
				enable_alpha: false,
				append_to:    currentPicker,
				auto_apply:   false,
				aria_label:   null,
				format:       null
			}, opts);
			if (!settings.format) settings.format = settings.enable_alpha ? 'hex8' : 'hex';

			currentPicker.settings   = settings;
			currentPicker.plugin     = plugin;
			currentPicker._bindings  = [];

			//wrap the input
			$(currentPicker).wrap("<div class='drawrpallete-wrapper'></div>").hide();
			currentPicker.$wrapper = $(currentPicker).parent().css({ position: "relative", display: "inline-block" });

			currentPicker.$button = buildSwatchButton(currentPicker, inline);
			currentPicker.$wrapper.append(currentPicker.$button);

			buildDropdown(currentPicker);
			currentPicker.$wrapper.append(currentPicker.$dropdown);

			bindCanvasEvents(currentPicker);
			bindOkCancel(currentPicker);
			bindSwatch(currentPicker);
			bindKeyboard(currentPicker);
			bindWindowEvents(currentPicker);

			initFromValue(currentPicker);
			update_color(currentPicker);
		});

		return this;
	};

}( jQuery ));

  return $;
}));