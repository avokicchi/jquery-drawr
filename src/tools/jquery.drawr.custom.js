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
