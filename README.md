# jquery-drawr
JQuery dRawr is a jquery plugin to turn any canvas element into a drawing area with a lot of useful tools and brushes.

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
- Basic pen pressure support for Samsung / Apple devices / Wacom
- Text insertion
- Undo
- Ignores unintended touches
- Rotation, pinch to zoom and dragging on mobile, right click to draw and mousewheel zooming on desktop

**Methods**

- start: starts the canvas draw loop and loads tools
- stop: stops
- load(data_url): loads a data url into the canvas, adjusting the size of the canvas to match.
- export(mime_type): returns a data url in the given format of the current drawing. (Doesn't force a download!)
- button(buttonconfig): creates a button. $("#drawr-container .demo-canvas").drawr("button", {"icon":"mdi mdi-folder-open mdi-24px" }).on("mousedown"...etc)
- destroy: cleans everything up
- clear(clear_undo): clears the canvas and optionally resets the undo/redo buffers.
- createtoolset(name,tools): see minimal.html. Creates a set of tools.
- loadtoolset(name): see minimal.html. Loads a set of tools.
- movetoolbox({x:a,y:b}) moves the main tool palette offset from the topleft of the canvas.

**Options**

- enable_transparency(true)
- enable_transparency_image(true)
- canvas_width
- canvas_height
- undo_max_levels(5)
- color_mode("presets","picker"): defines the behaviour of the color picker.
- clear_on_init(true): whether to erase the canvas when it is loaded.
- enable_scrollwheel_zooming(true)
- toolbox_cols(2): configure the toolbox size

Also available [on npm](https://www.npmjs.com/package/jquery-drawr). For installation,

npm install jquery-drawr

[demos and docs at this link](https://rawrfl.es/jquery-drawr/ "demos and docs at this link")

