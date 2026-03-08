jQuery.fn.drawr.register({
	icon: "mdi mdi-eyedropper mdi-24px",
	name: "eyedropper",
	order: 6,
	activate: function(brush,context){},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){

		var rgb_to_hex = function(r, g, b) {
            var rgb = b | (g << 8) | (r << 16);
            return '#' + (0x1000000 + rgb).toString(16).slice(1)
        };

		var self = this;
		var raw = context.getImageData(x, y, 1, 1).data; 
		self.brushColor={ r: raw[0], g: raw[1], b: raw[2]};

		var picker = self.$settingsToolbox.find('.color-picker.active-drawrpalette');
		var hex = rgb_to_hex(raw[0], raw[1], raw[2]);

		picker.drawrpalette("set",hex);

	},
	drawSpot: function(brush,context,x,y,size,alpha,event) {

		
	}
});