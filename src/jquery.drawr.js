/*!
 * jquery-drawr
 * Copyright (c) 2019–present Avokicchi
 * Released under the MIT License
 */

(function( $ ) {

	var DRAWR_VERSION = "@@VERSION@@";

	//inject global stylesheet once per page load. provides :active press-feedback for
	//toolbox buttons and tool buttons (tactile feedback on both desktop and touch).
	function _drawrInjectStyle(){
		if(document.getElementById("drawr-global-style")) return;
		var css = [
			".drawr-toolwindow-btn{transition:transform 60ms ease-out,box-shadow 80ms ease-out,background 80ms ease-out;}",
			".drawr-toolwindow-btn:active{transform:translateY(1px);background:linear-gradient(to bottom,rgba(0,0,0,0.25) 0%,rgba(255,255,255,0.05) 100%) !important;box-shadow:inset 0 1px 3px rgba(0,0,0,0.35) !important;}",
			".drawr-tool-btn{transition:filter 80ms ease-out,box-shadow 80ms ease-out;}",
			".drawr-tool-btn:active{filter:brightness(0.82);box-shadow:inset 0 1px 4px rgba(0,0,0,0.35);}",
			".drawr-layer-row .layer-vis:active,.drawr-layer-row .layer-movedown:active,.drawr-layer-row .layer-delete:active{filter:brightness(1.4);}"
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
		plugin.calc_brush_params = function(brush, brushSize, brushAlpha, pressure, pen_pressure){
			var shaped = Math.pow(pressure, plugin.read_pressure_curve());
			return {
				alpha: (brush.pressure_affects_alpha && pen_pressure) ? Math.min(1, brushAlpha * shaped) : brushAlpha,
				size:  parseFloat((brush.pressure_affects_size && pen_pressure) ? Math.max(1, brushSize * shaped) : brushSize)
			};
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
				for(var i = 1; i < self.layers.length; i++){
					self.layers[i].$el.css("transform", transform);
				}
			}
			if(self.$bgCanvas) self.$bgCanvas.css("transform", transform);
		};

		//mirror the main canvas's zoomed CSS display size onto every extra layer canvas.
		plugin.broadcast_zoom_css = function(){
			var self = this;
			if(!self.layers) return;
			var zoom = self.zoomFactor || 1;
			for(var i = 1; i < self.layers.length; i++){
				self.layers[i].$el.width(self.width * zoom);
				self.layers[i].$el.height(self.height * zoom);
			}
		};

		//Create a new layer canvas as a sibling of the main canvas inside the drawr-container.
		//pixel dimensions match self.width x self.height; CSS display size tracks zoom.
		//z-index is indexForInsert+2 (layer 0 is z=1, extras start at z=2). opacity/visibility/
		//mix-blend-mode applied per mode.
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
			//insert above the last existing layer canvas (main or extra). z-index rises with index.
			$c.insertAfter(self.layers[self.layers.length - 1].$el);
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
			self.layers.push(layer);
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
						mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);
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
						if(typeof self.active_brush.drawStart!=="undefined") self.active_brush.drawStart.call(self,self.active_brush,_startCtx,mouse_data.x,mouse_data.y,calculatedSize,startAlpha,e,_startAngle);
						if(typeof self.active_brush.drawSpot!=="undefined") self.active_brush.drawSpot.call(self,self.active_brush,_startCtx,mouse_data.x,mouse_data.y,calculatedSize,startAlpha,e,_startAngle);
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
					$(self).parent().find(".sfx-canvas")[0].style.boxShadow="0px 0px 5px 1px skyblue inset";
				} else {
					$(self).parent().find(".sfx-canvas")[0].style.boxShadow="";
				}

				var mouse_data = plugin.get_mouse_data.call(self,e,$(self).parent()[0],self);

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
			this.origParentStyles = plugin.get_styles($(this).parent()[0]);
			$(this).css({ "display" : "block", "user-select": "none", "webkit-touch-callout": "none", "position": "relative", "z-index": 1 });
			//`isolation: isolate` confines mix-blend-mode (used by multiply layers) to the
			//drawr-container, so blending never reaches the surrounding page. $bgCanvas is
			//still inside the isolated context — by design; multiply reaches through
			//transparent regions of layer 0 to the paper background.
			$(this).parent().css({	"overflow": "hidden", "position": "relative", "user-select": "none", "webkit-touch-callout": "none", "isolation": "isolate" });

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

			//zoom percentage indicator — bottom-center of the viewport, fades like the scrollbars.
			if(this.zoomIndicatorTimer > 0){
				var _zAlpha = Math.min(0.85, (0.85/100)*this.zoomIndicatorTimer);
				this.zoomIndicatorTimer -= 5;
				var _zText = Math.round(this.zoomFactor * 100) + "%";
				context.save();
				context.globalAlpha = _zAlpha;
				context.font = "bold 13px sans-serif";
				context.textAlign = "center";
				context.textBaseline = "middle";
				var _zPadX = 10, _zPadY = 5;
				var _zTextW = context.measureText(_zText).width;
				var _zBoxW = _zTextW + _zPadX * 2;
				var _zBoxH = 13 + _zPadY * 2;
				var _zBoxX = container_width / 2 - _zBoxW / 2;
				var _zBoxY = container_height - _zBoxH - 16; //16px margin from bottom
				context.fillStyle = "rgba(0,0,0,0.6)";
				//rounded rect — fallback to plain rect if roundRect unsupported
				if(context.roundRect){
					context.beginPath();
					context.roundRect(_zBoxX, _zBoxY, _zBoxW, _zBoxH, 4);
					context.fill();
				} else {
					context.fillRect(_zBoxX, _zBoxY, _zBoxW, _zBoxH);
				}
				context.fillStyle = "#fff";
				context.fillText(_zText, container_width / 2, _zBoxY + _zBoxH / 2 + 1);
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
			$(toolbox).insertAfter($(this).parent());
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
				//remove extra layer canvases (layer 0 is the main canvas — left in place).
				if(currentCanvas.layers){
					for(var _li = 1; _li < currentCanvas.layers.length; _li++){
						currentCanvas.layers[_li].$el.remove();
					}
					delete currentCanvas.layers;
					delete currentCanvas.activeLayerIndex;
					delete currentCanvas._nextLayerId;
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
