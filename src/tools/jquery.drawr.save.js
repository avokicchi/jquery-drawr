jQuery.fn.drawr.register({
	icon: "mdi mdi-content-save mdi-24px",
	name: "save",
	type: "action",
	order: 19,
	action: function(brush,context){
		var imagedata = $(this).drawr("export","image/png");
		var element = document.createElement('a');
		element.setAttribute('href', imagedata);
		var filename = "download-" + Date.now() + ".png";
		element.setAttribute('download', filename);
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	}

});