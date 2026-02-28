jQuery.fn.drawr.register({

	icon: "mdi mdi-rotate-right mdi-24px",
	name: "rotate",
	order: 11,

	activate: function(brush,context){
		$(this).parent().css({"cursor":"crosshair"});
	},
	deactivate: function(brush,context){
		$(this).parent().css({"cursor":"default"});
	},
	//reads raw page coordinates to compute angle from canvas center.
	drawStart: function(brush,context,x,y,size,alpha,event){


		var self = this;
		var parent = $(self).parent()[0];
		var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
		var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
		var box = parent.getBoundingClientRect();

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		//click position
		var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
		var py = eventY - (box.y + $(document).scrollTop()) - borderTop;

		//canvas center
		var W = self.width * self.zoomFactor;
		var H = self.height * self.zoomFactor;
		var cx = W / 2 - self.scrollX;
		var cy = H / 2 - self.scrollY;

		brush.startAngle = Math.atan2(py - cy, px - cx);
		brush.startRotation=self.rotationAngle || 0;

	},

	drawSpot: function(brush,context,x,y,size,alpha,event){

		var self = this;
		var parent = $(self).parent()[0];
		/*
		var rect = parent.getBoundingClientRect();
		 
		*/
		var borderTop = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-top-width"));
		var borderLeft = parseInt(window.getComputedStyle(parent, null).getPropertyValue("border-left-width"));
		var box = parent.getBoundingClientRect();

		var eventX, eventY;
		if(event.type=="touchmove" || event.type=="touchstart"){
			eventX = event.originalEvent.touches[0].pageX;
			eventY = event.originalEvent.touches[0].pageY;
		} else {
			eventX = event.pageX;
			eventY = event.pageY;
		}

		var px = eventX - (box.x + $(document).scrollLeft()) - borderLeft;
		var py = eventY - (box.y + $(document).scrollTop()) - borderTop;

		var W = self.width * self.zoomFactor;
		var H = self.height * self.zoomFactor;
		var cx = W / 2 - self.scrollX;
		var cy = H / 2 - self.scrollY;

		var currentAngle = Math.atan2(py - cy, px - cx);
		var delta = currentAngle - brush.startAngle;

		self.plugin.apply_rotation.call(self, brush.startRotation + delta);

	}

});
