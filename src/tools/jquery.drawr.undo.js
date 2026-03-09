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
	action: function(brush,context){
		var self = this;

		if(self.undoStack.length>0){
			//the current property is because of the way some tools work it is needed to always keep a copy of the canvas' latest state (AFTER last draw action was done) in the undo buffer.
			//obviously you want to go back to the previous version, not the current one, so that one is ignored.
			var currentData = null;
			if(self.undoStack[self.undoStack.length-1].current==true){
				currentData = self.undoStack.pop().data;//save current canvas state for redo
			}
			$.each(self.undoStack,function(i,stackitem){
				stackitem.current=false;
			});
			if(self.undoStack.length>0) {//is there anything noncurrent
				var undo = self.undoStack.pop().data;
				//push current state onto redo stack before restoring
				if(currentData!==null){
					self.redoStack.push(currentData);
					if(typeof self.$redoButton!=="undefined"){
						self.$redoButton.css("opacity",1);
					}
				}
				var img = document.createElement("img");
				img.crossOrigin = "Anonymous";

				img.onload = function(){
					self.plugin.clear_canvas.call(self,false);
					context.globalCompositeOperation="source-over";
					context.globalAlpha = 1;
					context.drawImage(img,0,0);
				};
				img.src=undo;
			}
			if(self.undoStack.length==0) {//re-add current version of the canvas.
				self.$undoButton.css("opacity",0.5);
			}
			self.undoStack.push({data:undo,current:true});
		}

	},
	cleanup: function(){
		var self = this;
		delete self.$undoButton;
	}

});
