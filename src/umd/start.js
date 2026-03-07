(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define(["jquery"], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory(require("jquery"));
  } else {
    factory(root.jQuery);
  }
}(typeof self !== "undefined" ? self : this, function ($) {
  //"use strict";
  if (!$) throw new Error("jquery-drawr requires jQuery");
  var jQuery = $;