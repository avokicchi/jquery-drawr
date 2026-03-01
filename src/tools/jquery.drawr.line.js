jQuery.fn.drawr.register({
	icon: "mdi mdi-vector-line mdi-24px",
	name: "line",
	size: 3,
	alpha: 1,
	order: 9,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.lineWidth = context.lineWidth = size;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		context.beginPath();
		context.moveTo(x, y);
		this.effectCallback = brush.effectCallback;
		context.globalAlpha=alpha;
		context.lineWidth = size;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.lineTo(brush.currentPosition.x, brush.currentPosition.y);
		context.stroke();

		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){
		context.globalAlpha=brush.currentAlpha;
		context.lineJoin = 'miter';
		context.lineWidth = brush.lineWidth*adjustzoom;
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.beginPath();
		context.moveTo((brush.startPosition.x*adjustzoom)-adjustx, (brush.startPosition.y*adjustzoom)-adjusty);
		context.lineTo((brush.currentPosition.x*adjustzoom)-adjustx, (brush.currentPosition.y*adjustzoom)-adjusty);
		context.stroke();
	}
});

//effectCallback