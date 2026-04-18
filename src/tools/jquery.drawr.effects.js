//iterates every pixel inside a circular brush area, calling fn(data, src, i, blend, t, row, col, radius, diameter).
//handles getImageData / putImageData and the tapered blend weight from the center 
//pass needSrc=true to receive a frozen snapshot as the second argument to fn.
function _effectCircleEach(context, x, y, size, alpha, needSrc, fn) {
	var radius   = Math.max(2, Math.round(size / 2));
	var diameter = radius * 2;
	var ox       = Math.round(x) - radius;
	var oy       = Math.round(y) - radius;
	var imageData = context.getImageData(ox, oy, diameter, diameter);
	var data      = imageData.data;
	var src       = needSrc ? new Uint8ClampedArray(data) : null;
	for (var row = 0; row < diameter; row++) {
		for (var col = 0; col < diameter; col++) {
			var dx   = col - radius + 0.5;
			var dy   = row - radius + 0.5;
			var dist = Math.sqrt(dx * dx + dy * dy);
			if (dist >= radius) continue;
			var t     = 1 - dist / radius;
			var blend = alpha * t * t;
			fn(data, src, (row * diameter + col) * 4, blend, t, row, col, radius, diameter);
		}
	}
	context.putImageData(imageData, ox, oy);
}

//returns the average rgba of a box-blur neighbourhood from a snapshot buffer.
function _effectBoxBlur(src, row, col, diameter, kernelRadius) {
	var sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
	for (var ky = -kernelRadius; ky <= kernelRadius; ky++) {
		for (var kx = -kernelRadius; kx <= kernelRadius; kx++) {
			var nr = row + ky, nc = col + kx;
			if (nr < 0 || nr >= diameter || nc < 0 || nc >= diameter) continue;
			var ki = (nr * diameter + nc) * 4;
			sumR += src[ki]; sumG += src[ki + 1]; sumB += src[ki + 2]; sumA += src[ki + 3];
			count++;
		}
	}
	return { r: sumR / count, g: sumG / count, b: sumB / count, a: sumA / count };
}

