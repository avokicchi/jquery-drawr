jQuery.fn.drawr.register({
	icon: "mdi mdi-eraser mdi-24px",
	name: "eraser",
	size: 10,
	alpha: 0.8,
	order: 5,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	smoothing: true,
	activate: function(brush,context){
		brush._stampCache = null;
		brush._stampCacheKey = null;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		if(this.settings.enable_transparency==true){
			context.globalCompositeOperation="destination-out";
		} else {
			context.globalCompositeOperation="source-over";
		}
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		console.warn("drawing eraser with size " + size,event);
		var self = this;
		context.globalAlpha = alpha;
		if(self.settings.enable_transparency==true){
			if(brush._stampCacheKey !== size){
				var sz = Math.max(1, size);
				var buffer = document.createElement('canvas');
				buffer.width = sz;
				buffer.height = sz;
				var bctx = buffer.getContext('2d');
				var half = sz / 2;
				var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
				radgrad.addColorStop(0, '#000');
				radgrad.addColorStop(0.5, 'rgba(0,0,0,0.5)');
				radgrad.addColorStop(1, 'rgba(0,0,0,0)');
				bctx.fillStyle = radgrad;
				bctx.fillRect(0, 0, sz, sz);
				brush._stampCache = buffer;
				brush._stampCacheKey = size;
			}
			context.drawImage(brush._stampCache, x - size / 2, y - size / 2);
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