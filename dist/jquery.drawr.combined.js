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

	var DRAWR_VERSION = "1.0.4";

	//inject global stylesheet once per page load. provides :active press-feedback for
	//toolbox buttons and tool buttons (tactile feedback on both desktop and touch).
	function _drawrInjectStyle(){
		if(document.getElementById("drawr-global-style")) return;
		var css = [
			".drawr-toolwindow-btn{transition:transform 60ms ease-out,box-shadow 80ms ease-out,background 80ms ease-out;}",
			".drawr-toolwindow-btn:active{transform:translateY(1px);background:linear-gradient(to bottom,rgba(0,0,0,0.25) 0%,rgba(255,255,255,0.05) 100%) !important;box-shadow:inset 0 1px 3px rgba(0,0,0,0.35) !important;}",
			".drawr-tool-btn{transition:filter 80ms ease-out,box-shadow 80ms ease-out;}",
			".drawr-tool-btn:active{filter:brightness(0.82);box-shadow:inset 0 1px 4px rgba(0,0,0,0.35);}",
			".drawr-layer-row .layer-vis:active,.drawr-layer-row .layer-moveup:active,.drawr-layer-row .layer-movedown:active,.drawr-layer-row .layer-delete:active{filter:brightness(1.4);}"
		].join("\n");
		var s = document.createElement("style");
		s.id = "drawr-global-style";
		s.type = "text/css";
		s.appendChild(document.createTextNode(css));
		(document.head || document.documentElement).appendChild(s);
	}
	_drawrInjectStyle();

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
		//pressure is reshaped as `pow(pressure, gamma)` where gamma is a global user-adjustable curve
		//(see plugin.read_pressure_curve). gamma<1 boosts low pressure so gentle stylus strokes (Apple
		//Pencil resting pressure sits around 0.2-0.3) reach a useful fraction of the base; gamma=1 is
		//linear; gamma>1 requires a firmer press.
		//Size and alpha handle pressure differently on purpose. Alpha has a natural ceiling of 1,
		//so `brushAlpha * pow(pressure, gamma)` gives a well-shaped 0..target sweep. Size has no
		//such ceiling, and treating `size` as a max with a 1 px floor made the dynamic range
		//proportional to size (tiny at small sizes, huge at large). Instead: `size` is the base /
		//low-pressure value (what draws on a pressureless device), and `size_max` is the absolute
		//pixel size at full press. Pressure interpolates: size + (size_max - size) * shaped.
		//If size_max < size we clamp to size (no growth) so users can't accidentally invert it.
		plugin.calc_brush_params = function(brush, brushSize, brushAlpha, pressure, pen_pressure){
			var gamma  = plugin.read_pressure_curve();
			var shaped = Math.pow(pressure, gamma);
			var alpha  = (brush.pressure_affects_alpha && pen_pressure) ? Math.min(1, brushAlpha * shaped) : brushAlpha;
			var size;
			if(brush.pressure_affects_size){
				var maxSize = (typeof brush.size_max === "number") ? brush.size_max : brushSize;
				if(maxSize < brushSize) maxSize = brushSize;
				//No pen pressure → base size, no growth. On stylus, pressure lerps from size→size_max.
				var sizePressure = pen_pressure ? pressure : 0;
				var sizeShaped   = Math.pow(sizePressure, gamma);
				size = Math.max(0.5, brushSize + (maxSize - brushSize) * sizeShaped);
			}else{
				size = brushSize;
			}
			return { alpha: alpha, size: parseFloat(size) };
		};

		//returns the CSS transform string shared by the canvas and background canvas.
		plugin.canvas_transform = function(x, y, angle){
			return "translate(" + -x + "px," + -y + "px) rotate(" + angle + "rad)";
		};

		//---- Layers -----------------------------------------------------------------------
		//Multi-layer support. Layer 0 is the main <canvas> element itself; additional layers
		//are sibling <canvas> elements added into the drawr-container. The browser composites
		//them via CSS mix-blend-mode on the GPU, so drawing still targets exactly one context
		//per stroke — perf is unchanged vs. single-canvas mode.
		//
		//Blending scope: multiply reaches through transparent regions of layers below to
		//$bgCanvas (checkerboard or solid paper). This is intentional (cheap + correct for
		//solid paper) — export compositing in JS ignores $bgCanvas so saved output is clean.
		plugin.MAX_LAYERS = 3;

		//Supported layer blend modes. The name is used both as the CSS mix-blend-mode
		//value (for on-screen compositing) and the canvas globalCompositeOperation
		//(for export). All listed values are spec-supported in both domains.
		plugin.BLEND_MODES = [
			{ value: "normal",   label: "Normal"   },
			{ value: "multiply", label: "Multiply" },
			{ value: "screen",   label: "Screen"   },
			{ value: "overlay",  label: "Overlay"  },
			{ value: "darken",   label: "Darken"   },
			{ value: "lighten",  label: "Lighten"  }
		];
		plugin._blendCssValue = function(mode){
			for(var i = 0; i < plugin.BLEND_MODES.length; i++){
				if(plugin.BLEND_MODES[i].value === mode) return mode;
			}
			return "normal";
		};

		//returns the 2D context of the currently-active layer. safe to call repeatedly; the
		//browser caches getContext on a given canvas, so a fresh call per spot is free.
		plugin.active_context = function(){
			var layer = this.layers[this.activeLayerIndex];
			return layer.canvas.getContext("2d", { alpha: true });
		};

		//resolves a stable layer id to its current array index. undo records use ids so that
		//reorder/delete don't invalidate history. returns -1 if the layer no longer exists.
		plugin.resolve_layer_by_id = function(id){
			if(!this.layers) return -1;
			for(var i = 0; i < this.layers.length; i++){
				if(this.layers[i].id === id) return i;
			}
			return -1;
		};

		//returns id of the currently-active layer.
		plugin.active_layer_id = function(){
			return this.layers[this.activeLayerIndex].id;
		};

		//apply this instance's transform + zoom-scaled CSS size to every layer canvas and $bgCanvas.
		//called from apply_scroll/apply_rotation/apply_zoom so multi-layer stays in perfect alignment.
		plugin.broadcast_transform = function(){
			var self = this;
			var transform = plugin.canvas_transform(self.scrollX || 0, self.scrollY || 0, self.rotationAngle || 0);
			$(self).css("transform", transform);
			if(self.layers){
				//iterate all layers — the main canvas may sit at any array position after
				//move_layer_down, so we can't skip index 0. Re-applying the transform to the
				//main canvas's own $el is a harmless no-op.
				for(var i = 0; i < self.layers.length; i++){
					self.layers[i].$el.css("transform", transform);
				}
			}
			if(self.$bgCanvas) self.$bgCanvas.css("transform", transform);
		};

		//mirror the main canvas's zoomed CSS display size onto every layer canvas.
		plugin.broadcast_zoom_css = function(){
			var self = this;
			if(!self.layers) return;
			var zoom = self.zoomFactor || 1;
			//same reason as broadcast_transform — the main canvas may be at any index.
			for(var i = 0; i < self.layers.length; i++){
				self.layers[i].$el.width(self.width * zoom);
				self.layers[i].$el.height(self.height * zoom);
			}
		};

		//Create a new layer canvas as a sibling of the main canvas inside the drawr-container.
		//pixel dimensions match self.width x self.height; CSS display size tracks zoom.
		//the new layer is inserted at array index 0 (bottom of the stack / bottom of the
		//layers panel) — feels more natural than appearing above existing artwork and
		//immediately obscuring it. z-index is re-applied by restack_layers. opacity/
		//visibility/mix-blend-mode applied per mode.
		plugin.add_layer = function(mode, name){
			var self = this;
			if(self.layers.length >= plugin.MAX_LAYERS) return null;
			mode = mode || "normal";
			var c = document.createElement("canvas");
			c.width = self.width;
			c.height = self.height;
			var $c = $(c);
			$c.addClass("drawr-layer");
			$c.css({
				"position": "absolute",
				"top": 0, "left": 0,
				"pointer-events": "none",
				"width": (self.width * (self.zoomFactor || 1)) + "px",
				"height": (self.height * (self.zoomFactor || 1)) + "px",
				"transform-origin": "50% 50%",
				"transform": plugin.canvas_transform(self.scrollX || 0, self.scrollY || 0, self.rotationAngle || 0),
				"mix-blend-mode": plugin._blendCssValue(mode),
				"opacity": 1
			});
			//place below the current bottom layer in the DOM. z-index (set by restack_layers)
			//is authoritative for stacking, so DOM order is cosmetic — we still mirror it.
			$c.insertBefore(self.layers[0].$el);
			var layer = {
				id: self._nextLayerId++,
				canvas: c,
				$el: $c,
				name: name || "New layer",
				mode: mode,
				visible: true,
				opacity: 1,
				history_trimmed: false
			};
			self.layers.unshift(layer);
			//existing active-layer pointer now refers to a layer one slot higher in the array.
			if(typeof self.activeLayerIndex === "number") self.activeLayerIndex++;
			plugin.restack_layers.call(self);
			return layer;
		};

		//re-apply z-indices to match current array order. called after add/delete/reorder.
		plugin.restack_layers = function(){
			var self = this;
			for(var i = 0; i < self.layers.length; i++){
				self.layers[i].$el.css("z-index", 1 + i);
			}
		};

		//delete a layer. guaranteed to leave at least one layer standing.
		//special case: if the targeted layer happens to use the main canvas DOM element
		//(which can't be removed from the page), we instead copy an adjacent layer's pixels
		//into the main canvas and delete that adjacent layer. the main canvas adopts the
		//adjacent layer's id/name/mode/opacity — so from the user's perspective, the layer
		//they clicked delete on really is gone, and the neighbour now sits on the main canvas.
		plugin.delete_layer = function(index){
			var self = this;
			if(self.layers.length <= 1) return;
			if(index < 0 || index >= self.layers.length) return;
			var target = self.layers[index];
			if(target.canvas === self){
				//pick a donor — prefer the layer directly above; fall back to the one below.
				var donorIdx = (index + 1 < self.layers.length) ? index + 1 : index - 1;
				var donor = self.layers[donorIdx];
				var mctx = target.canvas.getContext("2d", { alpha: true });
				mctx.globalCompositeOperation = "source-over";
				mctx.globalAlpha = 1;
				mctx.clearRect(0, 0, self.width, self.height);
				mctx.drawImage(donor.canvas, 0, 0);
				//main canvas adopts donor's identity so undo entries keyed by the donor's id
				//continue to work (they now restore to the main canvas). the original target
				//layer's id is abandoned — its undo entries get skipped by resolve_layer_by_id.
				target.id = donor.id;
				target.name = donor.name;
				target.mode = donor.mode;
				target.visible = donor.visible;
				target.opacity = donor.opacity;
				target.history_trimmed = !!donor.history_trimmed;
				//apply the adopted CSS state to the main canvas.
				target.$el.css("mix-blend-mode", plugin._blendCssValue(donor.mode));
				target.$el.css("opacity", donor.opacity);
				target.$el.css("display", donor.visible ? "" : "none");
				//remove the donor.
				donor.$el.remove();
				self.layers.splice(donorIdx, 1);
				//active pointer: if donor was active, main canvas now holds its data — point at main.
				if(self.activeLayerIndex === donorIdx) self.activeLayerIndex = self.layers.indexOf(target);
				else if(self.activeLayerIndex > donorIdx) self.activeLayerIndex--;
			} else {
				//simple case — detach the DOM element and splice out.
				target.$el.remove();
				self.layers.splice(index, 1);
				if(self.activeLayerIndex > index) self.activeLayerIndex--;
				else if(self.activeLayerIndex === index){
					if(self.activeLayerIndex >= self.layers.length) self.activeLayerIndex = self.layers.length - 1;
				}
			}
			if(self.activeLayerIndex < 0) self.activeLayerIndex = 0;
			plugin.restack_layers.call(self);
		};

		//swap layer at index with the one below it (index-1). covers "move up" by symmetry.
		//the main canvas element can sit at any array position — z-index handles stacking
		//regardless of which canvas is position:relative vs absolute.
		plugin.move_layer_down = function(index){
			var self = this;
			if(index < 1 || index >= self.layers.length) return;
			var tmp = self.layers[index];
			self.layers[index] = self.layers[index - 1];
			self.layers[index - 1] = tmp;
			//keep DOM order in sync with array order (cosmetic — z-index is authoritative).
			tmp.$el.insertBefore(self.layers[index].$el);
			if(self.activeLayerIndex === index) self.activeLayerIndex = index - 1;
			else if(self.activeLayerIndex === index - 1) self.activeLayerIndex = index;
			plugin.restack_layers.call(self);
		};

		plugin.set_active_layer = function(index){
			var self = this;
			if(index < 0 || index >= self.layers.length) return;
			self.activeLayerIndex = index;
		};

		plugin.set_layer_mode = function(index, mode){
			var self = this;
			if(index < 0 || index >= self.layers.length) return;
			self.layers[index].mode = mode;
			//apply to every layer including the main canvas — multiply on the bottom-most
			//layer is a no-op visually (nothing below to blend with), but after reorder any
			//layer may end up on top.
			self.layers[index].$el.css("mix-blend-mode", plugin._blendCssValue(mode));
		};

		plugin.set_layer_visibility = function(index, visible){
			var self = this;
			if(index < 0 || index >= self.layers.length) return;
			self.layers[index].visible = !!visible;
			self.layers[index].$el.css("display", visible ? "" : "none");
		};

		plugin.set_layer_opacity = function(index, opacity){
			var self = this;
			if(index < 0 || index >= self.layers.length) return;
			var op = Math.max(0, Math.min(1, opacity));
			self.layers[index].opacity = op;
			self.layers[index].$el.css("opacity", op);
		};

		plugin.set_layer_name = function(index, name){
			var self = this;
			if(index < 0 || index >= self.layers.length) return;
			self.layers[index].name = name;
		};

		//collapse back to a single base layer: strips every extra sibling canvas and resets
		//the base layer's metadata (name/mode/opacity/visibility) to defaults. the base layer
		//is always self.layers[0] — delete_layer preserves this invariant by copying donor
		//pixels into the main canvas when the main canvas itself is the deletion target.
		//caller is responsible for clearing pixels first (or not) as appropriate.
		plugin.collapse_to_base_layer = function(){
			var self = this;
			if(!self.layers || self.layers.length === 0) return;
			for(var i = self.layers.length - 1; i >= 1; i--){
				self.layers[i].$el.remove();
				self.layers.splice(i, 1);
			}
			var base = self.layers[0];
			base.name = "New layer";
			base.mode = "normal";
			base.visible = true;
			base.opacity = 1;
			base.history_trimmed = false;
			base.$el.css({ "mix-blend-mode": "normal", "opacity": 1, "display": "" });
			self.activeLayerIndex = 0;
			plugin.restack_layers.call(self);
			if(typeof self._layersPanelRender === "function") self._layersPanelRender();
		};

		//composite all visible layers into a fresh canvas for export. mirrors what the GPU
		//does on screen via mix-blend-mode, but without $bgCanvas — saved output carries
		//only the artwork.
		plugin.composite_for_export = function(){
			var self = this;
			var out = document.createElement("canvas");
			out.width = self.width;
			out.height = self.height;
			var ctx = out.getContext("2d", { alpha: self.settings.enable_transparency });
			if(self.settings.enable_transparency == false){
				ctx.fillStyle = "white";
				ctx.fillRect(0, 0, self.width, self.height);
			}
			for(var i = 0; i < self.layers.length; i++){
				var layer = self.layers[i];
				if(!layer.visible) continue;
				ctx.globalAlpha = layer.opacity;
				ctx.globalCompositeOperation = (i > 0 && layer.mode && layer.mode !== "normal") ? plugin._blendCssValue(layer.mode) : "source-over";
				ctx.drawImage(layer.canvas, 0, 0);
			}
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = "source-over";
			return out;
		};
		//---- /Layers ----------------------------------------------------------------------

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
			//active-layer context resolver. re-fetched per call so layer switches take effect
			//immediately. getContext is cached by the browser, so repeat calls are free.
			var ctx = function(){ return plugin.active_context.call(self); };
			$(self).data("is_drawing",false);$(self).data("lastx",null);$(self).data("lasty",null);
			self.$container.on("touchstart." + self._evns, function(e){ e.preventDefault(); });//cancel scroll.

			//true if inside canvas, false if outside canvas.
			//used to check if an initial click or touch start event is valid inside the container
			//and needs to be tracked through move/end events.
			self.boundCheck = function(event){
				//new rotation-aware hit test
				var parent = self.$container[0];
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
				var parent = self.$container[0];
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
							ctx().putImageData(self._gestureAbortSnapshot, 0, 0);
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
						mouse_data = plugin.get_mouse_data.call(self,e,self.$container[0],self);
						//save snapshot of the active layer so the second touch can erase this stroke
						//start if a gesture is detected. only the active layer can have changed.
						var _startCtx = ctx();
						if(e.originalEvent.pointerType === "touch") self._gestureAbortSnapshot = _startCtx.getImageData(0, 0, self.width, self.height);
						$(self).data("is_drawing",true);
						self._activeButton = e.button;//store button, since pointer events only have useful button info in pointerdown, and we catch pointermove later.
						_startCtx.lineCap = "round";_startCtx.lineJoin = 'round';

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
						//resolve the first spot's angle per rotation_mode. stroke direction isn't
						//available yet (no movement), so follow_stroke/follow_jitter fall back to
						//base=0; fixed uses fixed_angle; random_jitter randomises. this mirrors
						//emit_spot so the first stamp doesn't look different from the rest.
						//fade-in already applied inline above, so this call bypasses emit_spot to
						//avoid double-incrementing the counter.
						var _startMode = self.active_brush.rotation_mode || "none";
						var _startAngle = 0;
						if(_startMode === "fixed"){
							_startAngle = self.active_brush.fixed_angle || 0;
						} else if(_startMode === "random_jitter"){
							_startAngle = Math.random() * Math.PI * 2;
						} else if(_startMode === "follow_jitter"){
							_startAngle = (Math.random() * 2 - 1) * (self.active_brush.angle_jitter || 0) * Math.PI;
						}
						//The first spot draws at the brush's base size, never the pressure-scaled size.
						//Why: the Pointer Events spec reports pressure=0.5 on pointerdown when the
						//hardware hasn't yet returned a real reading (Apple Pencil / Surface Pen both
						//do this). With `pressure_affects_size` on and a wide size_max, that bogus 0.5
						//becomes a huge first dot before pointermove delivers the real pressure. Using
						//base size here matches the Photoshop/Krita convention of de-emphasising the
						//landing pressure; alpha still gets pressure-scaled so fade-in keeps working.
						var _startSize = self.active_brush.pressure_affects_size ? self.brushSize : calculatedSize;
						if(typeof self.active_brush.drawStart!=="undefined") self.active_brush.drawStart.call(self,self.active_brush,_startCtx,mouse_data.x,mouse_data.y,_startSize,startAlpha,e,_startAngle);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,_startCtx,mouse_data.x,mouse_data.y,_startSize,startAlpha,e,_startAngle);
						$(self).trigger("drawr:drawstart", [{x: mouse_data.x, y: mouse_data.y, tool: self.active_brush.name, size: calculatedSize, alpha: startAlpha, pressure: mouse_data.pressure}]);
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
						var rect  = self.$container[0].getBoundingClientRect();
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
						//pinch zoom bypasses apply_zoom, so trigger the zoom-percentage readout here too.
						if(newZoom !== self.zoomFactor) self.zoomIndicatorTimer = 500;
						self.zoomFactor = newZoom;
						$(self).width(self.width * newZoom);
						$(self).height(self.height * newZoom);
						plugin.broadcast_zoom_css.call(self);
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
					self.$container.find(".sfx-canvas")[0].style.boxShadow="0px 0px 5px 1px skyblue inset";
				} else {
					self.$container.find(".sfx-canvas")[0].style.boxShadow="";
				}

				var mouse_data = plugin.get_mouse_data.call(self,e,self.$container[0],self);

				if($(self).data("is_drawing")==true && plugin.check_ignore(e)==false){

					var bp = plugin.calc_brush_params(self.active_brush, self.brushSize, self.brushAlpha, mouse_data.pressure, self.pen_pressure);
					var calculatedAlpha = bp.alpha, calculatedSize = bp.size;

					//navigation tools (move, eyedropper) operate on raw pointer events — bypass the
					//spacing/smoothing/jitter pipeline so every pointermove forwards straight to drawSpot.
					//otherwise leftover brushSize/spacing from the previously-active paint tool would
					//throttle the event rate and make panning/rotating choppy.
					if(self.active_brush.raw_input){
						if(typeof self.active_brush.drawSpot !== "undefined"){
							self.active_brush.drawSpot.call(self, self.active_brush, ctx(), mouse_data.x, mouse_data.y, calculatedSize, calculatedAlpha, e, 0);
						}
					} else {
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
							//Cutoff is a fraction of brush size (not stepSize) — knot decimation is about jitter
							//tolerance for the spline, which is unrelated to how densely the spline is sampled.
							var knotCutoff = calculatedSize * 0.375;
							if(knotCutoff < 1) knotCutoff = 1;
							var lastKnot = self._smoothKnots[self._smoothKnots.length - 1];
							if(plugin.distance_between(lastKnot, {x: mouse_data.x, y: mouse_data.y}) < knotCutoff) return;
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
								self._smoothAccumDist = plugin.draw_catmull_segment.call(self, ctx(), self.active_brush, p0, p1, p2, p3, stepSize, calculatedSize, calculatedAlpha, e, self._smoothAccumDist);
							}
						} else {
							//original linear interpolation along the line between the last drawn spot and the current position
							var positions = $(self).data("positions");
							var currentSpot = {x:mouse_data.x,y:mouse_data.y};
							var lastSpot=positions[positions.length-1];
							var dist = plugin.distance_between(lastSpot, currentSpot);
							var angle = plugin.angle_between(lastSpot, currentSpot);
							var _moveCtx = ctx();
							for (var i = stepSize; i < dist; i+=stepSize) {
								x = lastSpot.x + (Math.sin(angle) * i);
								y = lastSpot.y + (Math.cos(angle) * i);
								plugin.emit_spot.call(self, _moveCtx, self.active_brush, x, y, angle, calculatedSize, calculatedAlpha, e);
								positions.push({x:x,y:y});
							}
							$(self).data("positions",positions);
						}
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
					var containerOffset = self.$container.offset();
					var focalX = e.pageX - containerOffset.left;
					var focalY = e.pageY - containerOffset.top;
					plugin.apply_zoom.call(self, newZoomies, focalX, focalY);
				};
				self.$container.on("wheel." + self._evns, function(e){
					e.preventDefault();
					self.scrollWheel(e);
				});
			}
			self.$container.on("contextmenu." + self._evns, function(e){ e.preventDefault(); });
			//middle mouse button is claimed for canvas panning, so block the browser's autoscroll-on-middle-click
			//over the whole container. Autoscroll fires on `mousedown` (not pointerdown), hence the separate bind.
			self.$container.on("mousedown." + self._evns, function(e){
				if(e.button === 1) e.preventDefault();
			});
			//prevent browser native touch gestures (scroll, pinch-zoom) so pointer events fire uninterrupted
			self.$container.css("touch-action", "none");

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
						plugin.draw_catmull_segment.call(self, ctx(), self.active_brush, p0, p1, p2, p2, stepSize, calculatedSize, calculatedAlpha, e, flushAccum);
						self._smoothKnots = null;
						self._smoothAccumDist = 0;
						self._smoothLastStepSize = null;
					}

					if(typeof self.active_brush.drawStop!=="undefined") result = self.active_brush.drawStop.call(self,self.active_brush,ctx(),mouse_data.x,mouse_data.y,calculatedSize,calculatedAlpha,e);
					//if there is an action to undo
					if(typeof result!=="undefined"){
						plugin.record_undo_entry.call(self);
					  }
					$(self).trigger("drawr:drawstop", [{x: mouse_data.x, y: mouse_data.y, tool: self.active_brush.name, size: calculatedSize, alpha: calculatedAlpha, pressure: mouse_data.pressure}]);
					plugin.request_redraw.call(self);
				}
				self._gestureAbortSnapshot = null;
				$(self).data("is_drawing",false).data("lastx",null).data("lasty",null);
				$(".drawr-toolbox").each(function(){
					if($(this).data("dragging") == true){
						var owner = this.ownerCanvas;
						if(owner && owner._toolboxPositions){
							var containerOffset = owner.$container.offset();
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
		//scope: "active" (default) clears only the active layer; "all" clears every layer.
		//the public "clear" action passes "all" to wipe the whole artwork; internal callers
		//(undo/redo restoring a single layer, post-load reset) use "active".
		plugin.clear_canvas = function(record_undo, scope){
			if(record_undo) {
				this.plugin.record_undo_entry.call(this);
			}
			scope = scope || "active";
			var self = this;
			var clearOne = function(canvas, fillWhite){
				var c = canvas.getContext("2d", { alpha: true });
				if(fillWhite){
					c.fillStyle = "white";
					c.globalCompositeOperation = "source-over";
					c.globalAlpha = 1;
					c.fillRect(0, 0, self.width, self.height);
				} else {
					c.clearRect(0, 0, self.width, self.height);
				}
			};
			if(scope === "all" && self.layers){
				//layer 0 honours enable_transparency; extras always clear transparent so blending
				//composes correctly with layer 0.
				clearOne(self.layers[0].canvas, self.settings.enable_transparency == false);
				for(var i = 1; i < self.layers.length; i++) clearOne(self.layers[i].canvas, false);
			} else {
				var idx = self.layers ? self.activeLayerIndex : 0;
				var target = self.layers ? self.layers[idx].canvas : self;
				clearOne(target, idx === 0 && self.settings.enable_transparency == false);
			}
		};

		//Call this before any canvas manipulation. it is automatically done with most tool plugins.
		//works as long as you call it with a "this" of the canvas
		plugin.record_undo_entry = function(){
			if(typeof this.$undoButton!=="undefined"){
				this.$undoButton.css("opacity",1);
			}
			//snapshot the active layer's state AFTER the action. undo will walk the stack for
			//the previous entry matching this layerId and restore that; if none, it clears.
			var layer = this.layers[this.activeLayerIndex];
			this.undoStack.push({data: layer.canvas.toDataURL("image/png"), layerId: layer.id});
			//enforce the cap by dropping the oldest non-sticky entry. sticky entries are
			//baselines (loaded image) and shouldn't count toward the cap. when we drop a
			//real entry, mark its layer as history-trimmed — undo's fallback-to-clear must
			//refuse once we've lost the layer's oldest state.
			if(this.undoStack.length > (this.settings.undo_max_levels + 1)){
				for(var i = 0; i < this.undoStack.length; i++){
					if(this.undoStack[i].sticky) continue;
					var dropped = this.undoStack.splice(i, 1)[0];
					var didx = plugin.resolve_layer_by_id.call(this, dropped.layerId);
					if(didx >= 0) this.layers[didx].history_trimmed = true;
					break;
				}
			}
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

		//Global stylus-pressure response curve. Single gamma parameter consumed by calc_brush_params:
		//shaped = pow(pressure, gamma). Persisted as a number in localStorage["drawr.pressureCurve"];
		//cached in memory (_pressureCurveCache) since calc_brush_params runs per spot. The storage-event
		//handler invalidates the cache when another tab writes the key.
		plugin.PRESSURE_CURVE_DEFAULT = 0.5;
		plugin._pressureCurveCache = null;
		plugin.read_pressure_curve = function(){
			if(plugin._pressureCurveCache !== null) return plugin._pressureCurveCache;
			var v = plugin.PRESSURE_CURVE_DEFAULT;
			try {
				var raw = window.localStorage.getItem("drawr.pressureCurve");
				if(raw !== null){
					var parsed = parseFloat(raw);
					if(isFinite(parsed) && parsed > 0) v = parsed;
				}
			} catch(e){}
			plugin._pressureCurveCache = v;
			return v;
		};
		plugin.write_pressure_curve = function(gamma){
			plugin._pressureCurveCache = gamma;
			try { window.localStorage.setItem("drawr.pressureCurve", String(gamma)); } catch(e){}
		};
		//Refresh settings UI on every instance (no tool filter — this is a global setting).
		plugin.broadcast_pressure_curve_change = function(){
			var instances = $.fn.drawr._instances || [];
			for(var i = 0; i < instances.length; i++){
				var inst = instances[i];
				if(!inst || typeof inst.$settingsToolbox === "undefined") continue;
				var settings_brush = plugin.get_tool_by_name("default","settings");
				if(settings_brush && typeof settings_brush.update === "function"){
					settings_brush.update.call(inst);
				}
			}
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
				} else if(e.key === "drawr.pressureCurve"){
					//global setting: invalidate cache so next read pulls the new value, then refresh
					//the settings dialog on every instance so sliders/curve preview reflect the change.
					plugin._pressureCurveCache = null;
					plugin.broadcast_pressure_curve_change();
				} else if(e.key === "drawr.customBrushes"){
					//step 8 handles custom-brush add/remove reconciliation across tabs.
					if(typeof $.fn.drawr.reconcile_custom_brushes === "function"){
						$.fn.drawr.reconcile_custom_brushes();
					}
				}
			});
		};

		plugin.activate_brush = function(brush){
			var context = plugin.active_context.call(this);
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
					var ctx = plugin.active_context.call(self);
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
				//use an MDI glyph rather than the × unicode character — the latter falls back
				//to tofu on systems whose default font lacks the geometric-shape range.
				var $x = $("<span class='drawr-tool-x mdi mdi-close' title='Remove brush'></span>");
				$x.css({
					position: "absolute", top: "0px", right: "2px",
					width: "12px", height: "12px", lineHeight: "12px", fontSize: "12px",
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
			//unique id per checkbox so the <label for=…> association is unambiguous on iOS
			//(tapping the label text reliably toggles the box; wrapping-label alone is flaky
			//on some mobile browsers when paired with pointer-event listeners on ancestors).
			var uid = 'drawr-cb-' + Math.random().toString(36).slice(2, 9);
			$(toolbox).append(
				'<div style="clear:both;text-align:left;padding:4px 8px;display:flex;align-items:center;gap:5px;">' +
				'<input id="' + uid + '" type="checkbox" class="checkbox-component checkbox-' + key + '"' + (checked ? ' checked' : '') + ' style="margin:0;flex:0 0 auto;">' +
				'<label for="' + uid + '" style="cursor:pointer;user-select:none;line-height:1;margin:0;">' + title + '</label>' +
				'</div>'
			);
			$(toolbox).find('.checkbox-' + key).on('pointerdown', function(e){
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
			//use MDI chevron glyphs instead of raw unicode triangles — iOS Firefox renders those as
			//tofu/garbled symbols because its default fallback font lacks the geometric-shape range.
			var chevClass = function(c){ return c ? 'mdi-chevron-right' : 'mdi-chevron-down'; };
			var $wrap = $(
				'<div class="drawr-collapsible ' + uid + '" style="margin:6px 8px 4px;border-top:1px solid rgba(0,0,0,0.12);">' +
					'<div class="drawr-collapsible-header" style="cursor:pointer;padding:6px 4px;font-weight:bold;font-size:12px;user-select:none;display:flex;align-items:center;">' +
						'<span class="drawr-collapsible-chevron mdi ' + chevClass(collapsed) + '" style="display:inline-block;width:14px;font-size:16px;line-height:1;"></span>' +
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
				$chev.removeClass('mdi-chevron-right mdi-chevron-down').addClass(chevClass(collapsed));
			});
			return $content;
		};

		//set some default settings. :)
		plugin.initialize_canvas = function(width,height,reset){

			this.origStyles = plugin.get_styles(this);
			this.origParentStyles = plugin.get_styles(this.$container[0]);
			$(this).css({ "display" : "block", "user-select": "none", "webkit-touch-callout": "none", "position": "relative", "z-index": 1 });
			//`isolation: isolate` confines mix-blend-mode (used by multiply layers) to the
			//drawr-container, so blending never reaches the surrounding page. $bgCanvas is
			//still inside the isolated context — by design; multiply reaches through
			//transparent regions of layer 0 to the paper background.
			this.$container.css({	"overflow": "hidden", "position": "relative", "user-select": "none", "webkit-touch-callout": "none", "isolation": "isolate" });

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
				this.$container.prepend(this.$bgCanvas);
			}

			//drawr-layer-stack: inner wrapper that holds the main canvas + extra layer canvases.
			//its `isolation: isolate` creates a fresh stacking context so layer mix-blend-mode
			//only reaches sibling layers — the checkerboard ($bgCanvas) and UI overlay
			//($memoryCanvas) sit outside and never participate in blending.
			if(!this.$layerStack){
				this.$layerStack = $("<div class='drawr-layer-stack'></div>").css({
					"position": "absolute",
					"top": 0, "left": 0,
					"width":  "100%",
					"height": "100%",
					"z-index": 1,
					"isolation": "isolate"
				});
				this.$container.append(this.$layerStack);
				//reparent the main canvas into the stack. extra layer canvases already live
				//here because add_layer inserts them after the last existing layer's $el.
				this.$layerStack.append(this);
			}

			if(this.width!==width || this.height!==height){//if statement because it resets otherwise.
				this.width=width;
				this.height=height;
				//resize extra layer canvases to match. drops their pixel data — acceptable during
				//explicit resize/load flows.
				if(this.layers){
					for(var li = 1; li < this.layers.length; li++){
						this.layers[li].canvas.width = width;
						this.layers[li].canvas.height = height;
					}
				}
			}

			if(reset==true){
				this.zoomFactor = 1;
				this.rotationAngle = 0;
				plugin.apply_scroll.call(this,0,0,false);
				$(this).width(width);
				$(this).height(height);
				if(this.layers){
					for(var lj = 1; lj < this.layers.length; lj++){
						this.layers[lj].$el.width(width);
						this.layers[lj].$el.height(height);
					}
				}
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
				//clear extra layers to transparent (regardless of paper setting — extras must be
				//transparent for multiply/normal blending to compose correctly with layer 0).
				if(this.layers){
					for(var lk = 1; lk < this.layers.length; lk++){
						var lctx = this.layers[lk].canvas.getContext("2d", { alpha: true });
						lctx.clearRect(0, 0, width, height);
					}
				}
			}

			//memory canvas
			var context = this.$memoryCanvas[0].getContext("2d");
			context.fillStyle="blue";
			context.fillRect(0,0,width,height);
			var parent_width = this.$container.innerWidth();
			var parent_height = this.$container.innerHeight();

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

			//zoom percentage indicator — bottom-center of the viewport, fades like the scrollbars.
			if(this.zoomIndicatorTimer > 0){
				var _zAlpha = Math.min(0.85, (0.85/100)*this.zoomIndicatorTimer);
				this.zoomIndicatorTimer -= 5;
				var _zText = Math.round(this.zoomFactor * 100) + "%";
				context.save();
				context.globalAlpha = _zAlpha;
				context.font = "bold 13px sans-serif";
				context.textAlign = "center";
				//use alphabetic baseline + actual glyph metrics. textBaseline "middle" resolves
				//to em-box middle on iOS Safari (shifts text down), but alphabetic + measured
				//ascent/descent centers the visible glyph identically on every browser.
				context.textBaseline = "alphabetic";
				var _zMetrics = context.measureText(_zText);
				var _zAscent  = _zMetrics.actualBoundingBoxAscent  || 10;
				var _zDescent = _zMetrics.actualBoundingBoxDescent || 2;
				var _zGlyphH  = _zAscent + _zDescent;
				var _zPadX = 10, _zPadY = 5;
				var _zBoxW = _zMetrics.width + _zPadX * 2;
				var _zBoxH = _zGlyphH + _zPadY * 2;
				var _zBoxX = container_width / 2 - _zBoxW / 2;
				var _zBoxY = container_height - _zBoxH - 16; //16px margin from bottom
				context.fillStyle = "rgba(0,0,0,0.6)";
				if(context.roundRect){
					context.beginPath();
					context.roundRect(_zBoxX, _zBoxY, _zBoxW, _zBoxH, 4);
					context.fill();
				} else {
					context.fillRect(_zBoxX, _zBoxY, _zBoxW, _zBoxH);
				}
				context.fillStyle = "#fff";
				//baseline y = box top + top padding + ascent → glyph sits centered in the box.
				context.fillText(_zText, container_width / 2, _zBoxY + _zPadY + _zAscent);
				context.restore();
			}

			//we only keep the loop alive when there is work to do (effectCallback preview or scroll indicators fading in n out). Everything else is triggered via request_redraw.
			if((typeof this.effectCallback!=="undefined" && this.effectCallback!==null) || this.scrollTimer > 0 || this.zoomIndicatorTimer > 0 || (this.settings.debug_mode && this.isGesturing)){
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
				"box-shadow" : "0px 2px 5px -2px rgba(0,0,0,0.75)",	"user-select": "none", "font-family" : "sans-serif", "font-size" :"12px", "text-align" : "center",
				//touch-action: manipulation keeps taps snappy (no 300ms wait, no double-tap-zoom)
				//while still letting native scroll/pan pass through range sliders and select dropdowns.
				"touch-action": "manipulation"
			});
			$(toolbox).insertAfter(this.$container);
			if(position){ $(toolbox).offset(position); }
			$(toolbox).data("toolbox-id", id);
			$(toolbox).hide();
			//the plugin claims the middle mouse button for canvas panning, so block the browser's
			//autoscroll-on-middle-click over any toolbox (otherwise a tall dialog will trigger it).
			$(toolbox).on("mousedown." + self._evns, function(e){
				if(e.button === 1) e.preventDefault();
			});
			//drag using pointerdown only — it covers mouse/touch/pen on all modern browsers.
			//binding touchstart alongside is the root cause of mobile tap failures: iOS Safari
			//treats a same-element touchstart+pointerdown pair as ambiguous, frequently dropping
			//the synthesized click on nested buttons/labels/sliders.
			$(toolbox).on("pointerdown." + self._evns, function(e){
				if($(e.target).is("button, input, select, textarea, label, option, a") || $(e.target).closest("button, input, select, textarea, label, option, a").length) {
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

			var container = this.$container;
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
			var containerOffset = self.$container.offset();
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
			self.scrollX = x;
			self.scrollY = y;
			plugin.broadcast_transform.call(self);
			if(setTimer==true){
				self.scrollTimer= 500;
			}
			plugin.request_redraw.call(self);
		};

		//call this to set canvas rotation angle (radians).
		plugin.apply_rotation = function(angle,setTimer){
			var self = this;
			self.rotationAngle = angle;
			plugin.broadcast_transform.call(self);
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
			plugin.broadcast_zoom_css.call(self);
			plugin.draw_checkerboard.call(self);
			if(oldZoom > 0 && zoomFactor !== oldZoom){
				//brief zoom-percentage readout at the bottom of the viewport, mirroring the
				//fade-in/out behaviour of the scroll indicators (driven from draw_animations).
				self.zoomIndicatorTimer = 500;
				plugin.request_redraw.call(self);
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
			//with multiple layers, composite in JS so saved output matches the GPU-blended display.
			//a single-layer instance falls straight through to toDataURL on the main canvas.
			if(currentCanvas.layers && currentCanvas.layers.length > 1){
				return plugin.composite_for_export.call(currentCanvas).toDataURL(mime);
			}
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
				//public clear wipes every layer, then collapses back to a single base layer
				//so callers get a clean single-layer state (matches fresh-canvas semantics).
				currentCanvas.plugin.clear_canvas.call(currentCanvas,false,"all");
				currentCanvas.plugin.collapse_to_base_layer.call(currentCanvas);

				if(clear_undo) {//re-add current version of the canvas.
					if(typeof currentCanvas.$undoButton!=="undefined") currentCanvas.$undoButton.css("opacity",0.5);
					if(typeof currentCanvas.$redoButton!=="undefined") currentCanvas.$redoButton.css("opacity",0.5);
					currentCanvas.undoStack = [];
					currentCanvas.redoStack = [];
				}

				//record the active layer's cleared state so the first undo does something sensible.
				var _active = currentCanvas.layers[currentCanvas.activeLayerIndex];
				currentCanvas.undoStack.push({data: _active.canvas.toDataURL("image/png"), layerId: _active.id});

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
				currentCanvas.$brushToolbox.css("left",(currentCanvas.$container.offset().left + param.x) + "px");
				currentCanvas.$brushToolbox.css("top",(currentCanvas.$container.offset().top + param.y) + "px");
				
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
					plugin.initialize_canvas.call(currentCanvas,img.width,img.height,true);
					//load replaces the active layer. the canvas resize/reset above has already
					//cleared every layer to white/transparent, so drawImage straight onto the
					//active layer context is all that's left.
					var context = plugin.active_context.call(currentCanvas);
					context.drawImage(img,0,0);
					//drop prior history — dimensions changed, older snapshots no longer align —
					//and mark the loaded state sticky so undo treats it as a baseline: it serves
					//as a restore target for later strokes, but undo refuses to pop it.
					currentCanvas.undoStack = [];
					currentCanvas.redoStack = [];
					var _lb = currentCanvas.layers[currentCanvas.activeLayerIndex];
					currentCanvas.undoStack.push({
						data: _lb.canvas.toDataURL("image/png"),
						layerId: _lb.id,
						sticky: true
					});
				};
				img.src=param;
			//call with $(selector).drawr("destroy") 
			//should undo everything that was done to the canvas and its parent container, returning it to its original state.
			} else if ( action === "destroy" ) {
				if(!$(currentCanvas).hasClass("active-drawr")) {
					console.error("The element you are running this command on is not a drawr canvas.");
					return false;//can't destroy if not initialized.
				}
				var $container = currentCanvas.$container;
				var evns = currentCanvas._evns;
				$container.off("touchstart." + evns);
				$container.off("wheel." + evns);
				$container.off("contextmenu." + evns);
				$container.find(".drawr-toolbox .drawr-tool-btn").off("pointerdown." + evns);
				$container.find(".drawr-toolbox .slider-component").off("input." + evns);
				$container.find(".drawr-toolbox").off("pointerdown." + evns + " touchstart." + evns);
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
				//remove extra layer canvases (layer 0 is the main canvas — left in place).
				if(currentCanvas.layers){
					for(var _li = 1; _li < currentCanvas.layers.length; _li++){
						currentCanvas.layers[_li].$el.remove();
					}
					delete currentCanvas.layers;
					delete currentCanvas.activeLayerIndex;
					delete currentCanvas._nextLayerId;
				}
				//unwrap drawr-layer-stack: move the main canvas back to drawr-container so
				//the DOM returns to its pre-init shape. must happen before style/class resets
				//below, which expect $(currentCanvas).parent() === drawr-container.
				if(currentCanvas.$layerStack){
					currentCanvas.$container.append(currentCanvas);
					currentCanvas.$layerStack.remove();
					delete currentCanvas.$layerStack;
				}
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
				delete currentCanvas.zoomIndicatorTimer;

				//reset css and visuals and scrolls
				$(currentCanvas).width(currentCanvas.width);
				$(currentCanvas).height(currentCanvas.height);
				$(currentCanvas).css("transform","translate(0px,0px)");

				//reset styles to what they were.
				$(currentCanvas).attr('style', '');
				currentCanvas.$container.attr('style', '');
				$(currentCanvas).css(currentCanvas.origStyles);
				currentCanvas.$container.css(currentCanvas.origParentStyles);

				delete currentCanvas.origStyles;
				delete currentCanvas.origParentStyles;

				$(currentCanvas).removeClass("active-drawr");
				currentCanvas.$container.removeClass("drawr-container");
				delete currentCanvas.$container;
			//not an action, but an init call
			} else if ( typeof action == "object" || typeof action =="undefined" ){
				if($(currentCanvas).hasClass("active-drawr")) return false;//prevent double init
				currentCanvas.className = currentCanvas.className + " active-drawr";
				//cached reference to drawr-container. stashed first so every later code path
				//(tools, event handlers, positioning math) can use it instead of
				//$(this).parent(), which becomes the inner drawr-layer-stack div once
				//initialize_canvas reparents the main canvas for blend-mode isolation.
				currentCanvas.$container = $(currentCanvas).parent();
				currentCanvas.$container.addClass("drawr-container");

				//determine settings
				var defaultSettings = {
					"enable_transparency" : true,
					"enable_scrollwheel_zooming" : true,
					"canvas_width" : currentCanvas.$container.innerWidth(),
					"canvas_height" : currentCanvas.$container.innerHeight(),
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
				currentCanvas.containerWidth = currentCanvas.$container.width();
				currentCanvas.containerHeight = currentCanvas.$container.height();
				currentCanvas._evns = "drawr_" + Math.random().toString(36).slice(2, 9);//event namespace so destroying one drawr instance doesn't affect others.
				currentCanvas.onWindowResize = function() {
					currentCanvas.containerWidth = currentCanvas.$container.width();
					currentCanvas.containerHeight = currentCanvas.$container.height();
				};
				$(window).on("resize." + currentCanvas._evns, currentCanvas.onWindowResize);

				currentCanvas.plugin = plugin;
				currentCanvas.rotationAngle = 0;
				currentCanvas.draw_animations_bound = plugin.draw_animations.bind(currentCanvas);
				currentCanvas._animFrameQueued = false;

				currentCanvas.paperColorMode = currentCanvas.settings.paper_color_mode;
				currentCanvas.paperColor = currentCanvas.settings.paper_color;

				//seed layer registry. layer 0 is the main canvas element itself. add_layer/
				//delete_layer/move_layer_down manage extras. undo records reference layer.id
				//so reorder/delete don't invalidate history.
				currentCanvas.layers = [{
					id: 0,
					canvas: currentCanvas,
					$el: $(currentCanvas),
					name: "New layer",
					mode: "normal",
					visible: true,
					opacity: 1,
					history_trimmed: false
				}];
				currentCanvas.activeLayerIndex = 0;
				currentCanvas._nextLayerId = 1;

				//set up canvas
				plugin.initialize_canvas.call(currentCanvas,defaultSettings.canvas_width,defaultSettings.canvas_height,true);
				//undo/redo use "walk for prev same-layer" semantics with fallback-to-clear.
				//no initial seed needed — the first stroke's undo will fallback-clear.
				currentCanvas.undoStack = [];
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
		"pressure_affects_alpha","pressure_affects_size","size_max"
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
			bind(picker, picker.$dropdown, 'pointerup.drawrpalette', function() {
				var wasDragging = picker.slidingHsl || picker.slidingHue || picker.slidingAlpha;
				picker.slidingHsl = picker.slidingHue = picker.slidingAlpha = false;
				if (picker.settings.auto_apply && wasDragging) {
					commit(picker);
					close_dropdown(picker, true);
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
jQuery.fn.drawr.register({
	icon: "mdi mdi-spray mdi-24px",
	name: "airbrush",
	size: 100,
	alpha: 1,
	order: 3,
	brush_fade_in: 10,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	smoothing: false,
	flow: 1,
	spacing: 0.25,
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
			{ left: self.$container.offset().left + self.$container.innerWidth()/2,
			  top:  self.$container.offset().top  + self.$container.innerHeight()/2 },
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
		self._customSizeMax    = self.plugin.create_slider.call(self, $adv, "sizemax",    1, 200, 20);
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
				pressure_affects_size:  self._customPressureS.prop("checked"),
				size_max: parseFloat(self._customSizeMax.val())
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
	icon: "mdi mdi-eraser mdi-24px",
	name: "eraser",
	size: 10,
	alpha: 0.8,
	order: 5,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	size_max: 20,
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
	raw_input: true,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){

		var rgb_to_hex = function(r, g, b) {
            var rgb = b | (g << 8) | (r << 16);
            return '#' + (0x1000000 + rgb).toString(16).slice(1)
        };

		var self = this;
		//with multiple layers, sample the composited pixel the user sees (respecting blend modes
		//and per-layer opacity). single-layer falls through to the active context directly.
		var raw;
		if(self.layers && self.layers.length > 1){
			var comp = self.plugin.composite_for_export.call(self);
			raw = comp.getContext("2d", { alpha: self.settings.enable_transparency }).getImageData(Math.round(x), Math.round(y), 1, 1).data;
		} else {
			raw = context.getImageData(x, y, 1, 1).data;
		}
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
	icon: "mdi mdi-layers mdi-24px",
	name: "layers",
	type: "toggle",
	order: 34,
	buttonCreated: function(brush, button){
		var self = this;
		var plugin = self.plugin;

		self.$layersToolbox = plugin.create_toolbox.call(self, "layers", null, "Layers", 220);

		//container the rows render into; rebuilt on every change.
		self.$layersToolbox.append('<div class="drawr-layers-rows" style="padding:4px 6px;"></div>');
		var $rows = self.$layersToolbox.find('.drawr-layers-rows');

		var $addBtn = plugin.create_button.call(self, self.$layersToolbox, "Add layer");
		$addBtn.on('click', function(){
			if(self.layers.length >= plugin.MAX_LAYERS) return;
			var layer = plugin.add_layer.call(self, "normal");
			if(layer){
				//new layers land at index 0 (bottom of stack); activate it so the next
				//stroke targets it.
				plugin.set_active_layer.call(self, 0);
				render();
			}
		});

		//escape for safe interpolation of user-entered names into the html template.
		function esc(s){
			return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){
				return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch];
			});
		}

		function blendOptionsHtml(current){
			var modes = (plugin.BLEND_MODES || [{value:"normal",label:"Normal"},{value:"multiply",label:"Multiply"}]);
			var html = "";
			for(var i = 0; i < modes.length; i++){
				var m = modes[i];
				html += '<option value="' + m.value + '"' + (current === m.value ? ' selected' : '') + '>' + m.label + '</option>';
			}
			return html;
		}

		//render the row list. top-of-stack first (Photoshop convention).
		function render(){
			$rows.empty();
			var activeIdx = self.activeLayerIndex;
			for(var visualIndex = self.layers.length - 1; visualIndex >= 0; visualIndex--){
				(function(idx){
					var layer = self.layers[idx];
					var isActive = idx === activeIdx;
					var canDelete = self.layers.length > 1;
					var canMoveDown = idx >= 1;
					var canMoveUp = idx < self.layers.length - 1;
					var $row = $(
						'<div class="drawr-layer-row" data-idx="' + idx + '" style="' +
							'display:flex;flex-direction:column;gap:2px;padding:4px 6px;margin-bottom:3px;border-radius:3px;cursor:pointer;' +
							'background:' + (isActive ? 'rgba(255,165,0,0.25)' : 'rgba(255,255,255,0.05)') + ';' +
							'border:1px solid ' + (isActive ? 'orange' : 'rgba(255,255,255,0.12)') + ';' +
						'">' +
							'<div style="display:flex;align-items:center;gap:4px;">' +
								'<span class="layer-vis mdi ' + (layer.visible ? 'mdi-eye' : 'mdi-eye-off') + '" style="cursor:pointer;font-size:16px;width:18px;text-align:center;"></span>' +
								'<input class="layer-name" type="text" value="' + esc(layer.name || "New layer") + '" ' +
									'style="flex:1;min-width:0;font-weight:bold;font-size:11px;background:transparent;border:1px solid transparent;color:inherit;padding:1px 3px;border-radius:2px;">' +
								'<span class="layer-moveup mdi mdi-arrow-up" title="Move up" style="cursor:' + (canMoveUp ? 'pointer' : 'not-allowed') + ';font-size:16px;width:18px;text-align:center;opacity:' + (canMoveUp ? 1 : 0.3) + ';"></span>' +
								'<span class="layer-movedown mdi mdi-arrow-down" title="Move down" style="cursor:' + (canMoveDown ? 'pointer' : 'not-allowed') + ';font-size:16px;width:18px;text-align:center;opacity:' + (canMoveDown ? 1 : 0.3) + ';"></span>' +
								'<span class="layer-delete mdi mdi-close" title="Delete" style="cursor:' + (canDelete ? 'pointer' : 'not-allowed') + ';font-size:16px;width:18px;text-align:center;opacity:' + (canDelete ? 1 : 0.3) + ';color:#f88;"></span>' +
							'</div>' +
							'<div style="display:flex;align-items:center;gap:4px;">' +
								'<select class="layer-mode" style="flex:1;color:#333;font-size:11px;">' +
									blendOptionsHtml(layer.mode) +
								'</select>' +
								'<input class="layer-opacity" type="range" min="0" max="100" value="' + Math.round(layer.opacity * 100) + '" style="flex:1;min-width:0;height:14px;margin:0;">' +
								'<span class="layer-opacity-label" style="min-width:26px;text-align:right;font-size:10px;font-variant-numeric:tabular-nums;">' + Math.round(layer.opacity * 100) + '</span>' +
							'</div>' +
						'</div>'
					);

					//row click sets active (but ignore clicks on controls inside the row)
					$row.on('pointerdown', function(e){
						if($(e.target).is('.layer-vis, .layer-moveup, .layer-movedown, .layer-delete, .layer-name, select, input, option')) return;
						plugin.set_active_layer.call(self, idx);
						render();
						e.stopPropagation();
					});

					$row.find('.layer-vis').on('click', function(e){
						e.stopPropagation();
						plugin.set_layer_visibility.call(self, idx, !layer.visible);
						render();
					});

					//name input — keyboard-focused editing. swallow pointer/key events so the
					//row-click handler and the global toolbox-drag don't interfere.
					$row.find('.layer-name')
						.on('pointerdown mousedown touchstart keydown', function(e){ e.stopPropagation(); })
						.on('focus', function(){ $(this).css('border-color', 'rgba(255,255,255,0.4)'); })
						.on('blur', function(){
							$(this).css('border-color', 'transparent');
							plugin.set_layer_name.call(self, idx, this.value || "New layer");
							if(!this.value) this.value = "New layer";
						})
						.on('keydown', function(e){ if(e.key === 'Enter') this.blur(); });

					if(canMoveUp){
						//moving idx up == moving (idx+1) down; swap is symmetric.
						$row.find('.layer-moveup').on('click', function(e){
							e.stopPropagation();
							plugin.move_layer_down.call(self, idx + 1);
							render();
						});
					}

					if(canMoveDown){
						$row.find('.layer-movedown').on('click', function(e){
							e.stopPropagation();
							plugin.move_layer_down.call(self, idx);
							render();
						});
					}

					if(canDelete){
						$row.find('.layer-delete').on('click', function(e){
							e.stopPropagation();
							if(!window.confirm("Delete \"" + (layer.name || "New layer") + "\"?")) return;
							plugin.delete_layer.call(self, idx);
							render();
						});
					}

					$row.find('.layer-mode').on('change', function(e){
						e.stopPropagation();
						plugin.set_layer_mode.call(self, idx, this.value);
					}).on('pointerdown', function(e){ e.stopPropagation(); });

					$row.find('.layer-opacity').on('input', function(e){
						e.stopPropagation();
						var v = parseInt(this.value, 10) / 100;
						plugin.set_layer_opacity.call(self, idx, v);
						$row.find('.layer-opacity-label').text(Math.round(v * 100));
					}).on('pointerdown', function(e){ e.stopPropagation(); });

					$rows.append($row);
				})(visualIndex);
			}
			//enable/disable + button.
			if(self.layers.length >= plugin.MAX_LAYERS){
				$addBtn.prop('disabled', true).css('opacity', 0.5);
			} else {
				$addBtn.prop('disabled', false).css('opacity', 1);
			}
		}

		//expose for external callers (e.g. the panel should refresh when something else mutates layers).
		self._layersPanelRender = render;
		render();
	},
	action: function(brush, context){
		var self = this;
		if(typeof self._layersPanelRender === "function") self._layersPanelRender();
		if(self.$layersToolbox.is(":visible")){
			self.$layersToolbox.hide();
		} else {
			self.plugin.show_toolbox.call(self, self.$layersToolbox);
		}
	},
	cleanup: function(){
		var self = this;
		if(self.$layersToolbox){
			self.$layersToolbox.remove();
			delete self.$layersToolbox;
		}
		delete self._layersPanelRender;
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-folder-open mdi-24px",
	name: "load",
	type: "toggle",
	order: 28,
	//iOS Safari refuses to trigger the file picker from the overlay-input hack used elsewhere,
	//so load mirrors the custom-brush approach: a real toolwindow with a styled filepicker button.
	buttonCreated: function(brush,button){
		var self = this;

		self.$loadToolbox = self.plugin.create_toolbox.call(self,"load",
			{ left: self.$container.offset().left + self.$container.innerWidth()/2,
			  top:  self.$container.offset().top  + self.$container.innerHeight()/2 },
			"Load image", 160);

		self.plugin.create_text.call(self, self.$loadToolbox, "Load an image onto the canvas.");

		self._loadFilePicker = self.plugin.create_filepicker(self.$loadToolbox, "Choose image", "image/*");
		self._loadImageDataUrl = null;
		self._loadFilePicker.on('change', function() {
			var file = this.files[0];
			if (!file) return;
			var reader = new FileReader();
			reader.onload = function(e) { self._loadImageDataUrl = e.target.result; };
			reader.readAsDataURL(file);
		});

		self._loadResize = self.plugin.create_checkbox.call(self, self.$loadToolbox, "Resize canvas to image", true);

		var $loadBtn = self.plugin.create_button.call(self, self.$loadToolbox, "Load");
		$loadBtn.on('click', function(){
			if(!self._loadImageDataUrl){ alert("Pick an image first."); return; }
			var dataUrl = self._loadImageDataUrl;

			if(self._loadResize.prop("checked")){
				$(self).drawr("load", dataUrl);
			} else {
				var img = document.createElement("img");
				img.crossOrigin = "Anonymous";
				img.onload = function(){
					//load replaces the active layer (when layers are active). single-layer falls
					//through to the main canvas context as before. drop history and push a
					//sticky baseline so undo can step back through subsequent strokes but not
					//past the load itself.
					var ctx = self.plugin.active_context.call(self);
					//reset compositing state — the last tool's drawStart may have left behind a
					//non-default globalAlpha or globalCompositeOperation, which would otherwise
					//stamp the loaded image at e.g. 30% opacity or in destination-out mode.
					ctx.globalCompositeOperation = "source-over";
					ctx.globalAlpha = 1;
					ctx.drawImage(img, 0, 0);
					self.undoStack = [];
					self.redoStack = [];
					var _l = self.layers[self.activeLayerIndex];
					self.undoStack.push({
						data: _l.canvas.toDataURL("image/png"),
						layerId: _l.id,
						sticky: true
					});
					if(typeof self.$undoButton !== "undefined") self.$undoButton.css("opacity", 0.5);
					if(typeof self.$redoButton !== "undefined") self.$redoButton.css("opacity", 0.5);
				};
				img.src = dataUrl;
			}

			self._loadFilePicker.val("");
			self._loadImageDataUrl = null;
			self.$loadToolbox.hide();
			var $loadToolBtn = self.$brushToolbox.find(".drawr-tool-btn.type-toggle").filter(function(){
				return $(this).data("data") === brush;
			});
			if($loadToolBtn.length && $loadToolBtn.data("state")){
				$loadToolBtn.data("state", false);
				self.plugin.set_button_state($loadToolBtn[0], false);
			}
		});
	},
	action: function(brush,context){
		var self = this;
		self.$loadToolbox.toggle();
	},
	cleanup: function(){
		var self = this;
		self.$loadToolbox.remove();
		delete self.$loadToolbox;
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
	raw_input: true,
	activate: function(brush,context){
		this.$container.css({"cursor":"move"});
	},
	deactivate: function(brush,context){
		this.$container.css({"cursor":"default"});
	},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		var self = this;

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		//right-click rotates, anything else pans. _activeButton is stamped on pointerdown
		//so we can recover it during pointermove where event.button is unreliable.
		brush.mode = (event.button === 2) ? "rotate" : "pan";

		if(brush.mode === "pan"){
			brush.dragStartX = eventX;
			brush.scrollStartX = self.scrollX;
			brush.dragStartY = eventY;
			brush.scrollStartY = self.scrollY;
		} else {
			var parent = self.$container[0];
			var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
			var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
			var box = parent.getBoundingClientRect();
			var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
			var py = eventY - (box.y + $(document).scrollTop()) - borderTop;
			var W = self.width * self.zoomFactor;
			var H = self.height * self.zoomFactor;
			var cx = W / 2 - self.scrollX;
			var cy = H / 2 - self.scrollY;
			brush.startAngle = Math.atan2(py - cy, px - cx);
			brush.startRotation = self.rotationAngle || 0;
		}
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		if(brush.mode === "rotate"){
			var parent = self.$container[0];
			var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
			var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
			var box = parent.getBoundingClientRect();
			var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
			var py = eventY - (box.y + $(document).scrollTop()) - borderTop;
			var W = self.width * self.zoomFactor;
			var H = self.height * self.zoomFactor;
			var cx = W / 2 - self.scrollX;
			var cy = H / 2 - self.scrollY;
			var currentAngle = Math.atan2(py - cy, px - cx);
			var delta = currentAngle - brush.startAngle;
			self.plugin.apply_rotation.call(self, brush.startRotation + delta, true);
		} else {
			var diffx = parseInt(-(eventX - brush.dragStartX));
			var diffy = parseInt(-(eventY - brush.dragStartY));
			self.plugin.apply_scroll.call(self, brush.scrollStartX + diffx, brush.scrollStartY + diffy, true);
		}
	}
});

jQuery.fn.drawr.register({
	icon: "mdi mdi-brush mdi-24px",
	name: "paintbrush",
	size: 5,
	alpha: 1,
	order: 4,
	brush_fade_in: 10,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	smoothing: true,
	flow: 0.5,
	angle: 90,
	spacing: 0.15,
	rotation_mode: "fixed",
	activate: function(brush,context){
		brush._rawImage = new Image();
		brush._rawImage.crossOrigin = "Anonymous";
		brush._stampCache = null;
		brush._stampCacheKey = null;
		var pencilImg="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABqCAQAAACmV58FAAAAznpUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjabVFbEsIwCPznFB4hAUrhOKmtM97A40sCaqMyk+WxmQ0QOB73G1y6ISnwsqqYSHFjY8PmgZawNrAWHjiMk/J8qoO0JNBL5J4iVcn7r3p9C4RrHi0nIb0msc2E5dOoX0IYjnpHPd5TyFKIMIiaAi07FdP1PMJ2lNk0DnRgndv+yVff3r74O4R4UKXiSCTRAPUjQM0DdkS/5DOQRRyYO/OF/NtT6T+T3cL0E/QhxlhtngKeR1ljAjMOFF8AAAEiaUNDUElDQyBwcm9maWxlAAB4nJ2Qv0rDUBTGf63FiuhU6SAOGVw7tpOD/zA4FGoaweqU3rRYTGJIUopv4JvYh+kgCD6Eo4Kz340ODmbxwuH7cTjn++69UHciE+eNQ4iTInO9o9HV6NppvtGgTZMW3cDkaX945lN5Pl+pWX3pWK/quT/PejjJjXSlSkyaFVA7EPcWRWpZxc6d752IH8VOGCeheCneD+PQst314mhufjztbbYmyeXQ9lV7uJzTZ4DDmDkzIgo60kSdU3p0pS4ZAQ/kGGnERL2FZgpuRbmcXI5Fvki3qcjbLfMGShnLYyYvm3BPLE+bh/3f77WPi3Kz1l6lQRaUrTVVfTqF9yfYHkHrGTZvKrI2fr+tYqZXzvzzjV8/qlCQQ7zFxQAADXZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+Cjx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDQuNC4wLUV4aXYyIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIgogICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgIHhtbG5zOkdJTVA9Imh0dHA6Ly93d3cuZ2ltcC5vcmcveG1wLyIKICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICB4bXBNTTpEb2N1bWVudElEPSJnaW1wOmRvY2lkOmdpbXA6OWJiNzJiOWMtYzJkZS00ODEzLTlkOGYtZWUwMmNlODNkNTA1IgogICB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOmI1OWRlZjI1LTFkNzQtNGQ2Zi05ZTZiLTkwYThjNGY2MDUyZCIKICAgeG1wTU06T3JpZ2luYWxEb2N1bWVudElEPSJ4bXAuZGlkOjE4MjE5ZjAwLTliODYtNGFiZS05ODlkLWQ5M2QxNWIzZDQ3NSIKICAgZGM6Rm9ybWF0PSJpbWFnZS9wbmciCiAgIEdJTVA6QVBJPSIyLjAiCiAgIEdJTVA6UGxhdGZvcm09IldpbmRvd3MiCiAgIEdJTVA6VGltZVN0YW1wPSIxNzc2ODQyNTQyOTEyMDMwIgogICBHSU1QOlZlcnNpb249IjIuMTAuMzYiCiAgIHRpZmY6T3JpZW50YXRpb249IjEiCiAgIHhtcDpDcmVhdG9yVG9vbD0iR0lNUCAyLjEwIgogICB4bXA6TWV0YWRhdGFEYXRlPSIyMDI2OjA0OjIyVDA5OjIyOjIyKzAyOjAwIgogICB4bXA6TW9kaWZ5RGF0ZT0iMjAyNjowNDoyMlQwOToyMjoyMiswMjowMCI+CiAgIDx4bXBNTTpIaXN0b3J5PgogICAgPHJkZjpTZXE+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDphY3Rpb249InNhdmVkIgogICAgICBzdEV2dDpjaGFuZ2VkPSIvIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOmVkYzkxN2FlLTZlMGUtNDM2Mi1hOWNjLThlM2ZlYThiMmEwNCIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iR2ltcCAyLjEwIChXaW5kb3dzKSIKICAgICAgc3RFdnQ6d2hlbj0iMjAyNi0wNC0yMlQwOToyMjoyMiIvPgogICAgPC9yZGY6U2VxPgogICA8L3htcE1NOkhpc3Rvcnk+CiAgPC9yZGY6RGVzY3JpcHRpb24+CiA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgCjw/eHBhY2tldCBlbmQ9InciPz7FatumAAAAAmJLR0QAagfqq3QAAAAJcEhZcwAACxMAAAsTAQCanBgAAAAHdElNRQfqBBYHFhYW+irEAAAJXElEQVRo3r1b23bqug6ddpwLAUrX0/n/vztve7VcArlpP1iW5QQolLDx6FhjNKxo6i5LqsEvPgQYAAZGfkHx1899zC9IGxhYIW+E/AgCgcy7ABBgYOUYWP7/BGAEYZTzBIiHv0meeMYngDCsAE944PMECPMg7564g4NDBicgDPMfiPd8BowYzTIAyAjxnI8TCMEEA/GOD4Mw9NPb3UPkHRwKdQIEyyrw/Hfo0Mqx6NDTjxDcj+QzOOQoUaBCySdHMQPQo0OLC58MGQwMehruQ3APkC9QosKKfypUKJAjZyIkADz5M844w6FhP8F9CO6u6WVwKFFihRo1VqixwgoVShSsBMMm2DOAMxo0yFk+bCP3FOF+JF9hhbWcFWqRgWMSJAo444wGJxTIFQCgo8E8B4AAy8JfYaNOjTVWKFGgYBV4G+jR4YILGpxQsoIs+xiBQHTDKd1N9/Smt8IaG3xgiw9ssWEpeEMMEhgZQIszGlZQzlGCyYPQgR4GQAaZkN/iAzvs8IEtttigxgpVIgEfhjq0aNCwghxHiWCiI8brxujuiH+FGhtsscMnPrHDBzbYsAS0kKMX1CyBnA00POUMcc0S3FXxZ6J9T/4PPrHDjq2gYh+wCkCQQaXUE6XTS46gHwEQlPg3+BAAn/jAFjUqlCoOGiXmAR1HysA/sYdIfqDe3AfwP8Ay/7Xo/5MhbEX8kXw0sxGDZIqMn3v/8E4qKeougP97/gtlfp/4gz/4gw9s2AEDeV0PeDWEJBXJhwjRokWHHgNRaopTFXj+K+H/k88OG9RCPlMVUSzKRg4+4SmxZYQc4UEMhugWAOV+wf53Yv9rca9IPtaEAMFi5JrJsAF63/AR0kPoMIxJSHJ37N/7/w47Nr4Yfs2E/2AJuloktoBWEtQZZw9B24G74f9eAR/Mfc3Gd417DYMYWgjBA4vfp6gGDS5o0euw7K7wX6HGhmWwnXEfTM/crLAC+aACn6BOOOLEEIYYD9yEfx0BAvmp610nbsSMSZllAHDEAWscUaGBQx9jokv4zxP+t+x6qe7v1ZFeCR6Ekyx5xhFbHHBAjSNKXNDFmJgC0BawkcBTTALPI0WuZSWEhHbABmsJ4xn6AMAqBfgI4MuPDWe+mNnsA+QDCCNlfMES3XIe8QxlsIQEAAwscqWCteDNH+Y+heCL+RwFKqw5j/qSzlcLZgogFGA1aoZQJ6737Cfco4JZr5mpUpLVDEDOKqixRq2++iz/0R21GtYsgYrZ0gCUCwYAawk9vyF/TQ01V9YSU0hJwIiw4hdfET+UZfk3h/dWUtTze60yQR8FKyUo92v+tQycKHelVJClAPQNyH8tF+d75eMdMkTYeK3Jw9XWSgzIlAxi1fd7/q/ZQaVkm8EQSyB+JZAvVfB99ROCkrewki81crW1UgflAqFU4QcvqwATGZRpUW8Tfy34+l0kue9VCUzfX6iLS6KCnB8uST6FUKoGRwYLY2FJe2s+AbAM+ZTFUop3CzMkKnAMQPu/WUwCAULOFsbXd6tSZ64uFnYxCaRKCC0uUfJUAvlCAei2M05YtCpiOzlLOOCt3Bg6jQIgRqtMRPNz9fc8+ZRNy9dXUcG0DWsWVYFRhphSURKIj5flf2qIk16zloDuhC9LXBuiFc8zMReY5KH5zSThAf6nIBBDMdS18l38Q0KbERWzDUD9mN9NUp7whYR8rIoxg4C3SwGAN8KUY8J/+rFJj+P95EPfVCZtNiEdHr4DCCnykQ7fYsNtfvLwTdwndKxqJvhW23tkQPLvhI6VZgq3lBMQS/M/6tliuBNGwYx66reoDChp6CaMWtVsHlRLmRZXAUnjutds2isPoxJocf77KQSrRNPLeYcKRukc97p1b1VHL8w9oxUsrQLdulcSiNjC2HVpCHGkkdKguQRCW31cLCRFL+u5dR1nBwRYg1lfv42PFxZ/O6VgEgnE4XMvzricCgY1NwiGOFFBqwYLy0EgxeBFAHTaBiAGEobPbfzCixAomSvGuUkfOuapBMJo4aLtdAEJDNy0Dm9vEy8wSGY7ZzQ4y1deU4OOsS2/WUY3fsXDymyjV+QbXEQJtAD/g0zWG353ooJopZfZ115JTHGe6AfbJzQsg3YOQEvgxKOV7ta49Un38/o/8XvP7GUqF3gr6FkCJxxlutO9kJxJOeBFAbjgwhs2k6p4kA2AMGC6JPGAfk2+TdgKTk6YAYgTriN//RV31OGnkTeecGYJzACMCYADDjgpd3xOBqn4G37fEce5BJyMu0ZBe8KBT41Stezsg3fG1Psv8j5tWTQf25E4YpDAHmtUahnhkYsrTbLfhd+2F5kG974BoGWB7dXUKAKwajZ4m/w40f4ee+xZAmd2wfnoVpRwFghhcBHblqR2gzAZ3+vUE8PaEXt845sBhCB/Y3ZMGDgYnXDAXsYLcSElU4TNxCjT2j+8x5P3AJQFXJ2eiwy8H+zVgCUsJOS8J3CtixCvN2GnyHP/hS8BMON/uj8wMvYGRxldFMnognjaY1UnidStb2Dj8770xeS/xQK61AImAAxoENOJowunVrYKOIzIMCZOGbZKB2X7e3zhC3+Z/z2OHAEmK11uJsgQOkte2otTTi/gsCUzX2odxPZPOOILf/GXJZAYIO4BMEQjO2PBjXWX7MQM6ndWSUC73hlHfDOAIIFggOMPe0RiBw4nOFnd1FuDVQILyUpjx9rf4xt/8Rf/MIAD55Vhyv8VAGIHvrufyVJaKNvU8HWyrhKy6UH0H8mzAz62S+bjQZYIOpKoJ0sNaVHr896eVfAl9j/ZHLkLgOPBJWmqjqpkSWWQLjSeOIZ841scMKTgqyuNV/cJDdHAEIziMVTNK2UHBnGl8yISOGCPvQrAF/S4sdrqbqaVPllK0ullulFJ6l4Vypm9pOCGw8+NasLd6qjSiF7ty42qZAsAMgVgkJWtWFGFCqi9Jf57EvAQuiu3u0ZFSCsqGNBKWe+Lz1PcnMJwu4S4s1dsiEb0MwAlb5S6mRGGy2fDd4sLk7+75H53s9oQDbMCs+Qo6dTa3qD6C/6CG2/B4wur3QxhWuMVKkLGndLQ4mmZdOvbXT8ttz+23m8mk9WYkDSAPlnwHzDc0/2DEmApUKKGbLLWqBt9wxv+wIET/ny6OF9qVY1Y8+At4jd/5GKkJorZkKT7+64/clEgpnOfySDibX/mM4GRbk+St9bnP/8C8Y7yxI3WZ+MAAAAASUVORK5CYII=";
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
	icon: "mdi mdi-fountain-pen-tip mdi-24px",
	name: "pen",
	size: 1,
	alpha: 1,
	order: 2,
	pressure_affects_alpha: false,
	pressure_affects_size: true,
	size_max: 3,
	smoothing: true,
	flow: 1,
	spacing: 0.25,
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
	size: 2,
	alpha: 1,
	order: 1,
	brush_fade_in: 25,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	smoothing: true,
	flow: 0.9,
	spacing: 0.25,
	rotation_mode: "follow_stroke",
	activate: function(brush,context){
		brush._rawImage = new Image();
		brush._rawImage.crossOrigin = "Anonymous";
		brush._stampCache = null;
		brush._stampCacheKey = null;
		var pencilImg="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABKCAYAAAAL8lK4AAAAxHpUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjabVBRDsMgCP33FDuCAkU8jl27ZDfY8fcU2rTLXuITeOSJpP3zfqXHABVJslTTppoBadKoI7Ds6JNLlskTEhLyWz1JD4FQYtzsqWn0H/VyGvjVES0XI3uGsN6FFk+T/RjFQzwmIgRbGLUwYnKhhEGPSbVZvX5h3fMd5icN4jq9T5PfXCq2ty0oMtHOhTOYWX0AHkcTdwQCJi6jEW0jVueYBAv5t6cD6QsowllMzCBlqwAAAYVpQ0NQSUNDIHByb2ZpbGUAAHicfZG/S8NAHMVf00pFqg6tIMUhQ3Wyi4o4lioWwUJpK7TqYHLpL2jSkKS4OAquBQd/LFYdXJx1dXAVBMEfIP4B4qToIiV+Lym0iPXguA/v7j3u3gFCs8pU0xcDVM0y0om4mMuviv5X+DCCIMIYkpipJzOLWfQcX/fw8PUuyrN6n/tzDCoFkwEekTjGdMMi3iCe3bR0zvvEIVaWFOJz4kmDLkj8yHXZ5TfOJYcFnhkysul54hCxWOpiuYtZ2VCJZ4gjiqpRvpBzWeG8xVmt1ln7nvyFgYK2kuE6zTEksIQkUhAho44KqrAQpVUjxUSa9uM9/GHHnyKXTK4KGDkWUIMKyfGD/8Hvbs3i9JSbFIgDfS+2/TEO+HeBVsO2v49tu3UCeJ+BK63jrzWBuU/SGx0tcgQMbwMX1x1N3gMud4DRJ10yJEfy0hSKReD9jL4pDwRvgYE1t7f2Pk4fgCx1tXwDHBwCEyXKXu/x7v7u3v490+7vB5TscrR2sgy3AAAOVWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNC40LjAtRXhpdjIiPgogPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iCiAgICB4bWxuczpzdEV2dD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlRXZlbnQjIgogICAgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICAgeG1sbnM6R0lNUD0iaHR0cDovL3d3dy5naW1wLm9yZy94bXAvIgogICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iCiAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iCiAgIHhtcE1NOkRvY3VtZW50SUQ9ImdpbXA6ZG9jaWQ6Z2ltcDo4YmUxNGZiNS02OGU0LTRjODktYWZjYi0xMzdhZWE2ZDU3ZTYiCiAgIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6ZTQxMjQ2MDktNGFmZi00MzgyLThmZjQtODZhZWQ0NjE3ODNlIgogICB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6YTM0ZDcxNTYtMDZhMS00NTJiLTgzM2EtNWRlOGVmMWRmM2NkIgogICBkYzpGb3JtYXQ9ImltYWdlL3BuZyIKICAgR0lNUDpBUEk9IjIuMCIKICAgR0lNUDpQbGF0Zm9ybT0iV2luZG93cyIKICAgR0lNUDpUaW1lU3RhbXA9IjE3NzY3OTk1ODYzMzQ2MzgiCiAgIEdJTVA6VmVyc2lvbj0iMi4xMC4zNiIKICAgdGlmZjpPcmllbnRhdGlvbj0iMSIKICAgeG1wOkNyZWF0b3JUb29sPSJHSU1QIDIuMTAiCiAgIHhtcDpNZXRhZGF0YURhdGU9IjIwMjY6MDQ6MjFUMjE6MjY6MjYrMDI6MDAiCiAgIHhtcDpNb2RpZnlEYXRlPSIyMDI2OjA0OjIxVDIxOjI2OjI2KzAyOjAwIj4KICAgPHhtcE1NOkhpc3Rvcnk+CiAgICA8cmRmOlNlcT4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6OWFiZmQ4YzAtYmQzMy00Nzk4LWI5ZmMtNjg3NjZmYjdhNWMyIgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50PSJHaW1wIDIuMTAgKFdpbmRvd3MpIgogICAgICBzdEV2dDp3aGVuPSIyMDI2LTA0LTIxVDIxOjIyOjA3Ii8+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDphY3Rpb249InNhdmVkIgogICAgICBzdEV2dDpjaGFuZ2VkPSIvIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOmIxZjMyZjMxLTUwMWQtNDY4My1hMzZiLTNlMzQyOWIzYjNmZCIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iR2ltcCAyLjEwIChXaW5kb3dzKSIKICAgICAgc3RFdnQ6d2hlbj0iMjAyNi0wNC0yMVQyMToyNjoyNiIvPgogICAgPC9yZGY6U2VxPgogICA8L3htcE1NOkhpc3Rvcnk+CiAgPC9yZGY6RGVzY3JpcHRpb24+CiA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgCjw/eHBhY2tldCBlbmQ9InciPz6MSqnZAAAABmJLR0QAAgB/APKPnVRCAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6gQVExoaumONoQAAE91JREFUeNrtnFlwZOdVx//39q7WLlnSSCONZvF4Vg/jcWzHceykDAQIDksIhCVQqWKp8AJVUFTxQPHAC0XxxAO8+YEqs8QpKIpAEkzIBuV4CTOeffHsM9JoH0mtXqTu/njw7zhnrlqyxo7LD6GrVLf7Lt93zv/s5/uupE0+IYTIH3/oPj8MjEfvEZhIUoiiKCSvJ8/551pd+6A+6Xf53D5JvyapXdILIYTjAFHfFO0NGP8ggYnfpfpnJS1KOijpTyX9pKQHQwhRCCE2RvwYrcbzjH9QWhHfr71zX0rSLUllSf8pqU9SVdIDkvpCCBnuiz2TyTn8uXea//3yR/FG6rmJRCJJvZJqkhqS5iRdQCMWJC1L2ubMqxhCsHl+PoTwQgjhsyGE8RBCm/mhJBitwHo/gIjvx/ExeUFSh6S8pIqkNhjPAYg43yWpKWn1rcdDmmcbkn5Z0u+gSVEIIRtCyDnQN3SiP2hTid9J1YxxZ6dFSXVJJUlX+X5X0jRM12GsBCerPBdJGgaENyT9B/d18kw6hJBi/k2Zb0XjDwyAVqaQmDgjaR4GuySNSXqK4yqMzkmqJcaKYXRW0hlJM5wrAMJ+Sc2NHKI3ka2a61aAua8wCBFdknpweE1JpwDEGGqaOYQQPIFd+I00JhQIo7fRhKoxuRFD96v+W7l/S1Egca2Co4slvSnpsKRHJR0iEghG3060QggpJF3hmSFJOwAl5q/6XlLvd2sG8WZobaBynTjANSR4iqgwheSVsOG9kh5HM+qSHpK0m2spnm2gCRkA7QW0LTO3iRmkNns+nXQy3PwM0jrhpGmEdEFsXtJHue8kPuH3JT0h6WVJ35V0miTptyXdwUyuoRkdkj4j6VOS/lHSZUmTkv5G0jlJL4UQTkk6SxSpRlFUcbTEHuhNzKbhaI+iKGquA8DbHSA8h+ReDCF8GebWIDwjabukcb53S3rNqXJR0qfJEl+X9Bwg3uH+KcY7JGkQ/5EnkhzBVMZ5ros5L0mqJDLHZovoEEvaxViKomg2AVBoaQIePSa5AKHLOLuGG2CQCR6E2UVJ3yMbbMJsSdKLSPQC42RgrkfSAJpzAHMYg+lbbt5d+ImrhNhdzB1ZYtVCtTvRqD+X9EchhIEQwt4QwthGz2yUCAVU8iaOzVLadojqhKgZYvoY9nwOQCpI9VuERMHoGUl7MJkYMN5grDNoVoY5ZyR9he8pSaMA70NyLlHRBsYrMt+jCOpxTG6dqWwUBaoQtY1BIpfM1GGyjor+Bj7jIYC4BUAPQsQImtCG5LOSfknSh5mjDMEHJC1hajkAuYQ2dOJLmglV/pykr4QQvhBCOCrpk5jeNa4fk3Rd0iv4kWirUWCASbohZD9euReb3Y9jO0YUqGK/JukFST8NQQcYZwKA9sDo/wJKASDuAHgRpgcAJzD+FyWtJZhYg76j+KwHGC/H2NeZv8RY6SQIrRKhHIjfgrkdqJ7VARkIXoaAhyWdxxG2c+1hSf2SPoGaF8gAVzhedaBknAY87nzKDHSUyDDnnZ0/iq9ZIyJNk18MY3pNotA8WtTLuI1NU2HQaWCjgqgzSKcBql0Q/e9Mdl3SP4P+JyU9wmRZbPgcfmAQUI9K+hNMpAkoMYSOYu+DANAGwz8m6Um0p5vw+YuSfpVnGly7hdPdDdCLCCrPuHLHlhqwT9JfYLMVmPs0zuzrkn4LaXQz8S3U2XKFW6jiClpzFFWeZa6Pcb6COdRQ+5PY7QzELkv6Y+b9mqTfA9CfBdQu7r+EphVw2KPQdtP5r29I+jLzryW1IAlAAwKOQVyVCfpJX38K9RXo7kbVPoaz60SdC/iBFbzvqmOsBFAPw/BdSTt53sxvD6A9yX1j2PA3AOIiNF13PYnHoPcNABIVpyVeJqRUCMHC+joA1phgDmI/g33dgJhZSVcwgQwgHIOpMX6vYPfdqOM8WjKEj+gAoNjNNQdgdcatc88lAN8JrXthLgtTTzB2lXlTRIGHJH3J0b7CuE1Jde/w04kQmIXxOt8nMIdDMFpEOiWkVwG0WSLDKI6oyfnYOagepLvMuUEn8Qy/K4xlUh1D0ikXnq+6vsNZST+Kr3gZoAow3ADsbgTTxtitM0FXslb5287vfhzZt5j0Cuq8mxDVg/qa/QUAKHJfmixuAKIySM3MKA3QNeZr4HT70J7TgOkl2Y4ZLUh6FRPchbfvRxiHoWcSAJvQFm+WCXYzyAmYPYcadkr6EdBvILkeCLEcYAQVLTh7G8URDrmYnsKcehjnOOd3uLCXg7lJmJ4DjDukylMANOZC8jD3XmL+E2jeOOOvmp9zPcp1PsCcxQCEtAFSDmf1IZg2p7bgjtucHVvvbx/PjzpC+2EgBvDdaNUEGnEHWiYBbtzF9kN8t3ZcO+H3DPMd5tiQ9OuS/ouIcA3NadB4aWwGwBJHQ78TdJ+GsSH8g6l5hetlmEoDglx7rB/NKrhSuMaz55jnAIDvREtOANgRTKCMtsxDSwf3nQLcPiLANkBclvRv0GZZ5bykpq8gk7XAHI6iDLIByZva1/lehvhFpHAZhOe4tsazdVTdMrkV10VeRDrm1RtoRBUaRmDwMr9rzDXMuDnnIO86x3dX0v8wz3MuwkxyPfIFVLJELIPWGAx9iHvKENzBw7Hz3Hmyvyy/CxA275xeGs0xyadcvjCCNllf8QJHa6BehrkIIE0IFecL2gE8Da0pnKNlrxY2A0t4zY36AQNMfsUVGk+jlnlXpjZdWIq4N4O5xBC85rTH/gZdOKzzN4O6XoP4Iy49buDRrUyOkWaZ41Xm2QOjtzHhXhzgKcYyB++7SfdqACDEgDDiau0YgrudmqYhoMKEBZidRUqzLiewbtKyq+3z7twQ4+3h2E6dMMA9dWy6SqyfQwDD2HuWObP83cJ8DzN3JxHmbZ/nNSCd0IA5R3ADaU3B6B0kmEJdC67R2eDY7uzTusBZVG/RVZsdjHXRgZCFySUAtHDXhprvpoewxLyW9U3z3KjLF25ihk+gzZfRitlkG81ngjGTpSCwiSSWIc4kYktjndbPBwD/3Ww0cL/Zrq0sldCunRA3JelnALCEnygy3hWYW0HF9zrfc8P1DL8LOFYBXsW80syzAh9r68IgjVBDdZbJI1edRYBjfX87Z6lwDcnGgJNzoXCNcYc41wlAJRi67lLbNLb+EegY5HcFqc4BpjG2QjrcxpgrLg3fAy1WFl/mfNM6ylEUhWRHqAyh/S6U5XBC1hHOwvAKiC9DlLWxFvEHk9xnLTRraCzzPQVg+1HveWcyV1wItNT5KLZcgb7XGfdBolYWZq02CQAcAfqQC4HhnjzANja4BKeOI9kJujmkbsvZKecQ29yy16jLu0d5LsNxF9/NYeVdZXgaZgouZb7NM3uo7mYJkQskRHmyxPOYQJ5xC5jSTQCzaGPhMdDkjZPFUJMBrCS1UFNA9YOLxU3O150TXHDPr7i0OAczk86BWQToQvIdDswG7bV5zpUxl2WknXKr0XM82+NK9Kprw5vUc5hTFl4b1liNE2v/RbfA2YSYaefxa1xPwcSC2RW5fBtMW1VWh5ExiMox8ZIzJYvvvS5bnICWDq53YQ6XmXu7K6SsgNrJ/Vm+S9JLmEzG1jVDCPG6KOCWxNoZuAxxd1G/yNnsIqCkmTzt8oE1pGEO0Bxi1SVO3ajrNYi1Vrr1IV6liKpwj8Xzx0hsJgmLOxDQFGZyx4Xufp59BhoW0JYoiqKm3/OQdIJ9LlevY2O38bqWK8zCVBoG7jh/MOs2R0y5TNBa7LY8PoZKvk57vBs7DpI+joTNaZbQCmvRZV0bvejGuQ2IFefszmGy03zvTC4BxIYGGrAMs9MAYGbRcD3DVYi54draGXp321yIMxNbBRRzfFZbLMH4EESbNz+OtAaI+d1IcYUMNe/AmQKISWi2aDUBs1a7lDGjcnLFO7ZuECcWQHIPE0w4OxW23gEoIzBnXVkLb/MuU8u75yw02SJrk5L3NKp9FwmPEAan0bRhrpVoci4z9rIL0x/GVExLbkFXGxpyHoFVkythcYsWWS9OxFZ7511dYNFhDg0Zct2fKuqdB+08TFuuMOd6AhUk9BGk3I9vsRA5RH9gjGdymIiFyT7GGwbQCWeaPYw/4xxtAe2MWVxd3w/gs+RC3YxT32KLMGit56I7P+t6BZZXpLlWlvT3EGvRIANjr3B/DeaOoI02VxurRrtwhk2OC+QrPdA7RP7xFLRluGcAp9mMoqjp9xslGyLzbr2uCLq7YcQ+fa4iLELkNYgfcY3Hu6BuS2q9+AkrfYsOyD6eW2FZ7CK+5Az3RyQ285wLLKZU0aQVxj/L9e+42uYY65S2Iettvx9CiNKJ3SFp0GwweMHV/HnUvg+tSLk9P8MwlEKV1/AVdpxxWWAfz02iFTmnfR2kxgsw8z1C83bXTruGUJ7h2Rd53hq0a/iAJ/mLJH2T8JoLIVR8SZzsCdoGyE7+yo55S4BW3WapBvbbdA2QvFPxSWfz2wl5fUjMlrMqqK1tmlrlelHSLyCQPuY5AaO2p6gbB2hmlsaBDrFOuROz3CnpWYCQ6w6tAyDj1KQT2+lD8qvOe5dRtXY6tcGVwwt8H2OMeUJclbU6S5UtGWrHUz/iukoRtj3DcwMul49Jzk6hfZ1EkoxbTzgt6QvOIXdzbfH7Fv+W1icbIvM4qXHsx5okWSSy4oob8/g110cocM7ic79rrC5xbjvjWOXX7dphaaTb5fKFnEuo5qHjNBpwETUfhdZxSV91+w9SURStsYO9mdz5FkKIrBawLTBLSGQNovKuIRm5+GvE97qWVM0VRuNIIgsIGTq1/+oqzXbAXmU+Wyp7DdsPzFUkStRZJh9z3eQ9jN3DvTdcVeidfGi18zWKorcZD65V3AZjZqtDEGbFkaWz+128TzNGydUGppI1nu1jW13N5f0HqPOPkapOO62xZfgMTjaFfRtzOxgnjTY0AbHPdagaTtpxsiEqSWm3xUzOs6+6GCzX+GxzYa7ssjoDMA0TIy7/t21wR2hqphjHnN1Ft3eo6DY7lDGXRY5rhFXbpnee+/fSuX6J0Djl1iRSiUWfe+z/nlrAZXNNHNmw232Rc8vLWXdfG+fNCXa59pmtEI3x/EnCU8FljZ/luJjoM2SR5ElXZnfCeA/P29aa26wAnefcRwFqIIqiuuMvOH/3/ba4twe3/9+apN9xObl1dmf4bR3kEoRHLpT6dYMFtGAR751x3txUedKtF/Yzxjmk3uuyzhmXVA26PoFcm+5la8P5bf6+Fe6bonGiH9DE4w5AlJWQWRcmU64U7oKgtNOIHLbfRFq2YrSdOj/j2uAxjsuW5suuktwBKKtogRVb1wGmn3E7AXeYNngHgqxbtrfZ+wWtmqJWgIgl8S7ntNJOQwZhwhxk7FS74LpIbajqdrf6nOPZs25r7Bgm18f8HeQG29zaYSD2fxy6OshDDiG0bsaxlnxIvmuQ3I6fLIaaOKUcg32b/voCkpp2S1YTHGO3/tZAImYyJmXb6/eXAFmlCLqC7X6R8HcFUGZdEZNjXmuv7wC07RRHKaR/U9J/w3xHwuaV2AsdJT2jVwuzw2EkMy7p8zB3AScTs/PqMYh+BLXP8lzWmcUCoFQl/ZOkX2GerzPmJba5lGHsNUwnjxnm3bJ7ie7PMg51n6SfYI4JtutZB6ns6pgNX8uznZNtURStoB4Ntyx1PIRwkM0GvajjEqo65BYqnwfxTkl/J+l32Q47R0I1BcPtbgvMA6znD7mdJ99mK57d0+6qxCxOsOa2x5ynTF7i+yhHa4spuT1+HQAgs9LCSVjouKC33g08ioPsAOUHJL0A8i+hNUWIvOEiQReV2HHXYHkd9e136woVwPxbnNk0JrAbIPsAa4hMseYWSaxBkkNrrAOVCyHUvAms8wH32MO99hLczspRfMNJ/ubRiBJFUR2Cz7o1fsv+brK/b8G9bmP9xFOMm0GqB8kO33Q7u1Juj+HLgHeQ6HCVCm8QQMtO9VNq8RLWut3ird7oTLwmZ4sf+/AHHZL+QdKfwUAdaay6vPtLlK5XYOQPIDC4tpdVfkfcjvFDqH3FvU7T43ab7qYesIaMdYkv8/2upB9nI/d4q73BLV+ZSb6tlUCpiWRto+M2mpM7UesV1zFuOud6A0Zsp/Zdt2PjKulyD9J+FJM67jZOHSc6PAvottHpBBo2zXh/lehpWqO05u3fKsKkCaRbqUaLV2ieR9X78eJPQUTd9Q9yrvBpYgpPI8XPA0YacKzVfYpU9hP4gbRbZ0xhJiW04ylXl8y7bTp1V580XUab1Ojmpi9NJV40SoaMqSiK/oXBnnf9PO8r2hITW3r8Kg5qxIW6YaRvYe5TbottCjBtK85hSX/o2t2XXQK2xus8VqkmX/5a9+JnkrctvTjpTYQBSi3eMplLVF4N1yM4iPa8AkhG/D623d/BN9z07Sq+H+TePJu2bBe7jSPeO661SnhCCCnL/VvlAlt+eTr53m4yerSIIBNI7VlJv+k2Pva4xdIi6r/LFUjBNV9SbgN3xHhdDuyqpFwURTW3wtWZkH7jHZ3gVj+tHOVGYTSE8Ne0p8yDz6AFy9jxNrdecNoxb7VEid/fBLTPce1NwNgh6UYUReWEJpYSC7KbvnV+3+8ObwUcV3JeCiG86cCq4dltJTqDE+ywd/ywtSU3bk1vvVi5V9LPYQp7MYNdIYSLCSkHz/w70R3dpwakk/8nxDmdDA3IDf8fiH97kzWILlchrkVRVPVOLOnMQghFF/vrfu//+/G/Bd7VJ1l/v9f/+OAattoA0P//vJfP/wEaIW9LaiV5yQAAAABJRU5ErkJggg==";
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
	//Re-apply an undone action. Pops the most recent entry from redoStack, restores its
	//pixel data to its layer, and pushes it back onto undoStack (now the new most-recent).
	action: function(brush,context){
		var self = this;
		var plugin = self.plugin;

		function setUndoButton(bright){
			if(typeof self.$undoButton !== "undefined") self.$undoButton.css("opacity", bright ? 1 : 0.5);
		}
		function setRedoButton(bright){
			if(typeof self.$redoButton !== "undefined") self.$redoButton.css("opacity", bright ? 1 : 0.5);
		}

		//skip orphaned entries (layer deleted since snapshot).
		while(self.redoStack.length > 0 && plugin.resolve_layer_by_id.call(self, self.redoStack[self.redoStack.length-1].layerId) < 0){
			self.redoStack.pop();
		}
		if(self.redoStack.length === 0){
			setRedoButton(false);
			return;
		}

		var entry = self.redoStack.pop();
		var targetIdx = plugin.resolve_layer_by_id.call(self, entry.layerId);
		var targetCanvas = self.layers[targetIdx].canvas;
		var targetCtx = targetCanvas.getContext("2d", { alpha: true });

		var img = document.createElement("img");
		img.crossOrigin = "Anonymous";
		img.onload = function(){
			targetCtx.globalCompositeOperation = "source-over";
			targetCtx.globalAlpha = 1;
			if(targetIdx === 0 && self.settings.enable_transparency == false){
				targetCtx.fillStyle = "white";
				targetCtx.fillRect(0, 0, self.width, self.height);
			} else {
				targetCtx.clearRect(0, 0, self.width, self.height);
			}
			targetCtx.drawImage(img, 0, 0);
		};
		img.src = entry.data;

		self.undoStack.push(entry);
		if(self.undoStack.length > (self.settings.undo_max_levels + 1)) self.undoStack.shift();

		setUndoButton(true);
		if(self.redoStack.length === 0) setRedoButton(false);
	},
	cleanup: function(){
		var self = this;
		delete self.$redoButton;
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
		//the color-picker change handlers re-invoke the active brush's activate() with a
		//context reference. resolve it lazily so a layer-switch between toolbox creation and
		//a color choice routes to the right canvas.
		var ctx = function(){ return self.plugin.active_context.call(self); };

		//color dialog
		self.$settingsToolbox = self.plugin.create_toolbox.call(self,"settings",null,"Settings",180);

		self.$cbPressureAlpha = self.plugin.create_label.call(self, self.$settingsToolbox, "Color");

		self.$settingsToolbox.append("<div style='margin-bottom:40px;'><input type='text' class='color-picker' style='z-index:1;position:absolute;margin:-10px 0px 0px -30px;'/></div>");
		self.$settingsToolbox.find('.color-picker').drawrpalette({ auto_apply: true }).on("choose.drawrpalette",function(event,hexcolor){
			self.brushColor = self.plugin.hex_to_rgb(hexcolor);
			if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,ctx());
		});

		self.$settingsToolbox.find('input.color-picker').drawrpalette("set",self.plugin.rgb_to_hex(self.brushColor.r,self.brushColor.g,self.brushColor.b));

		self.$settingsToolbox.append("<input type='text' class='color-picker2' style='z-index:0;position:absolute;margin:-40px 0px 0px -10px;'/>");
		self.$settingsToolbox.find('.color-picker2').drawrpalette({ auto_apply: true }).on("choose.drawrpalette",function(event,hexcolor){
			self.brushBackColor = self.plugin.hex_to_rgb(hexcolor);
			if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,ctx());
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
		self.$sizeSlider = self.plugin.create_slider.call(self, self.$settingsToolbox,"size", 1,200,self.settings.inital_brush_size).on("input.drawr",function(){
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

		//---- Stylus pressure curve (global) -----------------------------------
		//Single gamma slider controlling how raw stylus pressure maps to brush output via
		//pow(pressure, gamma). gamma<1 = gentle (boosts low-pressure strokes, helpful for
		//Apple Pencil which rests near p=0.2-0.3); gamma=1 = linear; gamma>1 = firm. Slider
		//position t in [0..100] maps as gamma = 3^((50 - t) / 50), so center = linear and
		//endpoints span [1/3, 3]. Only takes effect when pen_pressure is true (raw stylus
		//input); mouse strokes are unaffected. Setting is global, shared across instances
		//and tabs via localStorage["drawr.pressureCurve"].
		var gammaFromSlider = function(t){ return Math.pow(3, (50 - t) / 50); };
		var sliderFromGamma = function(g){
			if(!(g > 0)) return 50;
			return Math.max(0, Math.min(100, Math.round(50 - 50 * Math.log(g) / Math.log(3))));
		};

		self.plugin.create_label.call(self, self.$settingsToolbox, "Stylus pressure");
		self.$settingsToolbox.append(
			'<div class="drawr-pressure-curve-wrap" style="padding:2px 8px 6px;">' +
				'<div style="display:flex;align-items:center;gap:6px;font-size:11px;">' +
					'<span style="flex:0 0 auto;min-width:32px;color:#666;user-select:none;">soft</span>' +
					'<input class="slider-component slider-pressurecurve" type="range" min="0" max="100" step="1" value="50" style="flex:1 1 auto;min-width:0;background:transparent;height:18px;margin:0;" />' +
					'<span style="flex:0 0 auto;min-width:32px;text-align:right;color:#666;user-select:none;">firm</span>' +
				'</div>' +
				'<div style="display:flex;justify-content:center;margin-top:4px;">' +
					'<canvas class="pressure-curve-preview" width="120" height="44" style="width:120px;height:44px;background:#fafafa;border:1px solid rgba(0,0,0,0.12);border-radius:2px;"></canvas>' +
				'</div>' +
			'</div>'
		);
		self.$pressureCurveSlider  = self.$settingsToolbox.find('.slider-pressurecurve');
		self.$pressureCurvePreview = self.$settingsToolbox.find('.pressure-curve-preview');

		//redraw the preview canvas from the current gamma. Maps x=pressure(0..1) -> y=shaped(0..1),
		//flipped so y axis grows upward. A faint linear reference line shows the no-curve baseline.
		var drawPressureCurve = function(gamma){
			var c = self.$pressureCurvePreview[0];
			if(!c || !c.getContext) return;
			var ctx = c.getContext("2d");
			var W = c.width, H = c.height;
			ctx.clearRect(0, 0, W, H);
			//linear reference
			ctx.strokeStyle = "rgba(0,0,0,0.15)";
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, H);
			ctx.lineTo(W, 0);
			ctx.stroke();
			//actual curve
			ctx.strokeStyle = "#2a7fd6";
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			for(var i = 0; i <= W; i++){
				var p = i / W;
				var s = Math.pow(p, gamma);
				var y = H - s * H;
				if(i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
			}
			ctx.stroke();
		};

		self.$pressureCurveSlider.on("pointerdown touchstart", function(e){ e.stopPropagation(); });
		self.$pressureCurveSlider.on("input.drawr", function(){
			var gamma = gammaFromSlider(parseFloat(this.value));
			drawPressureCurve(gamma);
			if(!self._suppressSettingsWrite){
				self.plugin.write_pressure_curve(gamma);
				self.plugin.broadcast_pressure_curve_change();
			}
			self.plugin.is_dragging = false;
		});

		//initial sync from storage (default if unset)
		var initialGamma = self.plugin.read_pressure_curve();
		self._suppressSettingsWrite = true;
		self.$pressureCurveSlider.val(sliderFromGamma(initialGamma));
		self._suppressSettingsWrite = false;
		drawPressureCurve(initialGamma);

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
			{ value: "follow_jitter",  label: "Follow" }
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
		//size_max: absolute max size in pixels at full pen pressure. Only meaningful when
		//pressure_affects_size is on. Same range as the main size slider. If set below the current
		//`size`, the engine clamps up so you never invert the sweep.
		self.$sizeMaxSlider    = self.plugin.create_slider.call(self, self.$advancedSection, "sizemax",    1, 200, 20);

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
		bindSlider(self.$sizeMaxSlider,    "size_max",       function(v){ return v; });

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

		//---- Pressure curve (global) ----------------------------------
		//Re-read from storage and resync the slider + preview. Runs under _suppressSettingsWrite so the
		//val() call doesn't trigger a write-back to localStorage.
		if(self.$pressureCurveSlider && self.$pressureCurveSlider.length){
			var curGamma = self.plugin.read_pressure_curve();
			var t = Math.max(0, Math.min(100, Math.round(50 - 50 * Math.log(curGamma) / Math.log(3))));
			self.$pressureCurveSlider.val(t);
			//preview is a raw canvas, not tied to slider input event — redraw directly.
			var c = self.$pressureCurvePreview && self.$pressureCurvePreview[0];
			if(c && c.getContext){
				var ctx = c.getContext("2d");
				var W = c.width, H = c.height;
				ctx.clearRect(0, 0, W, H);
				ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1;
				ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
				ctx.strokeStyle = "#2a7fd6"; ctx.lineWidth = 1.5;
				ctx.beginPath();
				for(var i = 0; i <= W; i++){
					var p = i / W;
					var s = Math.pow(p, curGamma);
					var y = H - s * H;
					if(i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
				}
				ctx.stroke();
			}
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
				if(self.$sizeMaxSlider)    self.$sizeMaxSlider.val(Math.round((typeof b.size_max === "number") ? b.size_max : (b.size || 20))).trigger("input");
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
		delete self.$sizeMaxSlider;
		delete self.$cbSmoothing;
		delete self.$resetButton;
		delete self.$pressureCurveSlider;
		delete self.$pressureCurvePreview;
	}

});

//unified shape tool: line / arrow / ellipse / filled ellipse / rectangle / filled rectangle.
//the active shape is selected via a dropdown in the shapes toolbox. drawing math is identical
//for every shape (start + current drag positions, with the canvas-rotation inverse applied so
//axis-aligned shapes stay axis-aligned in canvas space), only the final stroke/fill differs.
jQuery.fn.drawr.register({
	icon: "mdi mdi-shape mdi-24px",
	name: "shapes",
	size: 3,
	alpha: 1,
	order: 7,
	_shape: "line",

	//the tool object is shared across all drawr instances on a page, so DOM refs live on
	//`self` (the canvas). `brush._shape` itself is intentionally global — a change in one
	//canvas's dropdown syncs all siblings via brush._shapeDropdowns.
	buttonCreated: function(brush, button) {
		var self = this;

		self.$shapesToolbox = self.plugin.create_toolbox.call(self, "shapes", null, "Shape", 140);

		var $dd = self.plugin.create_dropdown.call(self, self.$shapesToolbox, "Type", [
			{ value: "line",          label: "Line"             },
			{ value: "arrow",         label: "Arrow"            },
			{ value: "ellipse",       label: "Ellipse"          },
			{ value: "filledellipse", label: "Filled Ellipse"   },
			{ value: "rectangle",     label: "Rectangle"        },
			{ value: "filledrect",    label: "Filled Rectangle" }
		], brush._shape);

		if(!brush._shapeDropdowns) brush._shapeDropdowns = [];
		brush._shapeDropdowns.push($dd);

		$dd.on("change.drawr", function() {
			var val = $(this).val();
			brush._shape = val;
			var siblings = brush._shapeDropdowns;
			for(var i = 0; i < siblings.length; i++){
				if(siblings[i][0] !== this) siblings[i].val(val);
			}
			self.plugin.is_dragging = false;
		});
	},

	activate: function(brush, context) {
		if(this.$shapesToolbox) this.plugin.show_toolbox.call(this, this.$shapesToolbox);
	},

	deactivate: function(brush, context) {
		if(this.$shapesToolbox) this.$shapesToolbox.hide();
	},

	drawStart: function(brush, context, x, y, size, alpha, event) {
		context.globalCompositeOperation = "source-over";
		brush.currentAlpha = alpha;
		brush.currentSize = size;
		brush.startPosition = { x: x, y: y };
		brush.currentPosition = { x: x, y: y };
		this.effectCallback = brush.effectCallback;
		context.globalAlpha = alpha;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},

	drawSpot: function(brush, context, x, y, size, alpha, event) {
		brush.currentPosition = { x: x, y: y };
	},

	drawStop: function(brush, context, x, y, size, alpha, event) {
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x,   sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if(angle){
			var cx = this.width/2, cy = this.height/2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy); context.rotate(-angle); context.translate(-cx, -cy);
			var dsx = sx-cx, dsy = sy-cy, dex = ex-cx, dey = ey-cy;
			sx = cx + cos*dsx - sin*dsy;
			sy = cy + sin*dsx + cos*dsy;
			ex = cx + cos*dex - sin*dey;
			ey = cy + sin*dex + cos*dey;
		}
		context.globalAlpha  = alpha;
		context.lineWidth    = size;
		context.lineJoin     = 'miter';
		var rgb = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		context.strokeStyle  = rgb;
		context.fillStyle    = rgb;
		brush._renderShape(context, sx, sy, ex, ey, size, brush._shape);
		if(angle) context.restore();

		this.effectCallback = null;
		return true;
	},

	//draws the selected shape into canvas space. the caller has already applied any rotation
	//transform, so this just draws axis-aligned.
	_renderShape: function(context, sx, sy, ex, ey, size, shape) {
		if(shape === "line"){
			context.beginPath();
			context.moveTo(sx, sy);
			context.lineTo(ex, ey);
			context.stroke();
		} else if(shape === "arrow"){
			var dx = ex - sx, dy = ey - sy;
			var len = Math.sqrt(dx*dx + dy*dy);
			if(len <= 0) return;
			//arrowhead scales with line width but has a sensible minimum.
			var head  = Math.max(size * 5, 12);
			var ang   = Math.atan2(dy, dx);
			var cos   = Math.cos(ang), sin = Math.sin(ang);
			//base of the triangle sits behind the tip by `head` along the line. stop the shaft at
			//the base (slightly inside it, so a round line cap doesn't poke through the fill).
			var baseX = ex - cos * head;
			var baseY = ey - sin * head;
			var shaftEndX = ex - cos * head * 0.9;
			var shaftEndY = ey - sin * head * 0.9;
			context.beginPath();
			context.moveTo(sx, sy);
			context.lineTo(shaftEndX, shaftEndY);
			context.stroke();
			//triangle: tip at (ex,ey), fins fan out from the base. width ~= head * tan(angle/2).
			var spread = head * 0.45;
			context.beginPath();
			context.moveTo(ex, ey);
			context.lineTo(baseX - sin * spread, baseY + cos * spread);
			context.lineTo(baseX + sin * spread, baseY - cos * spread);
			context.closePath();
			context.fill();
		} else if(shape === "rectangle"){
			context.strokeRect(sx, sy, ex-sx, ey-sy);
		} else if(shape === "filledrect"){
			context.fillRect(sx, sy, ex-sx, ey-sy);
		} else if(shape === "ellipse" || shape === "filledellipse"){
			var ecx = (sx+ex)/2, ecy = (sy+ey)/2;
			var rx = Math.abs(ex-sx)/2, ry = Math.abs(ey-sy)/2;
			if(rx > 0 && ry > 0){
				context.beginPath();
				context.ellipse(ecx, ecy, rx, ry, 0, 0, 2*Math.PI);
				if(shape === "filledellipse") context.fill();
				else context.stroke();
			}
		}
	},

	effectCallback: function(context, brush, adjustx, adjusty, adjustzoom) {
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if(angle){
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W/2 - adjustx;
			var _cy = _H/2 - adjusty;
			context.save();
			context.translate(_cx, _cy); context.rotate(-angle); context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = _W/2, halfH = _H/2;
			var sRelX = brush.startPosition.x   - this.width/2,  sRelY = brush.startPosition.y   - this.height/2;
			var eRelX = brush.currentPosition.x - this.width/2,  eRelY = brush.currentPosition.y - this.height/2;
			sx = (cos*sRelX - sin*sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin*sRelX + cos*sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos*eRelX - sin*eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin*eRelX + cos*eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x   * adjustzoom - adjustx;
			sy = brush.startPosition.y   * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		context.globalAlpha = brush.currentAlpha;
		context.lineWidth   = brush.currentSize * adjustzoom;
		context.lineJoin    = 'miter';
		var rgb = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.strokeStyle = rgb;
		context.fillStyle   = rgb;
		brush._renderShape(context, sx, sy, ex, ey, brush.currentSize * adjustzoom, brush._shape);
		if(angle) context.restore();
	}
});

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
			var fontSizeForDisplay = parseInt(self.brushSize * self.zoomFactor);
			var boxStyle = [
				"z-index:6",
				"position:absolute",
				"font-family:sans-serif"
			].join(";");
			var toolbarStyle = [
				"position:absolute",
				"bottom:100%",
				"left:0",
				"margin-bottom:2px",
				"display:flex",
				"gap:2px",
				"padding:2px",
				"background:#f5f5f5",
				"border:1px solid #bbb",
				"border-radius:3px",
				"box-shadow:0 1px 4px rgba(0,0,0,0.15)"
			].join(";");
			var btnStyle = [
				"border:1px solid #bbb",
				"background:#fff",
				"border-radius:2px",
				"padding:1px 5px",
				"cursor:pointer",
				"line-height:1",
				"font-size:14px"
			].join(";");
			var inputStyle = [
				"background:transparent",
				"border:1px dashed #4a90d9",
				"outline:none",
				"padding:0",
				"margin:0",
				"font-size:" + fontSizeForDisplay + "px",
				"line-height:1",
				"font-family:sans-serif",
				"min-width:80px",
				"box-sizing:content-box"
			].join(";");
			self.$textFloatyBox = $(
				'<div style="' + boxStyle + '">' +
					'<div class="drawr-text-toolbar" style="' + toolbarStyle + '">' +
						'<button class="ok" style="' + btnStyle + '" title="Apply"><i class="mdi mdi-check"></i></button>' +
						'<button class="cancel" style="' + btnStyle + '" title="Cancel"><i class="mdi mdi-close"></i></button>' +
					'</div>' +
					'<input style="' + inputStyle + '" type="text" value="">' +
				'</div>'
			);
			$(self.$textFloatyBox).insertAfter(self.$container);
			var vp = brush.canvasToViewport.call(self, x, y);
			self.$textFloatyBox.css({
				left: self.$container.offset().left + vp.x,
				top: self.$container.offset().top + vp.y,
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
				left: self.$container.offset().left + vp.x,
				top: self.$container.offset().top + vp.y,
			});
		}
	},
	measureInputBaselineOffset: function(fontSize){
		//Probe where an <input>'s alphabetic baseline sits relative to its border-box top,
		//for the same font/border/padding/line-height used by the floaty input. Returns pixels
		//in canvas-font units (we build the probe with the canvas font-size directly).
		var probe = document.createElement('div');
		probe.style.cssText = 'position:absolute;visibility:hidden;top:-10000px;left:-10000px;' +
			'font-family:sans-serif;font-size:' + fontSize + 'px;line-height:1;' +
			'border:1px dashed;padding:0;margin:0;box-sizing:content-box;white-space:pre;';
		probe.innerHTML = 'x<span style="display:inline-block;width:0;height:0;vertical-align:baseline;"></span>';
		document.body.appendChild(probe);
		var probeRect = probe.getBoundingClientRect();
		var marker = probe.querySelector('span').getBoundingClientRect();
		var offset = marker.top - probeRect.top;
		document.body.removeChild(probe);
		return offset;
	},
	applyText: function(context,brush,x,y,text){
		var fontSize = this.brushSize;
		context.font = fontSize + "px sans-serif";
		context.textAlign = "left";
		context.textBaseline = "alphabetic";
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		var angle = this.rotationAngle || 0;
		//Align canvas baseline with input's measured baseline so preview and commit match at any size.
		var baselineOffset = Math.round(brush.measureInputBaselineOffset(fontSize));
		var drawX = x + 1, drawY = y + baselineOffset + 2;
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
				left: this.$container.offset().left + vp.x,
				top: this.$container.offset().top + vp.y,
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
	//Each undo reverses the most recent stroke in the linear action history. The top-of-stack
	//entry is the after-state of the last action; its layerId identifies which layer to undo
	//on. We walk down the stack for the previous entry for the same layer — that's the state
	//to restore to. If there's no such entry (the very first stroke on a fresh layer), we
	//fallback-clear the layer. The popped entry goes to redoStack.
	action: function(brush,context){
		var self = this;
		var plugin = self.plugin;

		function setUndoButton(bright){
			if(typeof self.$undoButton !== "undefined") self.$undoButton.css("opacity", bright ? 1 : 0.5);
		}
		function setRedoButton(bright){
			if(typeof self.$redoButton !== "undefined") self.$redoButton.css("opacity", bright ? 1 : 0.5);
		}
		//can the user undo right now? the top must be non-sticky and non-orphaned, AND the
		//action must be able to actually complete — a top-only entry on a trimmed layer has
		//no prior state to restore to and fallback-clear is forbidden, so that too counts as
		//"can't undo" and should leave the button dimmed.
		function canUndo(){
			if(self.undoStack.length === 0) return false;
			var t = self.undoStack[self.undoStack.length - 1];
			if(t.sticky) return false;
			var lidx = plugin.resolve_layer_by_id.call(self, t.layerId);
			if(lidx < 0) return false;
			if(self.layers[lidx].history_trimmed){
				//need a prior same-layer entry to restore to.
				for(var j = self.undoStack.length - 2; j >= 0; j--){
					var e = self.undoStack[j];
					if(plugin.resolve_layer_by_id.call(self, e.layerId) < 0) continue;
					if(e.layerId === t.layerId) return true;
				}
				return false;
			}
			return true;
		}

		//discard any orphaned entries at the top (layer was deleted). they have no current
		//state to reverse and shouldn't consume an undo click.
		while(self.undoStack.length > 0 && plugin.resolve_layer_by_id.call(self, self.undoStack[self.undoStack.length-1].layerId) < 0){
			self.undoStack.pop();
		}
		if(self.undoStack.length === 0){
			setUndoButton(false);
			return;
		}

		var top = self.undoStack[self.undoStack.length - 1];
		//sticky baseline (e.g. image-load state): refuse to pop it, just dim and bail.
		if(top.sticky){
			setUndoButton(false);
			return;
		}
		var L = top.layerId;
		var targetIdx = plugin.resolve_layer_by_id.call(self, L);
		var targetLayer = self.layers[targetIdx];
		var targetCanvas = targetLayer.canvas;
		var targetCtx = targetCanvas.getContext("2d", { alpha: true });

		//find the previous same-layer entry (skipping orphans).
		var prev = null;
		for(var i = self.undoStack.length - 2; i >= 0; i--){
			var e = self.undoStack[i];
			if(plugin.resolve_layer_by_id.call(self, e.layerId) < 0) continue;
			if(e.layerId === L){ prev = e; break; }
		}

		//if there's no prior state AND we've trimmed history for this layer (cap hit), refuse
		//to undo — fallback-clear would wipe real content the user doesn't remember is there.
		if(!prev && targetLayer.history_trimmed){
			setUndoButton(false);
			return;
		}

		//pop the top entry and route it to redo.
		var reversed = self.undoStack.pop();
		self.redoStack.push(reversed);
		setRedoButton(true);

		//clear the target layer, then (if a prior state exists) draw it back in.
		var clearTarget = function(){
			targetCtx.globalCompositeOperation = "source-over";
			targetCtx.globalAlpha = 1;
			if(targetIdx === 0 && self.settings.enable_transparency == false){
				targetCtx.fillStyle = "white";
				targetCtx.fillRect(0, 0, self.width, self.height);
			} else {
				targetCtx.clearRect(0, 0, self.width, self.height);
			}
		};
		if(prev){
			var img = document.createElement("img");
			img.crossOrigin = "Anonymous";
			img.onload = function(){
				clearTarget();
				targetCtx.drawImage(img, 0, 0);
			};
			img.src = prev.data;
		} else {
			clearTarget();
		}

		setUndoButton(canUndo());
	},
	cleanup: function(){
		var self = this;
		delete self.$undoButton;
	}

});

  return $;
}));