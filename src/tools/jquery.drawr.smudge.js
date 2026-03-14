jQuery.fn.drawr.register({
	icon: "mdi mdi-cursor-pointer mdi-24px",
	name: "smudge",
	size: 20,
	alpha: 1,
	order: 13,
	pressure_affects_alpha: true,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {
		brush._smudge = null;
	},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;
		var imageData = context.getImageData(
			Math.round(x) - radius,
			Math.round(y) - radius,
			diameter, diameter
		);
		brush._smudge = {
			buf:      new Float32Array(imageData.data),
			radius:   radius,
			diameter: diameter,
			strength: alpha
		};
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var s = brush._smudge;
		if (!s) return;

		var radius   = s.radius;
		var diameter = s.diameter;
		var buf      = s.buf;
		var strength = s.strength;

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

				//full strength at centre, zero at edge
				var t     = 1 - dist / radius;
				var blend = strength * t * t;

				var i = (row * diameter + col) * 4;

				//save original canvas pixel before we overwrite it
				var origR = data[i];
				var origG = data[i + 1];
				var origB = data[i + 2];
				var origA = data[i + 3];

				//push smudge pixel (including alpha) onto canvas
				data[i]     = origR + (buf[i]     - origR) * blend;
				data[i + 1] = origG + (buf[i + 1] - origG) * blend;
				data[i + 2] = origB + (buf[i + 2] - origB) * blend;
				data[i + 3] = origA + (buf[i + 3] - origA) * blend;

				//gradually pick up the original canvas pixel into the buffer so the smear trail slowly transitions to the underlying colour
				var pickup  = 0.18 * t;
				buf[i]     += (origR - buf[i])     * pickup;
				buf[i + 1] += (origG - buf[i + 1]) * pickup;
				buf[i + 2] += (origB - buf[i + 2]) * pickup;
				buf[i + 3] += (origA - buf[i + 3]) * pickup;
			}
		}

		context.putImageData(imageData, ox, oy);
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		brush._smudge = null;
		return true;
	}
});
