"use strict";

const fs   = require('fs');
const path = require('path');
const semver   = require('semver');
const {spawn} = require('child_process');

const args = require('nyks/process/parseArgs')();
const passthru = require('nyks/child_process/passthru');
const wait = require('nyks/child_process/wait');
const trim = require('mout/string/trim');
const set = require('mout/object/set');
const drain = require('nyks/stream/drain');

const Dockerfile     = require('./lib/dockerfile');
const {git_to_https} = require('./lib/util');

const {Parser, Composer} = require('yaml');



const GIT_FOLDER = ".git";
const NPM_PACKAGE_PATH = 'package.json';
const DOCKERIGNORE_PATH = ".dockerignore";
const NPMIGNORE_PATH    = ".npmignore";
const NPMRC_PATH        = ".npmrc"; //default ignored by npm
const GITIGNORE_PATH    = ".gitignore";
const COMPOSER_PATH     = "composer.json";



const laxParser = function(body) {
  const tokens = new Parser().parse(body);
  const docs = new Composer({merge : true, uniqueKeys : false}).compose(tokens);
  return docs.next().value;
};



const DOCKER_LABEL_VERSION    = "org.opencontainers.image.version";
const DOCKER_LABEL_REPOSITORY = "org.opencontainers.image.source";

const GITLAB_PATH_VERSION     = ".version";
const GITLAB_PATH_REPOSITORY  = ".repository";

let modes = {
  gitlab    : {
    file    : '.gitlab-ci.yml',
    analyze : function() {
      const body = fs.readFileSync(this.file, 'utf-8');
      this.meta = laxParser(body);
      let version = this.meta.get(GITLAB_PATH_VERSION);
      let repository = this.meta.get(GITLAB_PATH_REPOSITORY);
      return {version, repository};
    },

    commit : function({version, repository, files}) {
      let opts = {lineWidth : 0};
      if(version)
        this.meta.set(GITLAB_PATH_VERSION, version);
      if(repository)
        this.meta.set(GITLAB_PATH_REPOSITORY, repository);

      fs.writeFileSync(this.file, this.meta.toString(opts));
      files.push(this.file);
    }

  },
  composer  : {
    file : 'composer.json',
    analyze : function() {
      const body = fs.readFileSync(this.file, 'utf-8');
      this.meta = JSON.parse(body);
      let {version, extra :  { repository : { url : repository} } = {repository : {}}} = this.meta;
      return {version, repository};
    },
    commit : function({version, repository, files}) {
      if(version)
        this.meta.version =  version;
      if(repository)
        set(this.meta, "extra.repository", {type : "git", url : repository});

      fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2));
      files.push(this.file);
    }
  },
  docker    : {
    file : 'Dockerfile',
    analyze : function () {
      const body = fs.readFileSync(this.file, 'utf-8');
      this.meta = Dockerfile.parse(body);
      let {DOCKER_LABEL_VERSION : version, DOCKER_LABEL_REPOSITORY : repository}  = this.meta.labels;
      return {version, repository};
    },
    commit : function({version, repository, files}) {
      if(version)
        this.meta.setLabel(DOCKER_LABEL_VERSION, version);
      if(repository)
        this.meta.setLabel(DOCKER_LABEL_REPOSITORY, repository);
      fs.writeFileSync(this.file, this.meta.toString());
      files.push(this.file);
    }
  },

  npm       : {
    file : 'package.json',
    analyze : function () {
      const body = fs.readFileSync(this.file, 'utf-8');
      this.meta = JSON.parse(body);
      let {version, repository : { url : repository} = {}} = this.meta;
      return {version, repository};
    },
    commit : function({version, repository, files}) {
      if(version)
        this.meta.version =  version;
      if(repository)
        this.meta.repository = {type : "git", url : repository};

      fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2));
      files.push(this.file);
    }

  }
};

for(let [mode_n, mode] of Object.entries(modes)) {
  if(!fs.existsSync(mode.file))
    delete modes[mode_n];
}

class ppackage {


  async repository(repository = false) {

    let current_repository;

    try {
      let child = spawn('git', ['config', '--get', 'remote.origin.url']);
      current_repository = String(await drain(child.stdout)).trim();
    } catch(err) {} //best effort


    for(let [, mode] of Object.entries(modes)) {
      let line = mode.analyze.call(mode);
      if(line.repository) current_repository = line.repository;
    }

    let target_repository = repository ||  args.args.shift() || current_repository;

    if(!target_repository)
      throw `Invalid repository url`;


    let files = [];
    for(let [, mode] of Object.entries(modes))
      mode.commit.call(mode, {files, repository : target_repository});

    await passthru('git', ['add',  ...files]);
    await passthru('git', ['commit', '-m', `Uniform repository declaration`]);

    return target_repository;
  }

  async version(version = false, notag = false) {

    let current_repository, inconsistant_repo = false;

    let current_version;
    for(let [, mode] of Object.entries(modes)) {
      let line = mode.analyze.call(mode);
      if(line.version) current_version = line.version;
      if(!current_repository)
        current_repository = line.repository;

      inconsistant_repo |= line.repository != current_repository;
    }

    if(inconsistant_repo)
      throw `Inconsitant repository detected, use ppackage repository first`;


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
      mode.commit.call(mode, {version : target_version, files});

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

    let {repository_url} = await this._find_repo();


    let cloneopts = ["--bare", "--config", `core.askPass=${path.join(__dirname, "bin/askpass")}`];
    await passthru("git", ["clone", ...cloneopts, repository_url, GIT_FOLDER]);

    await passthru("git", ["config", "--unset", "core.bare"]);
    await passthru("git", ["reset", "HEAD", "--", "."]);

    for(let line of [GITIGNORE_PATH, DOCKERIGNORE_PATH, NPMIGNORE_PATH, NPMRC_PATH])
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
    restore =  restore.map(v => trim(v.trim(), '/')).filter(v => v && v[0] != "#");

    for(let line of restore)
      await passthru("git", ["checkout", "--", line]).catch(()=>{});
  }


  // git config --global url."https://git.ivsdev.net/".insteadOf "git@git.ivsdev.net:"
  // yet, this is broader


  async _find_repo() {
    let repository_url;

    if(fs.existsSync(NPM_PACKAGE_PATH)) {
      let body = JSON.parse(fs.readFileSync(NPM_PACKAGE_PATH));
      if(body.repository && body.repository.type == "git")
        repository_url = body.repository.url;
    }

    if(fs.existsSync(COMPOSER_PATH)) {
      let body = JSON.parse(fs.readFileSync(COMPOSER_PATH));
      if(body.extra && body.extra.repository && body.extra.repository.type == "git")
        repository_url = body.extra.repository.url;
    }


    repository_url = git_to_https(repository_url);
    return {repository_url};
  }


}


module.exports = ppackage;

