jQuery.fn.drawr.register({
	icon: "mdi mdi-lightbulb-on mdi-24px",
	name: "dodge",
	size: 20,
	alpha: 0.5,
	order: 16,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;

		var ox = Math.round(x) - radius;
		var oy = Math.round(y) - radius;

		var imageData = context.getImageData(ox, oy, diameter, diameter);
		var data      = imageData.data;

		for (var row = 0; row < diameter; row++) {
			for (var col = 0; col < diameter; col++) {
				var dx   = col - radius + 0.5;
				var dy   = row - radius + 0.5;
				var dist = Math.sqrt(dx * dx + dy * dy);
				if (dist >= radius) continue;

				//taper off strength from centre
				var t     = 1 - dist / radius;
				var blend = alpha * t * t;

				var i = (row * diameter + col) * 4;
				//dodge: push each channel toward 255
				data[i]     = data[i]     + (255 - data[i])     * blend;
				data[i + 1] = data[i + 1] + (255 - data[i + 1]) * blend;
				data[i + 2] = data[i + 2] + (255 - data[i + 2]) * blend;
				//alpha channel unchanged
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		return true;
	}
});
