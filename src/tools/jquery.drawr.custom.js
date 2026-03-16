jQuery.fn.drawr.register({
	icon: "mdi mdi-plus mdi-24px",
	name: "custom",
	type: "toggle",
	order: 100,
	buttonCreated: function(brush,button){

		var self = this;

		self.$customToolbox = self.plugin.create_toolbox.call(self,"custom",{ left: $(self).parent().offset().left + $(self).parent().innerWidth() /2, top: $(self).parent().offset().top + $(self).parent().innerHeight() /2 },"Custom",160);

		self.plugin.create_text.call(self, self.$customToolbox,"This tool allows you to create a custom brush.");

		self.plugin.create_label.call(self, self.$customToolbox, "Icon");
		self.icon_input = self.plugin.create_input(self.$customToolbox, "Icon", "mdi-puzzle");

		self.plugin.create_label.call(self, self.$customToolbox, "File");

		var input = self.plugin.create_filepicker(self.$customToolbox, "Load Image", "image/*");
		input.on('change', function() {
			 var file = this.files[0];
		      if (!file) return;
		      var reader = new FileReader();
		      reader.onload = function(e) {
		          var dataUrl = e.target.result;
		          // use dataUrl here, e.g.:
		          self.brush_image = dataUrl;
		      };
		      reader.readAsDataURL(file);
		});

		var btn = self.plugin.create_button.call(self, self.$customToolbox,"Create new brush");
  		btn.on('click', function() {

  			var icon = self.icon_input.val();

  			var new_brush = {
				icon: "mdi " + icon + " mdi-24px",
				name: "test123",
				size: 15,
				alpha: 1,
				order: 1001,
				brush_fade_in: 20,
				pressure_affects_alpha: true,
				pressure_affects_size: false,
				smoothing: false,
				activate: function(brush,context){
					brush._rawImage = new Image();
					brush._rawImage.crossOrigin = "Anonymous";
					brush._stampCache = null;
					brush._stampCacheKey = null;
					brush._rawImage.src = self.brush_image;
				},
				deactivate: function(brush,context){},
				drawStart: function(brush,context,x,y,size,alpha,event){
					context.globalCompositeOperation="source-over";
					context.globalAlpha = alpha;
					brush._lastX = x;
					brush._lastY = y;
					brush._strokeAngle = 0;
				},
				drawRotatedImage: function (context, image, x, y, angle, size) {
					context.save();
					context.translate(x,y);
					context.rotate(angle);
					if(image.width>=image.height){
						var imageHeight=image.height/(image.width/size);
						var imageWidth=size;
					} else {
						var imageWidth=image.width/(image.height/size)
						var imageHeight=size;
					}
					var destx=-imageWidth/2;
					var desty=-imageHeight/2;
					context.drawImage(image,destx,desty,imageWidth,imageHeight);
				    context.restore();
				},
				drawSpot: function(brush,context,x,y,size,alpha,event) {
					if(!brush._rawImage || !brush._rawImage.complete) return;
					var color = this._activeButton === 2 ? this.brushBackColor : this.brushColor;
					var cacheKey = color.r + "," + color.g + "," + color.b;
					if(brush._stampCacheKey !== cacheKey){
						var img = brush._rawImage;
						var buffer = document.createElement("canvas");
						buffer.width = img.width;
						buffer.height = img.height;
						var bctx = buffer.getContext("2d");
						bctx.fillStyle = "rgb(" + color.r + "," + color.g + "," + color.b + ")";
						bctx.fillRect(0, 0, img.width, img.height);
						bctx.globalCompositeOperation = "destination-atop";
						bctx.drawImage(img, 0, 0);
						brush._stampCache = buffer;
						brush._stampCacheKey = cacheKey;
					}
					// compute stroke angle from movement direction, keeping the last angle when stationary
					var dx = x - brush._lastX;
					var dy = y - brush._lastY;
					if(dx !== 0 || dy !== 0){
						brush._strokeAngle = Math.atan2(dx, dy);
					}
					brush._lastX = x;
					brush._lastY = y;

					context.globalAlpha = alpha;
					var calculated_size = parseInt(size);
					if(calculated_size<2) calculated_size = 2;
					brush.drawRotatedImage(context, brush._stampCache, x, y, brush._strokeAngle, calculated_size);
				},
				drawStop: function(brush,context,x,y,size,alpha,event){
					return true;
				}
			};
			jQuery.fn.drawr.register(new_brush);
            self.plugin.create_toolbutton.call(self, self.$brushToolbox[0], "brush", new_brush);

  		});


	},
	action: function(brush,context){
		var self = this;
		self.$customToolbox.toggle();
	},
	cleanup: function(){
		var self = this;
		self.$customToolbox.remove();
		delete self.$customToolbox;
	}

});
