jQuery.fn.drawr.register({
	icon: "mdi mdi-format-color-fill mdi-24px",
	name: "fill",
	size: 1,
	alpha: 1,
	order: 9,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		var self = this;
		var canvas = context.canvas;
		var width = canvas.width;
		var height = canvas.height;

		x = Math.floor(x);
		y = Math.floor(y);

		if (x < 0 || x >= width || y < 0 || y >= height) return;

		var imageData = context.getImageData(0, 0, width, height);
		var data = imageData.data;

		var idx = (y * width + x) * 4;
		var targetR = data[idx];
		var targetG = data[idx + 1];
		var targetB = data[idx + 2];
		var targetA = data[idx + 3];

		var fillR = self.brushColor.r;
		var fillG = self.brushColor.g;
		var fillB = self.brushColor.b;
		var fillA = Math.round(alpha * 255);

		//nothing to do if the seed pixel is already the fill color
		if (targetR === fillR && targetG === fillG && targetB === fillB && targetA === fillA) return;

		var tolerance = 10;

		function colorMatch(i) {
			var dr = data[i]     - targetR;
			var dg = data[i + 1] - targetG;
			var db = data[i + 2] - targetB;
			var da = data[i + 3] - targetA;
			return (dr * dr + dg * dg + db * db + da * da) <= tolerance * tolerance;
		}

		var visited = new Uint8Array(width * height);
		//use a typed array as a stack for better performance on large canvases
		var stack = new Int32Array(width * height);
		var stackSize = 0;
		stack[stackSize++] = y * width + x;

		while (stackSize > 0) {
			var pos = stack[--stackSize];
			if (visited[pos]) continue;

			var i = pos * 4;
			if (!colorMatch(i)) continue;

			visited[pos] = 1;
			data[i]     = fillR;
			data[i + 1] = fillG;
			data[i + 2] = fillB;
			data[i + 3] = fillA;

			var px = pos % width;
			var py = (pos / width) | 0;

			if (px > 0)          stack[stackSize++] = pos - 1;
			if (px < width - 1)  stack[stackSize++] = pos + 1;
			if (py > 0)          stack[stackSize++] = pos - width;
			if (py < height - 1) stack[stackSize++] = pos + width;
		}

		context.putImageData(imageData, 0, 0);
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});
