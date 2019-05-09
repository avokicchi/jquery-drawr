jQuery.fn.drawr.register({
	icon: "mdi mdi-square mdi-24px",
	name: "filledsquare",
	size: 3,
	alpha: 1,
	order: 8,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		brush.currentAlpha = alpha;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		this.effectCallback = brush.effectCallback;
		context.globalAlpha=alpha;
		context.lineWidth = size;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		context.lineJoin = 'miter';
		context.lineWidth = size;
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.fillRect(brush.startPosition.x,brush.startPosition.y,brush.currentPosition.x-brush.startPosition.x,brush.currentPosition.y-brush.startPosition.y);

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
		//context.lineWidth = this.brushSize;
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		context.fillRect((brush.startPosition.x*adjustzoom)-adjustx,(brush.startPosition.y*adjustzoom)-adjusty,(brush.currentPosition.x-brush.startPosition.x)*adjustzoom,(brush.currentPosition.y-brush.startPosition.y)*adjustzoom);
	}
});

//effectCallback