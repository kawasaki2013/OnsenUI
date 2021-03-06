/*
Copyright 2013-2014 ASIAL CORPORATION

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

*/

import 'babel-polyfill';

import gulp from 'gulp';
import path from'path';
import glob from 'glob';
import gulpIf from 'gulp-if';
import pkg from './package.json';
import {merge} from 'event-stream';
import runSequence from 'run-sequence';
import dateformat from 'dateformat';
import browserSync from 'browser-sync';
import os from 'os';
import fs from 'fs';
import {argv} from 'yargs';
import nodeResolve from 'rollup-plugin-node-resolve';
import babel from 'rollup-plugin-babel';
import karma from 'karma';
import rollup from 'rollup-stream';
import source from 'vinyl-source-stream';
import buffer from 'vinyl-buffer';

////////////////////////////////////////

const $ = require('gulp-load-plugins')();
const CORDOVA_APP = false;

////////////////////////////////////////
// browser-sync
////////////////////////////////////////
gulp.task('browser-sync', () => {
  browserSync({
    server: {
      baseDir: __dirname,
      index: 'index.html',
      directory: true
    },
    files: [],
    watchOptions: {
      //debounceDelay: 400
    },
    ghostMode: false,
    notify: false
  });
});

////////////////////////////////////////
// core
////////////////////////////////////////
gulp.task('core', function() {
  return rollup({
      sourceMap: 'inline',
      entry: './core/src/setup.js',
      plugins: [
        nodeResolve(),
        babel({
          presets: ['es2015-rollup', 'stage-2'],
          babelrc: false
        })
      ],
      format: 'umd',
      moduleName: 'ons'
    })
    .pipe(source('setup.js', './core/src'))
    .pipe(buffer())
    .pipe($.addSrc.prepend('core/vendor/*.js'))
    .pipe($.sourcemaps.init({loadMaps: true}))
    .pipe($.concat('onsenui.js'))
    .pipe($.header('/*! <%= pkg.name %> v<%= pkg.version %> - ' + dateformat(new Date(), 'yyyy-mm-dd') + ' */\n', {pkg: pkg}))
    .pipe($.sourcemaps.write())
    .pipe(gulp.dest('build/js'))
    .on('end', () => browserSync.reload());
});

////////////////////////////////////////
// watch-core
////////////////////////////////////////
gulp.task('watch-core', ['prepare', 'core'], () => {
  return gulp.watch(['core/src/*.js', 'core/src/**/*.js'], ['core']);
});

////////////////////////////////////////
// core-test
////////////////////////////////////////

gulp.task('core-test', ['prepare', 'core', 'core-dts-test'], (done) => {
  // Usage:
  //    # run all unit tests in just one Karma server
  //    gulp core-test
  //
  //    # run only specified unit tests in just one Karma server
  //    gulp core-test --specs core/src/elements/ons-navigator/index.spec.js
  //    gulp core-test --specs "core/src/**/index.spec.js"
  //    gulp core-test --specs "core/src/**/*.spec.js"
  //
  //    # run all unit tests separately
  //    gulp core-test --separately
  //
  //    # run only specified unit tests separately
  //    gulp core-test --separately --specs core/src/elements/ons-navigator/index.spec.js
  //    gulp core-test --separately --specs "core/src/**/index.spec.js"
  //    gulp core-test --separately --specs "core/src/**/*.spec.js"

  (async () => {
    const specs = argv.specs || 'core/src/**/*.spec.js'; // commas cannot be used

    let listOfSpecFiles;
    if (argv.separately) { // resolve glob pattern
      listOfSpecFiles = glob.sync( path.join(__dirname, specs) );
    } else { // do not resolve glob pattern
      listOfSpecFiles = new Array( path.join(__dirname, specs) );
    }

    // Separately launch Karma server for each spec file
    try {
      for (let i = 0 ; i < listOfSpecFiles.length ; i++) {
        $.util.log($.util.colors.blue(path.relative(__dirname, listOfSpecFiles[i])));

        // Pass parameters to Karma config file via `global`
        global.SPEC_FILES = listOfSpecFiles[i];

        // Launch Karma server and wait until it exits
        await (async () => {
          return new Promise((resolve, reject) => {
            new karma.Server(
              {
                configFile: path.join(__dirname, 'core/test/karma.conf.js'),
                singleRun: true, // overrides the corresponding option in config file
                autoWatch: false // same as above
              },
              (exitCode) => {
                const exitMessage = `Karma server has exited with ${exitCode}`;

                switch (exitCode) {
                  case 0: // success
                    $.util.log($.util.colors.green(exitMessage));
                    $.util.log($.util.colors.green('Passed unit tests successfully.'));
                    resolve();
                    break;
                  default: // error
                    $.util.log($.util.colors.red(exitMessage));
                    $.util.log($.util.colors.red('Failed to pass some unit tests. (Otherwise, the unit testing itself is broken)'));
                    if (argv.separately) { // in --separate mode, ignore errors
                      resolve();
                    } else { // not in --separate mode, kill task on errors
                      done('core-test has failed');
                    }
                }
              }
            ).start();
          });
        })();

        // Wait for 500 ms before next iteration to avoid crashes
        await (async () => {
          return new Promise((resolve, reject) => {
            setTimeout(() => { resolve(); }, 500 );
          });
        })();
      }
    } finally {
      global.SPEC_FILES = undefined;
    }

    done();
  })();
});

