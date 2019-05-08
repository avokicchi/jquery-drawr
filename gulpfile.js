// gulpfile.js
var gulp = require('gulp');
var concat = require('gulp-concat');
var minify = require('gulp-minify');

gulp.task('scripts', function() {
  return gulp.src(['./src/*.js', './src/tools/*.js'])
    .pipe(concat('jquery.drawr.combined.js'))
    .pipe(minify())
    .pipe(gulp.dest('./dist/'))
    .pipe(gulp.dest('./web/'));
});