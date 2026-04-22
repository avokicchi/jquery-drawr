jQuery.fn.drawr.register({
	icon: "mdi mdi-format-text mdi-24px",
	name: "text",
	size: 22,
	alpha: 1,
	order: 14,
	//The tool object is shared across drawr instances on a page, so per-canvas DOM/state
	//(the floating input box, the pending text position) must live on `self` — never on `brush`.
	activate: function(brush,context){

	},
	deactivate: function(brush,context){
		if(typeof this.$textFloatyBox!=="undefined"){
			this.$textFloatyBox.remove();
			delete this.$textFloatyBox;
		}
	},
	canvasToViewport: function(x, y){
		//helper to make translation a bit more readable
		var angle = this.rotationAngle || 0;
		var cx = this.width / 2, cy = this.height / 2;
		var dx = x - cx, dy = y - cy;
		var cos = Math.cos(angle), sin = Math.sin(angle);
		return {
			x: (cos*dx - sin*dy) * this.zoomFactor + cx*this.zoomFactor - this.scrollX,
			y: (sin*dx + cos*dy) * this.zoomFactor + cy*this.zoomFactor - this.scrollY
		};
	},
	drawStart: function(brush,context,x,y,size,alpha,event){
		var self=this;
		self._textPosition = { x: x, y: y };
		context.globalAlpha=alpha
		if(typeof self.$textFloatyBox=="undefined"){
			var fontSizeForDisplay = parseInt(self.brushSize * self.zoomFactor);
			var boxStyle = [
				"z-index:6",
				"position:absolute",
				"font-family:sans-serif"
			].join(";");
			var toolbarStyle = [
				"position:absolute",
				"bottom:100%",
				"left:0",
				"margin-bottom:2px",
				"display:flex",
				"gap:2px",
				"padding:2px",
				"background:#f5f5f5",
				"border:1px solid #bbb",
				"border-radius:3px",
				"box-shadow:0 1px 4px rgba(0,0,0,0.15)"
			].join(";");
			var btnStyle = [
				"border:1px solid #bbb",
				"background:#fff",
				"border-radius:2px",
				"padding:1px 5px",
				"cursor:pointer",
				"line-height:1",
				"font-size:14px"
			].join(";");
			var inputStyle = [
				"background:transparent",
				"border:1px dashed #4a90d9",
				"outline:none",
				"padding:0",
				"margin:0",
				"font-size:" + fontSizeForDisplay + "px",
				"line-height:1",
				"font-family:sans-serif",
				"min-width:80px",
				"box-sizing:content-box"
			].join(";");
			self.$textFloatyBox = $(
				'<div style="' + boxStyle + '">' +
					'<div class="drawr-text-toolbar" style="' + toolbarStyle + '">' +
						'<button class="ok" style="' + btnStyle + '" title="Apply"><i class="mdi mdi-check"></i></button>' +
						'<button class="cancel" style="' + btnStyle + '" title="Cancel"><i class="mdi mdi-close"></i></button>' +
					'</div>' +
					'<input style="' + inputStyle + '" type="text" value="">' +
				'</div>'
			);
			$(self.$textFloatyBox).insertAfter(self.$container);
			var vp = brush.canvasToViewport.call(self, x, y);
			self.$textFloatyBox.css({
				left: self.$container.offset().left + vp.x,
				top: self.$container.offset().top + vp.y,
			});
			self.$textFloatyBox.find("input").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				self.$textFloatyBox.find("input").focus();
			});
			self.$textFloatyBox.find("input").focus();
			event.preventDefault();
			event.stopPropagation();
			self.$textFloatyBox.find(".ok").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				brush.applyText.call(self,context,brush,self._textPosition.x,self._textPosition.y,self.$textFloatyBox.find("input").val());
				self.$textFloatyBox.remove();
				delete self.$textFloatyBox;
			});
			self.$textFloatyBox.find(".cancel").on("pointerdown",function(e){
				e.preventDefault();
				e.stopPropagation();
				self.$textFloatyBox.remove();
				delete self.$textFloatyBox;
			});
		} else {
			var vp = brush.canvasToViewport.call(self, x, y);
			self.$textFloatyBox.css({
				left: self.$container.offset().left + vp.x,
				top: self.$container.offset().top + vp.y,
			});
		}
	},
	measureInputBaselineOffset: function(fontSize){
		//Probe where an <input>'s alphabetic baseline sits relative to its border-box top,
		//for the same font/border/padding/line-height used by the floaty input. Returns pixels
		//in canvas-font units (we build the probe with the canvas font-size directly).
		var probe = document.createElement('div');
		probe.style.cssText = 'position:absolute;visibility:hidden;top:-10000px;left:-10000px;' +
			'font-family:sans-serif;font-size:' + fontSize + 'px;line-height:1;' +
			'border:1px dashed;padding:0;margin:0;box-sizing:content-box;white-space:pre;';
		probe.innerHTML = 'x<span style="display:inline-block;width:0;height:0;vertical-align:baseline;"></span>';
		document.body.appendChild(probe);
		var probeRect = probe.getBoundingClientRect();
		var marker = probe.querySelector('span').getBoundingClientRect();
		var offset = marker.top - probeRect.top;
		document.body.removeChild(probe);
		return offset;
	},
	applyText: function(context,brush,x,y,text){
		var fontSize = this.brushSize;
		context.font = fontSize + "px sans-serif";
		context.textAlign = "left";
		context.textBaseline = "alphabetic";
		context.fillStyle = "rgb(" + this.brushColor.r + "," + this.brushColor.g + "," + this.brushColor.b + ")";
		var angle = this.rotationAngle || 0;
		//Align canvas baseline with input's measured baseline so preview and commit match at any size.
		var baselineOffset = Math.round(brush.measureInputBaselineOffset(fontSize));
		var drawX = x + 1, drawY = y + baselineOffset + 2;
		if(angle){
			var cx = this.width / 2, cy = this.height / 2;
			var cos = Math.cos(angle), sin = Math.sin(angle);
			context.save();
			context.translate(cx, cy);
			context.rotate(-angle);
			context.translate(-cx, -cy);
			var dx = drawX - cx, dy = drawY - cy;
			drawX = cx + cos*dx - sin*dy;
			drawY = cy + sin*dx + cos*dy;
		}
		context.fillText(text, drawX, drawY);
		if(angle){ context.restore(); }
		this.plugin.record_undo_entry.call(this);
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		this._textPosition = { x: x, y: y };
		if(typeof this.$textFloatyBox!=="undefined"){
			var vp = brush.canvasToViewport.call(this, x, y);
			this.$textFloatyBox.css({
				left: this.$container.offset().left + vp.x,
				top: this.$container.offset().top + vp.y,
			});
		}
	}
});

//effectCallback