////////////////////////////////////////
// core-dts-test
////////////////////////////////////////
gulp.task('core-dts-test', () => {
  return gulp.src('core/src/onsenui-test.ts', {read: false})
    .pipe($.shell('tsc "<%= file.path %>" --target es6'))
    .on('error', err => {
      $.util.log($.util.colors.red(err.message));
      throw err;
    });
});

////////////////////////////////////////
// watch-core-test
////////////////////////////////////////
gulp.task('watch-core-test', ['watch-core'], (done) => {
  new karma.Server(
    {
      configFile: path.join(__dirname, 'core/test/karma.conf.js'),
      singleRun: false, // overrides the corresponding option in config file
      autoWatch: true // same as above
    },
    (exitCode) => {
      const exitMessage = `Karma server has exited with ${exitCode}`;

      switch (exitCode) {
        case 0: // success
          $.util.log($.util.colors.green(exitMessage));
          break;
        default: // error
          $.util.log($.util.colors.red(exitMessage));
      }
      done();
    }
  ).start();
});

////////////////////////////////////////
// html2js
////////////////////////////////////////
gulp.task('html2js', () => {
  return gulp.src('bindings/angular1/templates/*.tpl')
    .pipe($.html2js('angular.js', {
      adapter: 'angular',
      base: path.join(__dirname, 'bindings/angular1'),
      name: 'templates-main',
      useStrict: true,
      quoteChar: '\''
    }))
    .pipe($.concat('templates.js'))
    .pipe(gulp.dest('bindings/angular1/directives/'));
});

/////////////////////////////////////////
// eslint
////////////////////////////////////////
gulp.task('eslint', () => {
  return gulp.src(eslintTargets())
    .pipe($.cached('eslint'))
    .pipe($.eslint({useEslintrc: true}))
    .pipe($.remember('eslint'))
    .pipe($.eslint.format());
});

/////////////////////////////////////////
// watch-eslint
////////////////////////////////////////
gulp.task('watch-eslint', ['eslint'], () => {
  gulp.watch(eslintTargets(), ['eslint']);
});

function eslintTargets() {
  return [
    'gulpfile.babel.js',
    'docs/packages/**/*.js',
    'core/src/*.js',
    'core/src/**/*.js',
    'bindings/angular1/js/*.js',
    'bindings/angular1/directives/*.js',
    'bindings/angular1/services/*.js',
    'bindings/angular1/elements/*.js',
    'bindings/angular1/views/*.js'
  ];
}

////////////////////////////////////////
// clean
////////////////////////////////////////
gulp.task('clean', () => {
  return gulp.src([
    '.tmp',
    'build',
    '.selenium/'
  ], {read: false}).pipe($.clean());
});

////////////////////////////////////////
// minify
////////////////////////////////////////
gulp.task('minify-js', () => {
  return merge(
    gulp.src('build/js/{onsenui,angular-onsenui}.js')
      .pipe($.uglify({
        mangle: false,
        preserveComments: (node, comment) => {
          return comment.line === 1;
        }
      }))
      .pipe($.rename(path => {
        path.extname = '.min.js';
      }))
      .pipe(gulp.dest('build/js/'))
      .pipe(gulpIf(CORDOVA_APP, gulp.dest('cordova-app/www/lib/onsen/js')))
  );
});

