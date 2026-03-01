// gulpfile.js
const gulp = require("gulp");
const concat = require("gulp-concat");
const terser = require("gulp-terser");
const rename = require("gulp-rename");

gulp.task("scripts", function () {
  return gulp
    .src([
      "./src/umd/start.js",
      "./src/*.js",
      "./src/tools/*.js",
      "./src/umd/end.js",
    ])
    .pipe(concat("jquery.drawr.combined.js"))
    .pipe(gulp.dest("./dist/"))
    .pipe(terser())
    .pipe(rename({ suffix: "-min" }))
    .pipe(gulp.dest("./dist/"));
});