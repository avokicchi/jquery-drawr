jQuery.fn.drawr.register({
	icon: "mdi mdi-eraser mdi-24px",
	name: "eraser",
	size: 10,
	alpha: 0.8,
	order: 5,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		if(this.settings.enable_tranparency==true){
			context.globalCompositeOperation="destination-out";
		} else {
			context.globalCompositeOperation="source-over";
		}
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;
		context.globalAlpha = alpha;
		if(self.settings.enable_tranparency==true){
			var radgrad = context.createRadialGradient(x,y,0,x,y,size/2);//non zero values for the gradient break globalAlpha unfortunately.
			radgrad.addColorStop(0, '#000');
			radgrad.addColorStop(0.5, 'rgba(0,0,0,0.5)');
			radgrad.addColorStop(1, 'rgba(0,0,0,0)');
			context.fillStyle = radgrad;
			context.fillRect(x-(size/2), y-(size/2), size, size);
		} else {
	    	context.fillStyle = 'white';
			context.beginPath();
			context.arc(x,y, size/2, 0, 2 * Math.PI);
			context.fill();
		}
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});