jQuery.fn.drawr.register({
	icon: "mdi mdi-auto-fix mdi-24px",
	name: "effects",
	size: 20,
	alpha: 0.8,
	order: 13,
	pressure_affects_alpha: true,
	smoothing: false,
	flow: 1,
	spacing: 0.25,
	rotation_mode: "none",
	_effect: "blur",

	//Note: the tool object is shared across all drawr instances on a page, so DOM refs MUST live on
	//`self` (the canvas), not on `brush`. `brush._effect` itself is intentionally still global —
	//tool config (like pencil's spacing) is shared by design — but we keep a list of every per-canvas
	//dropdown on the tool so a change in one canvas syncs the others.
	buttonCreated: function(brush, button) {
		var self = this;

		self.$effectsToolbox = self.plugin.create_toolbox.call(self, "effects", {
			left: $(self).parent().offset().left,
			top:  $(self).parent().offset().top + $(self).parent().innerHeight() /2
		}, "Effect", 120);

		var $dd = self.plugin.create_dropdown.call(self, self.$effectsToolbox, "Type", [
			{ value: "blur",    label: "Blur"    },
			{ value: "sharpen", label: "Sharpen" },
			{ value: "burn",    label: "Burn"    },
			{ value: "dodge",   label: "Dodge"   },
			{ value: "smudge",  label: "Smudge"  },
			{ value: "noise",   label: "Noise"   }
		], brush._effect);

		if(!brush._effectDropdowns) brush._effectDropdowns = [];
		brush._effectDropdowns.push($dd);

		$dd.on("change.drawr", function() {
			var val = $(this).val();
			brush._effect = val;
			brush.smoothing = (val === "smudge");
			//mirror the change onto sibling dropdowns in other instances, without re-firing change.
			var siblings = brush._effectDropdowns;
			for(var i = 0; i < siblings.length; i++){
				if(siblings[i][0] !== this) siblings[i].val(val);
			}
			self.plugin.is_dragging = false;
		});
	},

	activate: function(brush, context) {
		if(this.$effectsToolbox) this.$effectsToolbox.show();
	},

	deactivate: function(brush, context) {
		brush._smudge = null;
		if(this.$effectsToolbox) this.$effectsToolbox.hide();
	},

	drawStart: function(brush, context, x, y, size, alpha, event) {
		if (brush._effect !== "smudge") return;
		var radius   = Math.max(2, Math.round(size / 2));
		var diameter = radius * 2;
		var imageData = context.getImageData(Math.round(x) - radius, Math.round(y) - radius, diameter, diameter);
		brush._smudge = {
			buf:      new Float32Array(imageData.data),
			radius:   radius,
			diameter: diameter,
			strength: alpha
		};
	},

	drawSpot: function(brush, context, x, y, size, alpha, event) {
		var effect = brush._effect;

		if (effect === "blur") {
			var kernelRadius = Math.max(2, Math.round(Math.max(2, Math.round(size / 2)) / 4));
			_effectCircleEach(context, x, y, size, alpha, true, function(data, src, i, blend, t, row, col, radius, diameter) {
				var avg = _effectBoxBlur(src, row, col, diameter, kernelRadius);
				data[i]     = src[i]     + (avg.r - src[i])     * blend;
				data[i + 1] = src[i + 1] + (avg.g - src[i + 1]) * blend;
				data[i + 2] = src[i + 2] + (avg.b - src[i + 2]) * blend;
				data[i + 3] = src[i + 3] + (avg.a - src[i + 3]) * blend;
			});

		} else if (effect === "sharpen") {
			var kernelRadius = Math.max(2, Math.round(Math.max(2, Math.round(size / 2)) / 4));
			_effectCircleEach(context, x, y, size, alpha, true, function(data, src, i, blend, t, row, col, radius, diameter) {
				var avg = _effectBoxBlur(src, row, col, diameter, kernelRadius);
				data[i]     = src[i]     + (src[i]     - avg.r) * blend;
				data[i + 1] = src[i + 1] + (src[i + 1] - avg.g) * blend;
				data[i + 2] = src[i + 2] + (src[i + 2] - avg.b) * blend;
			});

		} else if (effect === "burn") {
			_effectCircleEach(context, x, y, size, alpha, false, function(data, src, i, blend) {
				data[i]     = data[i]     * (1 - blend);
				data[i + 1] = data[i + 1] * (1 - blend);
				data[i + 2] = data[i + 2] * (1 - blend);
			});

		} else if (effect === "dodge") {
			_effectCircleEach(context, x, y, size, alpha, false, function(data, src, i, blend) {
				data[i]     = data[i]     + (255 - data[i])     * blend;
				data[i + 1] = data[i + 1] + (255 - data[i + 1]) * blend;
				data[i + 2] = data[i + 2] + (255 - data[i + 2]) * blend;
			});

		} else if (effect === "noise") {
			_effectCircleEach(context, x, y, size, alpha, false, function(data, src, i, blend) {
				var grain = (Math.random() - 0.5) * 255 * blend;
				data[i]     = Math.min(255, Math.max(0, data[i]     + grain));
				data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + grain));
				data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + grain));
			});

		} else if (effect === "smudge") {
			var s = brush._smudge;
			if (!s) return;
			var ox = Math.round(x) - s.radius;
			var oy = Math.round(y) - s.radius;
			var imageData = context.getImageData(ox, oy, s.diameter, s.diameter);
			var data      = imageData.data;
			var buf       = s.buf;
			for (var row = 0; row < s.diameter; row++) {
				for (var col = 0; col < s.diameter; col++) {
					var dx   = col - s.radius + 0.5;
					var dy   = row - s.radius + 0.5;
					var dist = Math.sqrt(dx * dx + dy * dy);
					if (dist >= s.radius) continue;
					var t      = 1 - dist / s.radius;
					var blend  = s.strength * t * t;
					var i      = (row * s.diameter + col) * 4;
					var pickup = 0.18 * t;
					var origR = data[i],     origG = data[i + 1], origB = data[i + 2], origA = data[i + 3];
					data[i]     = origR + (buf[i]     - origR) * blend;
					data[i + 1] = origG + (buf[i + 1] - origG) * blend;
					data[i + 2] = origB + (buf[i + 2] - origB) * blend;
					data[i + 3] = origA + (buf[i + 3] - origA) * blend;
					buf[i]     += (origR - buf[i])     * pickup;
					buf[i + 1] += (origG - buf[i + 1]) * pickup;
					buf[i + 2] += (origB - buf[i + 2]) * pickup;
					buf[i + 3] += (origA - buf[i + 3]) * pickup;
				}
			}
			context.putImageData(imageData, ox, oy);
		}
	},

	drawStop: function(brush, context, x, y, size, alpha, event) {
		brush._smudge = null;
		return true;
	}
});
