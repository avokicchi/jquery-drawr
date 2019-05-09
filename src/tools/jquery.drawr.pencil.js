jQuery.fn.drawr.register({
	icon: "mdi mdi-lead-pencil mdi-24px",
	name: "pencil",
	size: 5,
	alpha: 0.8,
	order: 1,
	pressure_affects_alpha: true,
	pressure_affects_size: false,
	activate: function(brush,context){
		var self = this;
		brush.brushImage = new Image();
	    brush.brushImage.crossOrigin = "Anonymous";
		brush.brushImage.onload = function(){
			//create offscceen buffer.
			var buffer = document.createElement('canvas');
			var bctx = buffer.getContext("2d");
			buffer.width = brush.brushImage.width;
			buffer.height = brush.brushImage.height;
			//fill buffer with color
			bctx.fillStyle = "rgb(" + self.brushColor.r + "," + self.brushColor.g + "," + self.brushColor.b + ")";
            bctx.fillRect(0,0,buffer.width,buffer.height);
            bctx.globalCompositeOperation = "destination-atop";
            bctx.drawImage(brush.brushImage,0,0);
            brush.brushImage = buffer;
		};
		brush.brushImage.src = 'images/lead-pencil.png';//'pencil.png';
	},
	deactivate: function(brush,context){},
	drawStart: function(brush,context,x,y,size,alpha,event){
		context.globalCompositeOperation="source-over";
		context.globalAlpha = alpha;
	},
	drawRotatedImage: function (context, image, x, y, angle, size) {
		context.save();
		context.translate(x,y);
		var randomAngle = (Math.random()*360)+1;
		context.rotate(randomAngle * Math.PI / 180); 
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
		context.globalAlpha = alpha;
		brush.drawRotatedImage(context,brush.brushImage,x,y,0,size);
	},
	drawStop: function(brush,context,x,y,size,alpha,event){
		return true;
	}
});