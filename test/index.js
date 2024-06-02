"use strict";

const expect = require('expect.js');
const {git_to_https} = require('../lib/util');

describe("static test suite", function() {

  it("should check git_to_https", function() {

    let urls = {
      "git@git.ivsdev.net:domyks/libraries/ddev.git"      : "https://git.ivsdev.net/domyks/libraries/ddev.git",
      "https://git.ivsdev.net/domyks/libraries/ddev.git"  : "https://git.ivsdev.net/domyks/libraries/ddev.git",

      "git+ssh://git@github.com/131/ppackage.git"     : "https://github.com/131/ppackage.git",

      "git+https://github.com/131/docker-dsexec.git"  : "https://github.com/131/docker-dsexec.git",

    };
    for(let [src, dst] of Object.entries(urls))
      expect(git_to_https(src)).to.eql(dst);
  });






});
