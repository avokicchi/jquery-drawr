jQuery.fn.drawr.register({
	icon: "mdi mdi-brush mdi-24px",
	name: "pen",
	size: 6,
	alpha: 0.5,
	order: 4,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self=  this;
		context.globalAlpha = alpha;
		var radgrad = context.createRadialGradient(x,y,0,x,y,size/2);//non zero values for the gradient break globalAlpha unfortunately.
		radgrad.addColorStop(0, 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')');
		radgrad.addColorStop(0.5, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0.5)');
		radgrad.addColorStop(1, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0)');
		context.fillStyle = radgrad;
		context.fillRect(x-(size/2), y-(size/2), size, size);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});