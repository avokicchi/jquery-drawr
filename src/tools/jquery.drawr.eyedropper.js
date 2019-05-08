jQuery.fn.drawr.register({
	icon: "mdi mdi-eyedropper mdi-24px",
	name: "pen",
	order: 6,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,event){},
	drawSpot: function(brush,context,x,y,pressure,event) {
		var self = this;
		var raw = context.getImageData(x, y, 1, 1).data; 
		self.brushColor={ r: raw[0], g: raw[1], b: raw[2]};
	}
});