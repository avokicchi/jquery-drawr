jQuery.fn.drawr.register({
	icon: "mdi mdi-layers mdi-24px",
	name: "layers",
	type: "toggle",
	order: 34,
	buttonCreated: function(brush, button){
		var self = this;
		var plugin = self.plugin;

		self.$layersToolbox = plugin.create_toolbox.call(self, "layers", null, "Layers", 220);

		//toolbar — actions that operate on the active layer. built once; render() re-applies
		//enabled/disabled state on every layer mutation.
		var toolbarDefs = [
			{ key:"add",       icon:"mdi-plus",                title:"Add layer"   },
			{ key:"delete",    icon:"mdi-close",               title:"Delete layer" },
			{ key:"clear",     icon:"mdi-delete",              title:"Clear layer" },
			{ key:"moveup",    icon:"mdi-arrow-up",            title:"Move layer up" },
			{ key:"movedown",  icon:"mdi-arrow-down",          title:"Move layer down" },
			{ key:"mergedown", icon:"mdi-arrow-collapse-down", title:"Merge down" }
		];
		var toolbarHtml = '<div class="drawr-layers-toolbar" style="display:flex;gap:2px;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);align-items:center;">';
		for(var i = 0; i < toolbarDefs.length; i++){
			var d = toolbarDefs[i];
			toolbarHtml += '<span class="drawr-layers-tb-' + d.key + ' mdi ' + d.icon + '" title="' + d.title + '" style="font-size:18px;width:24px;height:24px;line-height:24px;text-align:center;cursor:pointer;border-radius:3px;"></span>';
		}
		toolbarHtml += '</div>';
		self.$layersToolbox.append(toolbarHtml);
		self.$layersToolbox.append('<div class="drawr-layers-rows" style="padding:4px 6px;"></div>');

		var $toolbar = self.$layersToolbox.find('.drawr-layers-toolbar');
		var $rows = self.$layersToolbox.find('.drawr-layers-rows');
		var $tbAdd       = $toolbar.find('.drawr-layers-tb-add');
		var $tbDelete    = $toolbar.find('.drawr-layers-tb-delete');
		var $tbClear     = $toolbar.find('.drawr-layers-tb-clear');
		var $tbMoveUp    = $toolbar.find('.drawr-layers-tb-moveup');
		var $tbMoveDown  = $toolbar.find('.drawr-layers-tb-movedown');
		var $tbMergeDown = $toolbar.find('.drawr-layers-tb-mergedown');

		//apply enabled/disabled styling; returns the can-flag for handler short-circuits.
		function setEnabled($btn, enabled){
			$btn.css({
				"opacity": enabled ? 1 : 0.3,
				"cursor":  enabled ? "pointer" : "not-allowed"
			});
			$btn.data("enabled", !!enabled);
		}

		//escape for safe interpolation of user-entered names into the html template.
		function esc(s){
			return String(s == null ? "" : s).replace(/[&<>"']/g, function(ch){
				return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch];
			});
		}

		function blendOptionsHtml(current){
			var modes = (plugin.BLEND_MODES || [{value:"normal",label:"Normal"},{value:"multiply",label:"Multiply"}]);
			var html = "";
			for(var i = 0; i < modes.length; i++){
				var m = modes[i];
				html += '<option value="' + m.value + '"' + (current === m.value ? ' selected' : '') + '>' + m.label + '</option>';
			}
			return html;
		}

		//toolbar handlers — read activeLayerIndex at click time so they always operate on
		//whatever is currently selected.
		$tbAdd.on('click', function(e){
			e.stopPropagation();
			if(!$(this).data("enabled")) return;
			var layer = plugin.add_layer.call(self, "normal");
			if(layer){
				plugin.set_active_layer.call(self, 0);
				render();
			}
		});
		$tbDelete.on('click', function(e){
			e.stopPropagation();
			if(!$(this).data("enabled")) return;
			var idx = self.activeLayerIndex;
			var layer = self.layers[idx];
			if(!layer) return;
			if(!window.confirm("Delete \"" + (layer.name || "New layer") + "\"?")) return;
			plugin.delete_layer.call(self, idx);
			render();
		});
		$tbClear.on('click', function(e){
			e.stopPropagation();
			if(!$(this).data("enabled")) return;
			var idx = self.activeLayerIndex;
			var layer = self.layers[idx];
			if(!layer) return;
			if(!window.confirm("Clear \"" + (layer.name || "New layer") + "\"?")) return;
			plugin.clear_layer.call(self, idx);
		});
		$tbMoveUp.on('click', function(e){
			e.stopPropagation();
			if(!$(this).data("enabled")) return;
			plugin.move_layer_down.call(self, self.activeLayerIndex + 1);
			render();
		});
		$tbMoveDown.on('click', function(e){
			e.stopPropagation();
			if(!$(this).data("enabled")) return;
			plugin.move_layer_down.call(self, self.activeLayerIndex);
			render();
		});
		$tbMergeDown.on('click', function(e){
			e.stopPropagation();
			if(!$(this).data("enabled")) return;
			plugin.merge_layer_down.call(self, self.activeLayerIndex);
			render();
		});

		//render the row list. top-of-stack first (Photoshop convention).
		function render(){
			$rows.empty();
			var activeIdx = self.activeLayerIndex;

			//toolbar enable/disable based on the active layer.
			setEnabled($tbAdd,       self.layers.length < plugin.MAX_LAYERS);
			setEnabled($tbDelete,    self.layers.length > 1);
			setEnabled($tbClear,     true);
			setEnabled($tbMoveUp,    activeIdx < self.layers.length - 1);
			setEnabled($tbMoveDown,  activeIdx > 0);
			setEnabled($tbMergeDown, activeIdx > 0);

			for(var visualIndex = self.layers.length - 1; visualIndex >= 0; visualIndex--){
				(function(idx){
					var layer = self.layers[idx];
					var isActive = idx === activeIdx;
					var $row = $(
						'<div class="drawr-layer-row" data-idx="' + idx + '" style="' +
							'display:flex;flex-direction:column;gap:2px;padding:4px 6px;margin-bottom:3px;border-radius:3px;cursor:pointer;' +
							'background:' + (isActive ? 'rgba(255,165,0,0.25)' : 'rgba(255,255,255,0.05)') + ';' +
							'border:1px solid ' + (isActive ? 'orange' : 'rgba(255,255,255,0.12)') + ';' +
						'">' +
							'<div style="display:flex;align-items:center;gap:4px;">' +
								'<span class="layer-vis mdi ' + (layer.visible ? 'mdi-eye' : 'mdi-eye-off') + '" title="Toggle visibility" style="cursor:pointer;font-size:16px;width:18px;text-align:center;"></span>' +
								'<input class="layer-name" type="text" value="' + esc(layer.name || "New layer") + '" ' +
									'style="flex:1;min-width:0;font-weight:bold;font-size:11px;background:transparent;border:1px solid transparent;color:inherit;padding:1px 3px;border-radius:2px;">' +
							'</div>' +
							'<div style="display:flex;align-items:center;gap:4px;">' +
								'<select class="layer-mode" style="flex:1;color:#333;font-size:11px;">' +
									blendOptionsHtml(layer.mode) +
								'</select>' +
								'<input class="layer-opacity" type="range" min="0" max="100" value="' + Math.round(layer.opacity * 100) + '" style="flex:1;min-width:0;height:14px;margin:0;">' +
								'<span class="layer-opacity-label" style="min-width:26px;text-align:right;font-size:10px;font-variant-numeric:tabular-nums;">' + Math.round(layer.opacity * 100) + '</span>' +
							'</div>' +
						'</div>'
					);

					//row click sets active (but ignore clicks on controls inside the row)
					$row.on('pointerdown', function(e){
						if($(e.target).is('.layer-vis, .layer-name, select, input, option')) return;
						plugin.set_active_layer.call(self, idx);
						render();
						e.stopPropagation();
					});

					$row.find('.layer-vis').on('click', function(e){
						e.stopPropagation();
						plugin.set_layer_visibility.call(self, idx, !layer.visible);
						render();
					});

					//name input — keyboard-focused editing. swallow pointer/key events so the
					//row-click handler and the global toolbox-drag don't interfere.
					$row.find('.layer-name')
						.on('pointerdown mousedown touchstart keydown', function(e){ e.stopPropagation(); })
						.on('focus', function(){ $(this).css('border-color', 'rgba(255,255,255,0.4)'); })
						.on('blur', function(){
							$(this).css('border-color', 'transparent');
							plugin.set_layer_name.call(self, idx, this.value || "New layer");
							if(!this.value) this.value = "New layer";
						})
						.on('keydown', function(e){ if(e.key === 'Enter') this.blur(); });

					$row.find('.layer-mode').on('change', function(e){
						e.stopPropagation();
						plugin.set_layer_mode.call(self, idx, this.value);
					}).on('pointerdown', function(e){ e.stopPropagation(); });

					$row.find('.layer-opacity').on('input', function(e){
						e.stopPropagation();
						var v = parseInt(this.value, 10) / 100;
						plugin.set_layer_opacity.call(self, idx, v);
						$row.find('.layer-opacity-label').text(Math.round(v * 100));
					}).on('pointerdown', function(e){ e.stopPropagation(); });

					$rows.append($row);
				})(visualIndex);
			}
		}

		//expose for external callers (e.g. the panel should refresh when something else mutates layers).
		self._layersPanelRender = render;
		render();
	},
	action: function(brush, context){
		var self = this;
		if(typeof self._layersPanelRender === "function") self._layersPanelRender();
		if(self.$layersToolbox.is(":visible")){
			self.$layersToolbox.hide();
		} else {
			self.plugin.show_toolbox.call(self, self.$layersToolbox);
		}
	},
	cleanup: function(){
		var self = this;
		if(self.$layersToolbox){
			self.$layersToolbox.remove();
			delete self.$layersToolbox;
		}
		delete self._layersPanelRender;
	}
});
