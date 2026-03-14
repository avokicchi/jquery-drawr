// gulpfile.js
const gulp = require("gulp");
const concat = require("gulp-concat");
const terser = require("gulp-terser");
const rename = require("gulp-rename");
const { Transform } = require("stream");
const pkg = require("./package.json");

function injectVersion() {
  return new Transform({
    objectMode: true,
    transform(file, enc, cb) {
      if (file.isBuffer()) {
        file.contents = Buffer.from(
          file.contents.toString().replace(/@@VERSION@@/g, pkg.version)
        );
      }
      cb(null, file);
    },
  });
}

gulp.task("scripts", function () {
  return gulp
    .src([
      "./src/umd/start.js",
      "./src/*.js",
      "./src/tools/*.js",
      "./src/umd/end.js",
    ])
    .pipe(concat("jquery.drawr.combined.js"))
    .pipe(injectVersion())
    .pipe(gulp.dest("./dist/"))
    .pipe(terser())
    .pipe(rename({ suffix: "-min" }))
    .pipe(gulp.dest("./dist/"));
});