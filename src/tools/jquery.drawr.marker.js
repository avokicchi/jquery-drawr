jQuery.fn.drawr.register({
	icon: "mdi mdi-marker mdi-24px",
	name: "marker",
	size: 15,
	alpha: 0.3,
	order: 9,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	flow: 1,
	spacing: 0.25,
	rotation_mode: "none",
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
		brush._positions = [{x: x, y: y}];
		this.effectCallback = brush.effectCallback;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;

		context.globalAlpha=alpha;

		brush.currentSize = size;
		brush.currentAlpha = alpha;

		this.effectCallback = null;
		brush._positions = null;
		context.lineWidth = size;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";

		context.beginPath(); 
		var positions = $(this).data("positions");
		$.each(positions,function(i,position){
			if(i>0){
				context.moveTo(positions[i-1].x,positions[i-1].y);
				context.lineTo(position.x,position.y);
			}
		});
		context.stroke();
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentSize = size;
		brush.currentAlpha = alpha;
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
		if(brush._positions) brush._positions.push({x: x, y: y});
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){
		var positions = brush._positions;
		if(!positions || positions.length < 2) return;
		context.globalAlpha = brush.currentAlpha;
		context.lineWidth = brush.currentSize * adjustzoom;
		context.lineJoin = context.lineCap = "round";
		context.strokeStyle = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.beginPath();
		for(var i = 1; i < positions.length; i++){
			context.moveTo((positions[i-1].x * adjustzoom) - adjustx, (positions[i-1].y * adjustzoom) - adjusty);
			context.lineTo((positions[i].x * adjustzoom) - adjustx, (positions[i].y * adjustzoom) - adjusty);
		}
		context.stroke();
	}
});

//effectCallback