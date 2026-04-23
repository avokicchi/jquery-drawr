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
