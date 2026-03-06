jQuery.fn.drawr.register({
	icon: "mdi mdi-spray mdi-24px",
	name: "airbrush",
	size: 40,
	alpha: 0.2,
	order: 3,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	activate: function(brush,context){
		brush._stampCache = null;
		brush._stampCacheKey = null;
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;
		var brushSize = self.brushSize;
		var cacheKey = brushSize + '|' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b;
		if(brush._stampCacheKey !== cacheKey){
			var buffer = document.createElement('canvas');
			buffer.width = brushSize;
			buffer.height = brushSize;
			var bctx = buffer.getContext('2d');
			var half = brushSize / 2;
			var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
			radgrad.addColorStop(0, 'rgb(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ')');
			radgrad.addColorStop(0.5, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0.5)');
			radgrad.addColorStop(1, 'rgba(' + self.brushColor.r + ',' + self.brushColor.g + ',' + self.brushColor.b + ',0)');
			bctx.fillStyle = radgrad;
			bctx.fillRect(0, 0, brushSize, brushSize);
			brush._stampCache = buffer;
			brush._stampCacheKey = cacheKey;
		}
		context.globalAlpha = alpha;
		context.drawImage(brush._stampCache, x - brushSize / 2, y - brushSize / 2);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});