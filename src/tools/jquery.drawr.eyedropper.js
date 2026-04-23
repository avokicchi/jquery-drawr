jQuery.fn.drawr.register({
	icon: "mdi mdi-eyedropper mdi-24px",
	name: "eyedropper",
	order: 30,
	raw_input: true,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){

		var rgb_to_hex = function(r, g, b) {
            var rgb = b | (g << 8) | (r << 16);
            return '#' + (0x1000000 + rgb).toString(16).slice(1)
        };

		var self = this;
		//with multiple layers, sample the composited pixel the user sees (respecting blend modes
		//and per-layer opacity). single-layer falls through to the active context directly.
		var raw;
		if(self.layers && self.layers.length > 1){
			var comp = self.plugin.composite_for_export.call(self);
			raw = comp.getContext("2d", { alpha: self.settings.enable_transparency }).getImageData(Math.round(x), Math.round(y), 1, 1).data;
		} else {
			raw = context.getImageData(x, y, 1, 1).data;
		}
		var hex = rgb_to_hex(raw[0], raw[1], raw[2]);

		if(this._activeButton === 2){
			self.brushBackColor = { r: raw[0], g: raw[1], b: raw[2] };
			self.$settingsToolbox.find('.color-picker2.active-drawrpalette').drawrpalette("set", hex);
		} else {
			self.brushColor = { r: raw[0], g: raw[1], b: raw[2] };
			self.$settingsToolbox.find('.color-picker.active-drawrpalette').drawrpalette("set", hex);
		}

	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {


	}
});
