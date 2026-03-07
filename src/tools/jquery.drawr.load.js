jQuery.fn.drawr.register({
	icon: "mdi mdi-folder-open mdi-24px",
	name: "load",
	type: "action",
	order: 20,
	buttonCreated: function(brush,button){

		var self = this;

		var filePicker = $('<input type="file" class="drawr-filepicker-fix" accept="image/*">').css({
			position: 'absolute', 
			top: 0, 
			left: 0,
			width: "100%",
			height: "100%",
			opacity: 0,
			cursor: 'pointer'
		});
		button.css({
			'position' : 'relative'
		}).append(filePicker);
		filePicker[0].onchange = function(){
			var file = filePicker[0].files[0];
			if (!file || !file.type.startsWith('image/')){ return; }
			var reader = new FileReader();
			reader.onload = function(e) {
				$(self).drawr("load",e.target.result);//hacky, but works
			};
			reader.readAsDataURL(file);
		};

	}

});