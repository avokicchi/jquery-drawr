jQuery.fn.drawr.register({
	icon: "mdi mdi-marker mdi-24px",
	name: "marker",
	size: 15,
	alpha: 0.3,
	order: 10,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	activate: function(brush,context){

	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		brush.currentAlpha = alpha;
		brush.startPosition = {
			"x" : x,
			"y" : y
		};
		this.effectCallback = brush.effectCallback;
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		context.globalAlpha=alpha;
		
		brush.currentSize = size;
		brush.currentAlpha = alpha;

		this.effectCallback = null;
		context.lineWidth = size;
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
		return true;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		brush.currentSize = size;
		brush.currentAlpha = alpha;
		brush.currentPosition = {
			"x" : x,
			"y" : y
		};
	},
	effectCallback: function(context,brush,adjustx,adjusty,adjustzoom){

		context.globalAlpha = brush.currentAlpha;//brush.currentAlpha;
		context.lineWidth = brush.currentSize*adjustzoom;
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