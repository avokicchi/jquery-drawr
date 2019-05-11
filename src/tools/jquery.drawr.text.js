jQuery.fn.drawr.register({
	icon: "mdi mdi-format-text mdi-24px",
	name: "text",
	size: 22,
	alpha: 1,
	order: 22,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	activate: function(brush,context){
		
	},
	deactivate: function(brush,context){
		if(typeof brush.$floatyBox!=="undefined"){
			brush.$floatyBox.remove();
			delete brush.$floatyBox;
		}
	},
	drawStart: function(brush,context,x,y,size,alpha,event){
		var self=this;
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
		context.globalAlpha=alpha
		if(typeof brush.$floatyBox=="undefined"){
			var fontSizeForDisplay= parseInt(20 * self.zoomFactor);
			brush.$floatyBox = $('<div style="z-index:6;position:absolute;width:100px;height:20px;"><input style="background:transparent;border:0px;padding:0px;font-size:' + fontSizeForDisplay + 'px;font-family:sans-serif;" type="text" value=""><button class="ok"><i class="mdi mdi-check"></i></button><button class="cancel"><i class="mdi mdi-close"></i></button></div>');
			$(brush.$floatyBox).insertAfter($(this).parent());
			brush.$floatyBox.css({
				left: $(this).parent().offset().left + (x*self.zoomFactor) - this.scrollX,
				top: $(this).parent().offset().top + (y*self.zoomFactor) - this.scrollY,
			});
			brush.$floatyBox.find("input").on("mousedown touchstart",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.$floatyBox.find("input").focus();
			});
			brush.$floatyBox.find("input").focus();
			event.preventDefault();
			event.stopPropagation();
			brush.$floatyBox.find(".ok").on("mousedown touchstart",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.applyText.call(self,context,brush,brush.currentPosition.x,brush.currentPosition.y,brush.$floatyBox.find("input").val());
				brush.$floatyBox.remove();
				delete brush.$floatyBox;
			});
			brush.$floatyBox.find(".cancel").on("mousedown touchstart",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.$floatyBox.remove();
				delete brush.$floatyBox;
			});
		} else {
			brush.$floatyBox.css({
				left: $(this).parent().offset().left + (x*self.zoomFactor) - this.scrollX,
				top: $(this).parent().offset().top + (y*self.zoomFactor) - this.scrollY,
			});
		}
	},
	applyText: function(context,brush,x,y,text){
		context.font = "20px sans-serif";
		context.textAlign = "left"; 
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.fillText(text, x-2, y+19);
		this.plugin.record_undo_entry.call(this);
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
		if(typeof brush.$floatyBox=="undefined"){

		} else {
			brush.$floatyBox.css({
				left: $(this).parent().offset().left + (x*this.zoomFactor) - this.scrollX,
				top: $(this).parent().offset().top + (y*this.zoomFactor) - this.scrollY,
			});
		}
	}
});

//effectCallback