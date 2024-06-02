"use strict";

const fs   = require('fs');
const path = require('path');
const semver   = require('semver');
const {spawn} = require('child_process');

const args = require('nyks/process/parseArgs')();
const passthru = require('nyks/child_process/passthru');
const wait = require('nyks/child_process/wait');

const Dockerfile = require('./lib/dockerfile');
const {Parser, Composer} = require('yaml');



const GIT_FOLDER = ".git";
const NPM_PACKAGE_PATH = 'package.json';
const DOCKERIGNORE_PATH = ".dockerignore";
const NPMIGNORE_PATH    = ".npmignore";
const GITIGNORE_PATH    = ".gitignore";



const laxParser = function(body) {
  const tokens = new Parser().parse(body);
  const docs = new Composer({merge : true, uniqueKeys : false}).compose(tokens);
  return docs.next().value;
};


class ppackage {

  async version(version = false, notag = false) {
    let current_version;


    const DOCKER_LABEL_VERSION = "org.opencontainers.image.version";
    const GITLAB_PATH_VERSION  = ".version";

    let modes = {
      gitlab    : {
        file    : '.gitlab-ci.yml',
        analyze : function() {
          const body = fs.readFileSync(this.file, 'utf-8');
          this.meta = laxParser(body);
          current_version = this.meta.get(GITLAB_PATH_VERSION);
        },
        commit : function({target_version, files}) {
          let opts = {lineWidth : 0};
          this.meta.set(GITLAB_PATH_VERSION, target_version);
          fs.writeFileSync(this.file, this.meta.toString(opts));
          files.push(this.file);
        }

      },
      composer  : {
        file : 'composer.json',
        analyze : function() {
          const body = fs.readFileSync(this.file, 'utf-8');
          this.meta = JSON.parse(body);
          current_version = this.meta.version;
        },
        commit : function({target_version, files}) {
          this.meta.version =  target_version;
          fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2));
          files.push(this.file);
        }
      },
      docker    : {
        file : 'Dockerfile',
        analyze : function () {
          const body = fs.readFileSync(this.file, 'utf-8');
          this.meta = Dockerfile.parse(body);
          current_version = this.meta.labels[DOCKER_LABEL_VERSION];
        },
        commit : function({target_version, files}) {
          this.meta.setLabel(DOCKER_LABEL_VERSION, target_version);
          fs.writeFileSync(this.file, this.meta.toString());
          files.push(this.file);
        }
      },

      npm       : {
        file : 'package.json',
        analyze : function () {
          const body = fs.readFileSync(this.file, 'utf-8');
          this.meta = JSON.parse(body);
          current_version = this.meta.version;
        },
        commit : function({target_version, files}) {
          this.meta.version =  target_version;
          fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2));
          files.push(this.file);
        }

      }
    };

    // prepare modes
    for(let [mode_n, mode] of Object.entries(modes)) {
      if(!fs.existsSync(mode.file)) {
        delete modes[mode_n];
        continue;
      }
      mode.analyze.call(mode);
    }



    let target_version = version || args.args.shift();

    let dirty = await wait(spawn('git', ["diff-index", "--quiet", "HEAD"])).catch(() => true);
    if(dirty && !notag)
      throw "Working directory not clean, aborting";


    if(!current_version)
      current_version =  "0.0.0";

    if(!semver.valid(target_version))
      target_version = semver.inc(current_version, target_version);

    if(!target_version)
      throw `Invalid semver range`;

    if(modes.npm && !process.env['npm_package_version']) {
      let version_hook = modes.npm.meta.scripts && modes.npm.meta.scripts.version;
      if(version_hook) {
        console.log("Running version hook", version_hook);
        await passthru(version_hook, {shell : true, env : {npm_package_version : target_version}});
      }
    }


    let files = [];
    for(let [, mode] of Object.entries(modes))
      mode.commit.call(mode, {target_version, files});

    await passthru('git', ['add',  ...files]);

    if(!notag) {
      await passthru('git', ['commit', '-m', `v${target_version}`]); //, ...files
      await passthru('git', ['tag', `v${target_version}`]);
    }

    return target_version;
  }


  async gitify() {

    if(fs.existsSync(GIT_FOLDER))
      throw `Cowardly aborting working with existing git project`;

    await passthru("git", ["config", "--global", "core.askPass", path.join(__dirname, "bin/askpass")]);
    let {repository_url} = await this._find_repo();

    let cloneargs = ["clone", "--bare", repository_url, GIT_FOLDER];
    await passthru("git", cloneargs);

    await passthru("git", ["config", "--unset", "core.bare"]);
    await passthru("git", ["reset", "HEAD", "--", "."]);

    for(let line of [GITIGNORE_PATH, DOCKERIGNORE_PATH, NPMIGNORE_PATH])
      await passthru("git", ["checkout", "--", line]).catch(()=>{});

    let restore = [];
    if(fs.existsSync(DOCKERIGNORE_PATH)) {
      let ignore = fs.readFileSync(DOCKERIGNORE_PATH, 'utf8');
      restore.push(...ignore.split("\n"));
    }
    if(fs.existsSync(NPMIGNORE_PATH)) {
      let ignore = fs.readFileSync(NPMIGNORE_PATH, 'utf8');
      restore.push(...ignore.split("\n"));
    }
    restore =  restore.map(v => v.trim()).filter(v => v && v[0] != "#");

    for(let line of restore)
      await passthru("git", ["checkout", "--", line]).catch(()=>{});
  }


  // git config --global url."https://git.ivsdev.net/".insteadOf "git@git.ivsdev.net:"
  // yet, this is broader

  static _git_to_https(repository_url) {

    const SSH_MASK = new RegExp("^git@([^:]+):(.*)");
    if(SSH_MASK.test(repository_url))
      return repository_url.replace(SSH_MASK, "https://$1/$2");

    // git+ssh://git@github.com/131/ppackage.git
    const GIT_SSH_MASK = new RegExp("^git\\+ssh://git@([^/]+)/(.*)");
    if(GIT_SSH_MASK.test(repository_url))
      return repository_url.replace(GIT_SSH_MASK, "https://$1/$2");

    return repository_url;
  }

  async _find_repo() {
    let repository_url;

    if(fs.existsSync(NPM_PACKAGE_PATH)) {
      let body = JSON.parse(fs.readFileSync(NPM_PACKAGE_PATH));
      if(body.repository && body.repository.type == "git")
        repository_url = body.repository.url;
    }

    repository_url = ppackage._git_to_https(repository_url);
    return {repository_url};
  }


}


module.exports = ppackage;

