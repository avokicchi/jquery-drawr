jQuery.fn.drawr.register({
	icon: "mdi mdi-spray mdi-24px",
	name: "airbrush",
	size: 40,
	alpha: 0.2,
	order: 3,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;
		context.globalAlpha = alpha;
		var radgrad = context.createRadialGradient(x,y,0,x,y,this.brushSize/2);//non zero values for the gradient break globalAlpha unfortunately.
		radgrad.addColorStop(0, 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')');
		radgrad.addColorStop(0.5, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0.5)');
		radgrad.addColorStop(1, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0)');
		context.fillStyle = radgrad;
		context.fillRect(x-(self.brushSize/2), y-(self.brushSize/2), self.brushSize, self.brushSize);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});