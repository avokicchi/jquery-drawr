jQuery.fn.drawr.register({
	icon: "mdi mdi-magnify mdi-24px",
	name: "zoom",
	type: "toggle",
	order: 14,
	buttonCreated: function(brush,button){

		var self = this;

		self.$zoomToolbox = self.plugin.create_toolbox.call(self,"zoom",null,"Zoom",80);
		self.plugin.create_slider.call(self, self.$zoomToolbox,"zoom", 0,400,100).on("input.drawr",function(){
			var cleaned = Math.ceil(this.value/10)*10;
			$(this).next().text(cleaned);
			self.plugin.apply_zoom.call(self,cleaned/100);
		});

	},
	action: function(brush,context){
		var self = this;
		if(self.$zoomToolbox.is(":visible")){
			self.$zoomToolbox.hide();
		} else {
			self.plugin.show_toolbox.call(self, self.$zoomToolbox);
		}
	},
	cleanup: function(){
		var self = this;
		self.$zoomToolbox.remove();
		delete self.$zoomToolbox;
	}

});
