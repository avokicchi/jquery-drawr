jQuery.fn.drawr.register({
	icon: "mdi mdi-brush mdi-24px",
	name: "pen",
	size: 6,
	alpha: 0.5,
	order: 4,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,event){
		context.globalCompositeOperation="source-over";
	},
	drawSpot: function(brush,context,x,y,pressure,event) {
		var self=  this;
		var radgrad = context.createRadialGradient(x,y,0,x,y,self.brushSize/2);//non zero values for the gradient break globalAlpha unfortunately.
		radgrad.addColorStop(0, 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')');
		radgrad.addColorStop(0.5, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0.5)');
		radgrad.addColorStop(1, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0)');
		context.fillStyle = radgrad;
		context.fillRect(x-(self.brushSize/2), y-(self.brushSize/2), self.brushSize, self.brushSize);
	}
});