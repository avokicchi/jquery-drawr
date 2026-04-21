//unified shape tool: line / arrow / ellipse / filled ellipse / rectangle / filled rectangle.
//the active shape is selected via a dropdown in the shapes toolbox. drawing math is identical
//for every shape (start + current drag positions, with the canvas-rotation inverse applied so
//axis-aligned shapes stay axis-aligned in canvas space), only the final stroke/fill differs.
jQuery.fn.drawr.register({
	icon: "mdi mdi-shape mdi-24px",
	name: "shapes",
	size: 3,
	alpha: 1,
	order: 7,
	_shape: "line",

	//the tool object is shared across all drawr instances on a page, so DOM refs live on
	//`self` (the canvas). `brush._shape` itself is intentionally global — a change in one
	//canvas's dropdown syncs all siblings via brush._shapeDropdowns.
	buttonCreated: function(brush, button) {
		var self = this;

		self.$shapesToolbox = self.plugin.create_toolbox.call(self, "shapes", null, "Shape", 140);

		var $dd = self.plugin.create_dropdown.call(self, self.$shapesToolbox, "Type", [
			{ value: "line",          label: "Line"             },
			{ value: "arrow",         label: "Arrow"            },
			{ value: "ellipse",       label: "Ellipse"          },
			{ value: "filledellipse", label: "Filled Ellipse"   },
			{ value: "rectangle",     label: "Rectangle"        },
			{ value: "filledrect",    label: "Filled Rectangle" }
		], brush._shape);

		if(!brush._shapeDropdowns) brush._shapeDropdowns = [];
		brush._shapeDropdowns.push($dd);

		$dd.on("change.drawr", function() {
			var val = $(this).val();
			brush._shape = val;
			var siblings = brush._shapeDropdowns;
			for(var i = 0; i < siblings.length; i++){
				if(siblings[i][0] !== this) siblings[i].val(val);
			}
			self.plugin.is_dragging = false;
		});
	},

	activate: function(brush, context) {
		if(this.$shapesToolbox) this.plugin.show_toolbox.call(this, this.$shapesToolbox);
	},

	deactivate: function(brush, context) {
		if(this.$shapesToolbox) this.$shapesToolbox.hide();
	},

	drawStart: function(brush, context, x, y, size, alpha, event) {
		context.globalCompositeOperation = "source-over";
		brush.currentAlpha = alpha;
		brush.currentSize = size;
		brush.startPosition = { x: x, y: y };
		brush.currentPosition = { x: x, y: y };
		this.effectCallback = brush.effectCallback;
		context.globalAlpha = alpha;
		this.tempColor = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
	},

	drawSpot: function(brush, context, x, y, size, alpha, event) {
		brush.currentPosition = { x: x, y: y };
	},

	drawStop: function(brush, context, x, y, size, alpha, event) {
		var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
		var angle = this.rotationAngle || 0;
		var sx = brush.startPosition.x,   sy = brush.startPosition.y;
		var ex = brush.currentPosition.x, ey = brush.currentPosition.y;
		if(angle){
			var cx = this.width/2, cy = this.height/2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy); context.rotate(-angle); context.translate(-cx, -cy);
			var dsx = sx-cx, dsy = sy-cy, dex = ex-cx, dey = ey-cy;
			sx = cx + cos*dsx - sin*dsy;
			sy = cy + sin*dsx + cos*dsy;
			ex = cx + cos*dex - sin*dey;
			ey = cy + sin*dex + cos*dey;
		}
		context.globalAlpha  = alpha;
		context.lineWidth    = size;
		context.lineJoin     = 'miter';
		var rgb = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
		context.strokeStyle  = rgb;
		context.fillStyle    = rgb;
		brush._renderShape(context, sx, sy, ex, ey, size, brush._shape);
		if(angle) context.restore();

		this.effectCallback = null;
		return true;
	},

	//draws the selected shape into canvas space. the caller has already applied any rotation
	//transform, so this just draws axis-aligned.
	_renderShape: function(context, sx, sy, ex, ey, size, shape) {
		if(shape === "line"){
			context.beginPath();
			context.moveTo(sx, sy);
			context.lineTo(ex, ey);
			context.stroke();
		} else if(shape === "arrow"){
			var dx = ex - sx, dy = ey - sy;
			var len = Math.sqrt(dx*dx + dy*dy);
			if(len <= 0) return;
			//arrowhead scales with line width but has a sensible minimum.
			var head  = Math.max(size * 5, 12);
			var ang   = Math.atan2(dy, dx);
			var cos   = Math.cos(ang), sin = Math.sin(ang);
			//base of the triangle sits behind the tip by `head` along the line. stop the shaft at
			//the base (slightly inside it, so a round line cap doesn't poke through the fill).
			var baseX = ex - cos * head;
			var baseY = ey - sin * head;
			var shaftEndX = ex - cos * head * 0.9;
			var shaftEndY = ey - sin * head * 0.9;
			context.beginPath();
			context.moveTo(sx, sy);
			context.lineTo(shaftEndX, shaftEndY);
			context.stroke();
			//triangle: tip at (ex,ey), fins fan out from the base. width ~= head * tan(angle/2).
			var spread = head * 0.45;
			context.beginPath();
			context.moveTo(ex, ey);
			context.lineTo(baseX - sin * spread, baseY + cos * spread);
			context.lineTo(baseX + sin * spread, baseY - cos * spread);
			context.closePath();
			context.fill();
		} else if(shape === "rectangle"){
			context.strokeRect(sx, sy, ex-sx, ey-sy);
		} else if(shape === "filledrect"){
			context.fillRect(sx, sy, ex-sx, ey-sy);
		} else if(shape === "ellipse" || shape === "filledellipse"){
			var ecx = (sx+ex)/2, ecy = (sy+ey)/2;
			var rx = Math.abs(ex-sx)/2, ry = Math.abs(ey-sy)/2;
			if(rx > 0 && ry > 0){
				context.beginPath();
				context.ellipse(ecx, ecy, rx, ry, 0, 0, 2*Math.PI);
				if(shape === "filledellipse") context.fill();
				else context.stroke();
			}
		}
	},

	effectCallback: function(context, brush, adjustx, adjusty, adjustzoom) {
		var angle = this.rotationAngle || 0;
		var sx, sy, ex, ey;
		if(angle){
			var _W = this.width * adjustzoom;
			var _H = this.height * adjustzoom;
			var _cx = _W/2 - adjustx;
			var _cy = _H/2 - adjusty;
			context.save();
			context.translate(_cx, _cy); context.rotate(-angle); context.translate(-_cx, -_cy);
			var cos = Math.cos(angle), sin = Math.sin(angle);
			var halfW = _W/2, halfH = _H/2;
			var sRelX = brush.startPosition.x   - this.width/2,  sRelY = brush.startPosition.y   - this.height/2;
			var eRelX = brush.currentPosition.x - this.width/2,  eRelY = brush.currentPosition.y - this.height/2;
			sx = (cos*sRelX - sin*sRelY) * adjustzoom + halfW - adjustx;
			sy = (sin*sRelX + cos*sRelY) * adjustzoom + halfH - adjusty;
			ex = (cos*eRelX - sin*eRelY) * adjustzoom + halfW - adjustx;
			ey = (sin*eRelX + cos*eRelY) * adjustzoom + halfH - adjusty;
		} else {
			sx = brush.startPosition.x   * adjustzoom - adjustx;
			sy = brush.startPosition.y   * adjustzoom - adjusty;
			ex = brush.currentPosition.x * adjustzoom - adjustx;
			ey = brush.currentPosition.y * adjustzoom - adjusty;
		}
		context.globalAlpha = brush.currentAlpha;
		context.lineWidth   = brush.currentSize * adjustzoom;
		context.lineJoin    = 'miter';
		var rgb = "rgb(" + this.tempColor.r + "," + this.tempColor.g + "," + this.tempColor.b + ")";
		context.strokeStyle = rgb;
		context.fillStyle   = rgb;
		brush._renderShape(context, sx, sy, ex, ey, brush.currentSize * adjustzoom, brush._shape);
		if(angle) context.restore();
	}
});
