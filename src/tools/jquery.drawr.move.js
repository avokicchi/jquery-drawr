jQuery.fn.drawr.register({
	icon: "mdi mdi-cursor-move mdi-24px",
	name: "move",
	order: 13,
	raw_input: true,
	activate: function(brush,context){
		this.$container.css({"cursor":"move"});
	},
	deactivate: function(brush,context){
		this.$container.css({"cursor":"default"});
	},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		var self = this;

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		//right-click rotates, anything else pans. _activeButton is stamped on pointerdown
		//so we can recover it during pointermove where event.button is unreliable.
		brush.mode = (event.button === 2) ? "rotate" : "pan";

		if(brush.mode === "pan"){
			brush.dragStartX = eventX;
			brush.scrollStartX = self.scrollX;
			brush.dragStartY = eventY;
			brush.scrollStartY = self.scrollY;
		} else {
			var parent = self.$container[0];
			var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
			var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
			var box = parent.getBoundingClientRect();
			var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
			var py = eventY - (box.y + $(document).scrollTop()) - borderTop;
			var W = self.width * self.zoomFactor;
			var H = self.height * self.zoomFactor;
			var cx = W / 2 - self.scrollX;
			var cy = H / 2 - self.scrollY;
			brush.startAngle = Math.atan2(py - cy, px - cx);
			brush.startRotation = self.rotationAngle || 0;
		}
	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {
		var self = this;

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		if(brush.mode === "rotate"){
			var parent = self.$container[0];
			var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
			var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
			var box = parent.getBoundingClientRect();
			var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
			var py = eventY - (box.y + $(document).scrollTop()) - borderTop;
			var W = self.width * self.zoomFactor;
			var H = self.height * self.zoomFactor;
			var cx = W / 2 - self.scrollX;
			var cy = H / 2 - self.scrollY;
			var currentAngle = Math.atan2(py - cy, px - cx);
			var delta = currentAngle - brush.startAngle;
			self.plugin.apply_rotation.call(self, brush.startRotation + delta, true);
		} else {
			var diffx = parseInt(-(eventX - brush.dragStartX));
			var diffy = parseInt(-(eventY - brush.dragStartY));
			self.plugin.apply_scroll.call(self, brush.scrollStartX + diffx, brush.scrollStartY + diffy, true);
		}
	}
});
