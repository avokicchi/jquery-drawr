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
$("#canvas").drawr({ "enable_transparency" : true, "canvas_width" : 800, "canvas_height" : 800 });
$("#canvas").drawr("start");
```
**Features**

- Drawing area
- Extendable brush system
- Custom buttons
- Loading and saving images
- Excellent mobile support
- Basic pen pressure support for Samsung and Apple devices
- Text insertion
- Undo
- Ignores unintended touches

**Methods**

- start
- stop
- load
- export
- button
- destroy
- clear

**Options**

- enable_transparency(true)
- enable_transparency_image(true)
- canvas_width
- canvas_height
- undo_max_levels(5)
- color_mode("presets","picker")
- clear_on_init(true)
- enable_scrollwheel_zooming(true)

[demos and docs at this link](https://rawrfl.es/jquery-drawr/ "demos and docs at this link")

