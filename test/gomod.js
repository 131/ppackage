"use strict";

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const expect = require('expect.js');
const gomod = require('../lib/gomod');
const {repository_path, parse_repository, format_repository} = require('../lib/util');

const PPACKAGE = path.join(__dirname, '..', 'index.js');
const URL = "git@github.com:131/vvauth.git";

describe("go.mod support", function() {
  this.timeout(20 * 1000);

  it("should read the module directive as {repository, major}", function() {
    expect(gomod.parse("module github.com/131/vvauth\n\ngo 1.22\n")).to.eql({module_path : "github.com/131/vvauth", major : null, version : undefined, repository_path : "github.com/131/vvauth"});
    expect(gomod.parse("module github.com/131/vvauth/v2\n\n// version: 2.5.0\n\ngo 1.22\n")).to.eql({module_path : "github.com/131/vvauth/v2", major : 2, version : "2.5.0", repository_path : "github.com/131/vvauth"});
    expect(gomod.parse("module github.com/131/v2ray\n").major).to.eql(null);
    expect(() => gomod.parse("go 1.22\n")).to.throwError();
  });

  it("should write the module directive and version marker", function() {
    let body = "module github.com/131/vvauth\n\ngo 1.22\n";
    body = gomod.set_version(body, "2.5.0");
    expect(body).to.eql("module github.com/131/vvauth\n\n// version: 2.5.0\n\ngo 1.22\n");
    body = gomod.set_module(body, URL, 2);
    expect(body).to.eql("module github.com/131/vvauth/v2\n\n// version: 2.5.0\n\ngo 1.22\n");
    body = gomod.set_version(body, "2.6.0");
    expect(body).to.eql("module github.com/131/vvauth/v2\n\n// version: 2.6.0\n\ngo 1.22\n");
    expect(gomod.set_module(body, "https://github.com/131/other.git", 1)).to.contain("module github.com/131/other\n");
  });

  it("should strip the protocol from repository urls", function() {
    for(const url of [URL, "ssh://git@github.com/131/vvauth.git", "git+ssh://git@github.com/131/vvauth.git", "git+https://github.com/131/vvauth.git", "https://github.com/131/vvauth", "github.com/131/vvauth"])
      expect(repository_path(url)).to.eql("github.com/131/vvauth");
    expect(parse_repository(URL)).to.eql({repository_path : "github.com/131/vvauth", repository_protocol : "git@"});
    expect(parse_repository("git+ssh://git@github.com/131/vvauth.git").repository_protocol).to.eql("git+ssh://git@");
    expect(parse_repository("https://github.com/131/vvauth").repository_protocol).to.eql("https://");
    expect(parse_repository("github.com/131/vvauth").repository_protocol).to.eql(null);
    expect(parse_repository(undefined)).to.eql({repository_path : undefined, repository_protocol : null});
    for(const url of [URL, "ssh://git@github.com/131/vvauth.git", "https://github.com/131/vvauth.git"]) {
      let {repository_path, repository_protocol} = parse_repository(url);
      expect(format_repository(repository_path, repository_protocol)).to.eql(url);
    }
    expect(format_repository("github.com/131/vvauth")).to.eql(URL); // git style by default
    expect(gomod.module_path(URL, 1)).to.eql("github.com/131/vvauth");
    expect(gomod.module_path(URL, 2)).to.eql("github.com/131/vvauth/v2");
  });

  const env = {...process.env, GIT_AUTHOR_NAME : 'test', GIT_AUTHOR_EMAIL : 't@t', GIT_COMMITTER_NAME : 'test', GIT_COMMITTER_EMAIL : 't@t'};
  const repository = function({module_path, markers = "", pkg}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppackage-go-'));
    const git = (...args) => {
      const res = spawnSync('git', args, {cwd : dir, encoding : 'utf8', env});
      expect(res.status).to.eql(0);
      return res.stdout.trim();
    };
    git('init', '-q');
    if(pkg)
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, 'go.mod'), `module ${module_path}\n${markers}\ngo 1.22\n`);
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const ppackage = (...args) => spawnSync('node', [PPACKAGE, ...args], {cwd : dir, encoding : 'utf8', env});
    const gomod = () => fs.readFileSync(path.join(dir, 'go.mod'), 'utf8');
    return {dir, git, ppackage, gomod};
  };
  const npm = {name : "vvauth", version : "2.4.1", repository : {type : "git", url : URL}};

  it("should converge with a protocol-less go.mod", function() {
    const {ppackage, git, gomod} = repository({module_path : "github.com/131/vvauth/v2", pkg : {...npm, repository : {type : "git", url : "git+https://github.com/131/vvauth.git"}}});
    expect(ppackage('version', 'minor').status).to.eql(0);
    expect(git('tag')).to.eql("v2.5.0");
    expect(gomod()).to.eql("module github.com/131/vvauth/v2\n\n// version: 2.5.0\n\ngo 1.22\n");
  });

  it("should refuse inconsistent protocols", function() {
    const {ppackage, git} = repository({module_path : "github.com/131/vvauth/v2", pkg : npm});
    fs.writeFileSync(path.join(git('rev-parse', '--show-toplevel'), 'Dockerfile'), `FROM scratch\nLABEL org.opencontainers.image.source="https://github.com/131/vvauth.git"\n`);
    git('add', '.'); git('commit', '-q', '-m', 'docker');
    const res = ppackage('version', 'minor');
    expect(res.status).not.to.eql(0);
    expect(res.stderr + res.stdout).to.contain("Inconsitant repository protocol");
    expect(git('tag')).to.eql("");
  });

  it("should refuse a module path foreign to the repository", function() {
    const {ppackage, git} = repository({module_path : "github.com/other/vvauth/v2", pkg : npm});
    const res = ppackage('version', 'minor');
    expect(res.status).not.to.eql(0);
    expect(res.stderr + res.stdout).to.contain("Inconsitant repository");
    expect(git('tag')).to.eql("");
  });

  it("should rename the module from ppackage repository", function() {
    const {ppackage, git, gomod} = repository({module_path : "github.com/other/vvauth/v2", pkg : npm});
    expect(ppackage('repository').status).to.eql(0);
    expect(gomod()).to.eql("module github.com/131/vvauth/v2\n\ngo 1.22\n");
    expect(git('show', '--stat', '--format=', 'HEAD')).to.contain("go.mod");
  });

  it("should align go.mod with package.json and tag", function() {
    const {ppackage, git, dir, gomod} = repository({module_path : "github.com/131/vvauth/v2", pkg : npm});
    expect(ppackage('version', 'minor').status).to.eql(0);
    expect(git('tag')).to.eql("v2.5.0");
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version).to.eql("2.5.0");
    expect(gomod()).to.eql("module github.com/131/vvauth/v2\n\n// version: 2.5.0\n\ngo 1.22\n");
    expect(git('status', '--porcelain')).to.eql("");
  });

  it("should carry the major suffix on a major release", function() {
    const {ppackage, git, gomod} = repository({module_path : "github.com/131/ssh-agent-crypt", markers : "\n// version: 1.2.1\n"});
    expect(ppackage('version', 'patch').status).to.eql(0);
    expect(git('tag')).to.eql("v1.2.2");
    expect(gomod()).to.eql("module github.com/131/ssh-agent-crypt\n\n// version: 1.2.2\n\ngo 1.22\n");
    expect(ppackage('version', 'major').status).to.eql(0);
    expect(git('tag')).to.contain("v2.0.0");
    expect(gomod()).to.eql("module github.com/131/ssh-agent-crypt/v2\n\n// version: 2.0.0\n\ngo 1.22\n");
  });
});
