jQuery.fn.drawr.register({
	icon: "mdi mdi-tune mdi-24px",
	name: "settings",
	type: "toggle",
	order: 12,
	buttonCreated: function(brush,button){

		var self = this;
		var context = self.getContext('2d');

		//color dialog
		self.$settingsToolbox = self.plugin.create_toolbox.call(self,"settings",{ left: $(self).parent().offset().left + $(self).parent().innerWidth() - 80, top: $(self).parent().offset().top },"Settings",80);

		if(self.settings.color_mode=="presets"){
			var colors = ["#FFFFFF","#0074D9","#2ECC40","#FFDC00","#FF4136","#111111"];
			$.each(colors,function(i,color){
				self.plugin.create_button.call(self,self.$settingsToolbox[0],"color",{"icon":""},{"background":color}).on("touchstart.drawr mousedown.drawr",function(){
					self.brushColor = self.plugin.hex_to_rgb(color);
					if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,context);
					self.plugin.is_dragging=false;
				});
			});
		}else {
			self.$settingsToolbox.append("<input type='text' class='color-picker'/>");
			self.$settingsToolbox.find('.color-picker').drawrpalette({ auto_apply: true }).on("choose.drawrpalette",function(event,hexcolor){
				self.brushColor = self.plugin.hex_to_rgb(hexcolor);
				if(typeof self.active_brush.activate!=="undefined") self.active_brush.activate.call(self,self.active_brush,context);
			});
		}
		self.plugin.create_slider.call(self, self.$settingsToolbox,"alpha", 0,100,parseInt(100*self.settings.inital_brush_alpha)).on("input.drawr",function(){
			self.brushAlpha = parseFloat(this.value/100);
			self.active_brush.alpha = parseFloat(this.value/100);;
			self.plugin.is_dragging=false;
		});
		self.plugin.create_slider.call(self, self.$settingsToolbox,"size", 1,100,self.settings.inital_brush_size).on("input.drawr",function(){
			self.brushSize = this.value;
			self.active_brush.size = this.value;
			self.plugin.is_dragging=false;
		});
		//size dialog

	},
	action: function(brush,context){
		var self = this;
		self.$settingsToolbox.toggle();

	},
	cleanup: function(){
		var self = this;
		self.$settingsToolbox.remove();
		delete self.$settingsToolbox;
	}

});
