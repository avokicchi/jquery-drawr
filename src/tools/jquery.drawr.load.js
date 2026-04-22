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
