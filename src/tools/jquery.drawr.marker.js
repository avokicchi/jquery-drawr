jQuery.fn.drawr.register({
	icon: "mdi mdi-marker mdi-24px",
	name: "marker",
	size: 15,
	alpha: 0.3,
	order: 10,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,event){
		brush.currentAlpha = context.globalAlpha;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		this.effectCallback = brush.effectCallback;
	},
	drawStop: function(brush,context,x,y,event){
		context.globalAlpha=this.brushAlpha;
		this.effectCallback = null;
		context.lineWidth = this.brushSize;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";

		context.beginPath(); 
		var positions = $(this).data("positions");
		$.each(positions,function(i,position){
			if(i>0){
				context.moveTo(positions[i-1].x,positions[i-1].y);
				context.lineTo(position.x,position.y);
			}
		});
		context.stroke();

	},
	drawSpot: function(brush,context,x,y,pressure,event) {
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){

		context.globalAlpha = this.brushAlpha;//brush.currentAlpha;
		context.lineWidth = this.brushSize*adjustzoom;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";

		context.beginPath(); 
		var positions = $(this).data("positions");
		$.each(positions,function(i,position){
			if(i>0){
				context.moveTo((positions[i-1].x*adjustzoom)-adjustx,(positions[i-1].y*adjustzoom)-adjusty);
				context.lineTo((position.x*adjustzoom)-adjustx,(position.y*adjustzoom)-adjusty);
			}
		});
		context.stroke();

	}
});

//effectCallback