jQuery.fn.drawr.register({
	icon: "mdi mdi-magnify mdi-24px",
	name: "zoom",
	type: "toggle",
	order: 14,
	buttonCreated: function(brush,button){

		var self = this;

		self.$zoomToolbox = self.plugin.create_toolbox.call(self,"zoom",{ left: $(self).parent().offset().left + $(self).parent().innerWidth() - 80, top: $(self).parent().offset().top },"Zoom",80);
		self.plugin.create_slider.call(self, self.$zoomToolbox,"zoom", 0,400,100).on("input.drawr",function(){
			var cleaned = Math.ceil(this.value/10)*10;
			$(this).next().text(cleaned);
			self.plugin.apply_zoom.call(self,cleaned/100);
		});

	},
	action: function(brush,context){
		var self = this;
		self.$zoomToolbox.toggle();
	},
	cleanup: function(){
		var self = this;
		self.$zoomToolbox.remove();
		delete self.$zoomToolbox;
	}

});