////////////////////////////////////////
// prepare
////////////////////////////////////////
gulp.task('prepare', ['html2js'], () =>  {

  let onlyES6;

  return merge(

    // angular-onsenui.js
    gulp.src([
      'bindings/angular1/vendor/*.js',
      'bindings/angular1/lib/*.js',
      'bindings/angular1/directives/templates.js',
      'bindings/angular1/js/onsen.js',
      'bindings/angular1/views/*.js',
      'bindings/angular1/directives/*.js',
      'bindings/angular1/services/*.js',
      'bindings/angular1/js/*.js'
    ])
      .pipe($.plumber())
      .pipe($.ngAnnotate({
        add: true,
        single_quotes: true // eslint-disable-line camelcase
      }))
      .pipe($.sourcemaps.init())
      .pipe($.babel())
      .pipe($.concat('angular-onsenui.js'))
      .pipe($.header('/*! angular-onsenui.js for <%= pkg.name %> - v<%= pkg.version %> - ' + dateformat(new Date(), 'yyyy-mm-dd') + ' */\n', {pkg: pkg}))
      .pipe($.sourcemaps.write())
      .pipe(gulp.dest('build/js/'))
      .pipe(gulpIf(CORDOVA_APP, gulp.dest('cordova-app/www/lib/onsen/js'))),

    // onsen-css-components
    gulp.src([
      'css-components/components-src/dist/*.css',
    ])
      .pipe(gulp.dest('build/css/'))
      .pipe(gulpIf(CORDOVA_APP, gulp.dest('cordova-app/www/lib/onsen/css'))),

    // stylus files
    gulp.src([
      'css-components/components-src/stylus/**/*'
    ])
      .pipe(gulp.dest('build/stylus/')),


    // onsenui.css
    gulp.src([
      'core/css/common.css',
      'core/css/*.css'
    ])
      .pipe($.concat('onsenui.css'))
      .pipe($.autoprefixer('> 1%', 'last 2 version', 'ff 12', 'ie 8', 'opera 12', 'chrome 12', 'safari 12', 'android 2', 'ios 6'))
      .pipe($.header('/*! <%= pkg.name %> - v<%= pkg.version %> - ' + dateformat(new Date(), 'yyyy-mm-dd') + ' */\n', {pkg: pkg}))
      .pipe(gulp.dest('build/css/'))
      .pipe(gulpIf(CORDOVA_APP, gulp.dest('cordova-app/www/lib/onsen/css'))),

    // angular.js copy
    gulp.src('bindings/angular1/lib/angular/*.*')
      .pipe(gulp.dest('build/js/angular/')),

    // font-awesome fle copy
    gulp.src('core/css/font_awesome/**/*')
      .pipe(gulp.dest('build/css/font_awesome/')),

    // ionicons file copy
    gulp.src('core/css/ionicons/**/*')
      .pipe(gulp.dest('build/css/ionicons/')),

    // material icons file copy
    gulp.src('core/css/material-design-iconic-font/**/*')
      .pipe(gulp.dest('build/css/material-design-iconic-font/')),

    // type definitions copy
    gulp.src('core/src/onsenui.d.ts')
      .pipe(gulp.dest('build/js/')),

    // auto prepare
    gulp.src('cordova-app/www/index.html')
      .pipe(gulpIf(CORDOVA_APP, $.shell(['cd cordova-app; cordova prepare'])))
  );
});

////////////////////////////////////////
// prepare-css-components
////////////////////////////////////////
gulp.task('prepare-css-components', ['prepare'], () => {
  return gulp.src(['build/**', '!build/docs', '!build/docs/**'])
    .pipe(gulp.dest('css-components/www/patterns/lib/onsen'));
});

////////////////////////////////////////
// compress-distribution-package
////////////////////////////////////////
gulp.task('compress-distribution-package', () => {
  const src = [
    path.join(__dirname, 'build/**'),
    '!' + path.join(__dirname, 'build/docs/**'),
    '!' + path.join(__dirname, 'build/stylus/**')
  ];

  return gulp.src(src)
    .pipe($.zip('onsenui.zip'))
    .pipe(gulp.dest(path.join(__dirname, 'build')));
});

////////////////////////////////////////
// build
////////////////////////////////////////
gulp.task('build', done => {
  return runSequence(
    'clean',
    'core',
    'prepare',
    'minify-js',
    'build-docs',
    'prepare-css-components',
    'compress-distribution-package',
    done
  );
});

////////////////////////////////////////
// dist
////////////////////////////////////////

gulp.task('soft-build', done => {
  return runSequence(
    'clean',
    'core',
    'prepare',
    'minify-js',
    done
  );
});

function distFiles() {
  return gulp.src([
    'build/**/*',
    '!build/docs/**/*',
    '!build/docs/',
    '!build/js/angular/**/*',
    '!build/js/angular/',
    '!build/onsenui.zip',
    'bower.json',
    'package.json',
    '.npmignore',
    'README.md',
    'CHANGELOG.md',
    'LICENSE'
  ])
  .pipe(gulp.dest('OnsenUI-dist/'));
}

gulp.task('dist', ['soft-build'], distFiles);

gulp.task('dist-no-build', [], distFiles);

////////////////////////////////////////
// serve
////////////////////////////////////////
gulp.task('serve', ['watch-eslint', 'prepare', 'browser-sync', 'watch-core'], () => {
  gulp.watch(['bindings/angular1/templates/*.tpl'], ['html2js']);

  const watched = [
    'bindings/angular1/*/*',
    'core/css/*.css',
    'css-components/components-src/dist/*.css'
  ];

  if (CORDOVA_APP) {
    watched.push('cordova-app/www/*.html');
  }

  gulp.watch(watched, {
    debounceDelay: 300
  }, ['prepare']);

  // for livereload
  gulp.watch([
    'examples/*/*.{js,css,html}',
    'bindings/angular1/test/e2e/*/*.{js,css,html}'
  ]).on('change', changedFile => {
    gulp.src(changedFile.path)
      .pipe(browserSync.reload({stream: true, once: true}));
  });
});

////////////////////////////////////////
// build-docs
////////////////////////////////////////
gulp.task('build-docs', () => {
  return require('./docs/wcdoc')(path.join(__dirname, '/build/docs'));
});

////////////////////////////////////////
// test
////////////////////////////////////////
gulp.task('test', function(done) {
  return runSequence('core-test', done);
});
