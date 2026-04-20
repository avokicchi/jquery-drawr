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
		delete self.$pressureCurveSlider;
		delete self.$pressureCurvePreview;
	}

});
