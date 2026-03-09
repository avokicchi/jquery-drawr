jQuery.fn.drawr.register({
	icon: "mdi mdi-blur mdi-24px",
	name: "blur",
	size: 20,
	alpha: 0.8,
	order: 16,
	pressure_affects_alpha: true,
	pressure_affects_size: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var radius      = Math.max(2, Math.round(size / 2));
		var diameter    = radius * 2;
		var kernelRadius = Math.max(2, Math.round(radius / 4));

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		//work from a snapshot so we never blur already-blurred pixels in this pass
		var src = new Uint8ClampedArray(data);

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//taper off strength from centre
				var t     = 1 - dist / radius;
				var blend = alpha * t * t;

				//box blur: average kernel-sized neighbourhood from the snapshot
				var sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
				for (var ky = -kernelRadius; ky <= kernelRadius; ky++) {
					for (var kx = -kernelRadius; kx <= kernelRadius; kx++) {
						var nr = row + ky;
						var nc = col + kx;
						if (nr < 0 || nr >= diameter || nc < 0 || nc >= diameter) continue;
						var ki = (nr * diameter + nc) * 4;
						sumR += src[ki];
						sumG += src[ki + 1];
						sumB += src[ki + 2];
						sumA += src[ki + 3];
						count++;
					}
				}

				var i = (row * diameter + col) * 4;
				data[i]     = src[i]     + (sumR / count - src[i])     * blend;
				data[i + 1] = src[i + 1] + (sumG / count - src[i + 1]) * blend;
				data[i + 2] = src[i + 2] + (sumB / count - src[i + 2]) * blend;
				data[i + 3] = src[i + 3] + (sumA / count - src[i + 3]) * blend;
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});
