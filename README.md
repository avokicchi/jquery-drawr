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
**Features**
1.  Drawing area
2.  Extendable brush system
3.  Custom buttons
4.  Loading and saving images
5.  Excellent mobile support
6.  Basic pen pressure support for Samsung and Apple devices
7.  Text insertion
8.  Undo
9.  Ignores unintended touches

**Methods**

1.  start
2.  stop
3.  load
4.  export
5.  button
6.  destroy
7.  clear

**Options**

1.  enable_tranparency
2.  canvas_width
3.  canvas_height
4.  undo_max_levels(5)
5.  color_mode("presets","picker")
6.  clear_on_init

[demos and docs at this link](https://rawrfl.es/jquery-drawr/ "demos and docs at this link")

