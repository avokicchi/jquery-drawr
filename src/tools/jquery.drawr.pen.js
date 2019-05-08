jQuery.fn.drawr.register({
	icon: "mdi mdi-fountain-pen-tip mdi-24px",
	name: "pen",
	size: 3,
	alpha: 1,
	order: 2,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,event){
		context.globalCompositeOperation="source-over";
	},
	drawSpot: function(brush,context,x,y,pressure,event) {
		var self = this;
		var size = parseInt(self.brushSize);
		if(self.pen_pressure){
			size=size + parseFloat(10*pressure);
		}
		if(size<self.brushSize) size=self.brushSize;
    	context.fillStyle = 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')';
		context.beginPath();
		context.arc(x,y, size/2, 0, 2 * Math.PI);
		context.fill();
	}
});