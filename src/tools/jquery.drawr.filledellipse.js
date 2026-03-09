jQuery.fn.drawr.register({
	icon: "mdi mdi-circle mdi-24px",
	name: "filledellipse",
	size: 3,
	alpha: 1,
	order: 11,
	pressure_affects_alpha: false,
	pressure_affects_size: false,
	activate: function(brush, context) {},
	deactivate: function(brush, context) {},
	drawStart: function(brush, context, x, y, size, alpha, event) {
		context.globalCompositeOperation = "source-over";
		brush.currentAlpha = alpha;
		brush.startPosition = { x: x, y: y };
		this.effectCallback = brush.effectCallback;
		context.globalAlpha = alpha;
	},
	drawStop: function(brush, context, x, y, size, alpha, event) {
		context.globalAlpha = alpha;
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x, sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if (angle) {
			var cx = this.width / 2, cy = this.height / 2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dsx = sx - cx, dsy = sy - cy, dex = ex - cx, dey = ey - cy;
			sx = cx + cos * dsx - sin * dsy;
			sy = cy + sin * dsx + cos * dsy;
			ex = cx + cos * dex - sin * dey;
			ey = cy + sin * dex + cos * dey;
		}
		var ecx = (sx + ex) / 2, ecy = (sy + ey) / 2;
		var rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
		if (rx > 0 && ry > 0) {
			context.beginPath();
			context.ellipse(ecx, ecy, rx, ry, 0, 0, 2 * Math.PI);
			context.fill();
		}
		if (angle) { context.restore(); }
		this.effectCallback = null;
		return true;
	},
	drawSpot: function(brush, context, x, y, size, alpha, event) {
		brush.currentPosition = { x: x, y: y };
	},
	effectCallback: function(context, brush, adjustx, adjusty, adjustzoom) {
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if (angle) {
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W / 2 - adjustx;
			var _cy = _H / 2 - adjusty;
			context.save();
			context.translate(_cx, _cy);
			context.rotate(-angle);
			context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = this.width * adjustzoom / 2, halfH = this.height * adjustzoom / 2;
			var sRelX = brush.startPosition.x  - this.width / 2, sRelY = brush.startPosition.y  - this.height / 2;
			var eRelX = brush.currentPosition.x - this.width / 2, eRelY = brush.currentPosition.y - this.height / 2;
			sx = (cos * sRelX - sin * sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin * sRelX + cos * sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos * eRelX - sin * eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin * eRelX + cos * eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x  * adjustzoom - adjustx;
			sy = brush.startPosition.y  * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		var ecx = (sx + ex) / 2, ecy = (sy + ey) / 2;
		var rx = Math.abs(ex - sx) / 2, ry = Math.abs(ey - sy) / 2;
		if (rx > 0 && ry > 0) {
			context.globalAlpha = brush.currentAlpha;
			context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
			context.beginPath();
			context.ellipse(ecx, ecy, rx, ry, 0, 0, 2 * Math.PI);
			context.fill();
		}
		if (angle) { context.restore(); }
	}
});
