"use strict";

const expect = require('expect.js');
const ppackage = require('..');

describe("static test suite", function() {

  it("should check git_to_https", function() {

    let git_url  = "git@git.ivsdev.net:domyks/libraries/ddev.git";
    let http_url = "https://git.ivsdev.net/domyks/libraries/ddev.git";

    expect(ppackage._git_to_https(git_url)).to.eql(http_url);
    expect(ppackage._git_to_https(http_url)).to.eql(http_url);
  });






});
