# jquery-drawr

JQuery dRawr is a jquery plugin to turn any canvas element into a drawing area with a lot of useful tools and brushes.

Screenshot:

![screenshot of canvas](https://rawrfl.es/jquery-drawr/images/canvas.jpg "Screenshot of canvas with tools")

Usage:

```
<div style="width:350px;height:300px;" class="some-container">
	<canvas id="canvas"></canvas>
</div>
```

```javascript
$("#canvas").drawr({ "enable_tranparency" : true, "canvas_width" : 800, "canvas_height" : 800 });
$("#canvas").drawr("start");
```

More [Info and demos at this link](https://rawrfl.es/jquery-drawr/ "Info and demos at this link")
