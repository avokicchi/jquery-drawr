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
	//on. We walk down the stack for the previous entry for the same layer. that's the state
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
		//action must be able to actually complete. a top-only entry on a trimmed layer has
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
		//to undo. fallback-clear would wipe real content the user doesn't remember is there.
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
