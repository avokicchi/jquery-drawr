jQuery.fn.drawr.register({
	icon: "mdi mdi-vector-square mdi-24px",
	name: "square",
	size: 3,
	alpha: 1,
	order: 7,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.currentSize = size;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		this.effectCallback = brush.effectCallback;
		context.globalAlpha=alpha;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.lineWidth = size;
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.strokeRect(brush.startPosition.x,brush.startPosition.y,brush.currentPosition.x-brush.startPosition.x,brush.currentPosition.y-brush.startPosition.y);

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
		context.globalAlpha = brush.currentAlpha;//brush.currentAlpha;
		context.lineWidth = brush.currentSize*adjustzoom;
		context.lineJoin = 'miter';
		context.strokeStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.strokeRect((brush.startPosition.x*adjustzoom)-adjustx,(brush.startPosition.y*adjustzoom)-adjusty,(brush.currentPosition.x-brush.startPosition.x)*adjustzoom,(brush.currentPosition.y-brush.startPosition.y)*adjustzoom);
	}
});

//effectCallback