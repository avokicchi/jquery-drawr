jQuery.fn.drawr.register({
	icon: "mdi mdi-brush mdi-24px",
	name: "brush",
	size: 3,
	alpha: 0.5,
	order: 4,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	brush_fade_in: 20,
	smoothing: true,
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
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var cacheKey = size + '|' + color.r + ',' + color.g + ',' + color.b;
		if(brush._stampCacheKey !== cacheKey){
			var sz = Math.max(1, size);
			var buffer = document.createElement('canvas');
			buffer.width = sz;
			buffer.height = sz;
			var bctx = buffer.getContext('2d');
			var half = sz / 2;
			var radgrad = bctx.createRadialGradient(half, half, 0, half, half, half);
			radgrad.addColorStop(0, 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')');
			radgrad.addColorStop(0.5, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0.5)');
			radgrad.addColorStop(1, 'rgba(' + color.r + ',' + color.g + ',' + color.b + ',0)');
			bctx.fillStyle = radgrad;
			bctx.fillRect(0, 0, sz, sz);
			brush._stampCache = buffer;
			brush._stampCacheKey = cacheKey;
		}
		context.globalAlpha = alpha;
		context.drawImage(brush._stampCache, x - size / 2, y - size / 2);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});