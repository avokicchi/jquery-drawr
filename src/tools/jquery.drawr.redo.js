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
	action: function(brush,context){
		var self = this;

		if(self.redoStack.length>0){
			var redo = self.redoStack.pop();

			//mark the current undoStack entry as a regular history entry
			//so undo can step back through it after this redo
			if(self.undoStack.length>0 && self.undoStack[self.undoStack.length-1].current==true){
				self.undoStack[self.undoStack.length-1].current = false;
			}

			var img = document.createElement("img");
			img.crossOrigin = "Anonymous";

			img.onload = function(){
				self.plugin.clear_canvas.call(self,false);
				context.globalCompositeOperation="source-over";
				context.globalAlpha = 1;
				context.drawImage(img,0,0);

				//we push the restored state as the new current so undo knows where we are
				self.undoStack.push({data:redo,current:true});
				if(self.undoStack.length>(self.settings.undo_max_levels+1)) self.undoStack.shift();

				if(typeof self.$undoButton!=="undefined"){
					self.$undoButton.css("opacity",1);
				}
				if(self.redoStack.length==0){
					self.$redoButton.css("opacity",0.5);
				}
			};
			img.src=redo;
		}

	},
	cleanup: function(){
		var self = this;
		delete self.$redoButton;
	}

});
