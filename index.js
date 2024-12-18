#!/usr/bin/env node
"use strict";

const fs   = require('fs');
const path = require('path');
const semver   = require('semver');
const {spawn} = require('child_process');


const {args} = require('nyks/process/parseArgs')();
const passthru = require('nyks/child_process/passthru');
const wait = require('nyks/child_process/wait');
const trim = require('mout/string/trim');
const unique = require('mout/array/unique');

const get = require('mout/object/get');
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

//https://developer.hashicorp.com/terraform/registry/providers/publishing
const TF_PROVIDER_PATH  = "terraform-registry-manifest.json";
const TF_PROVIDER_METADATA_VERSION = "metadata.version";
const TF_PROVIDER_METADATA_REPOSITORY = "metadata.repository";


let modes = {

  tf_provider    : {
    file    : TF_PROVIDER_PATH,
    analyze : function() {
      const body = fs.readFileSync(this.file, 'utf-8');
      this.meta = JSON.parse(body);
      let version = get(this.meta, TF_PROVIDER_METADATA_VERSION);
      let repository = get(this.meta, TF_PROVIDER_METADATA_REPOSITORY);
      return {version, repository};
    },

    commit : function({version, repository, files}) {
      if(version)
        set(this.meta, TF_PROVIDER_METADATA_VERSION, version);
      if(repository)
        set(this.meta, TF_PROVIDER_METADATA_REPOSITORY, {type : "git", url : repository});

      fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2) + "\n");
      files.push(this.file);
    }
  },

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

      fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2) + "\n");
      files.push(this.file);
    }
  },
  docker    : {
    file : 'Dockerfile',
    analyze : function () {
      const body = fs.readFileSync(this.file, 'utf-8');
      this.meta = Dockerfile.parse(body);
      let version = this.meta.labels[DOCKER_LABEL_VERSION];
      let repository = this.meta.labels[DOCKER_LABEL_REPOSITORY];
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

      fs.writeFileSync(this.file, JSON.stringify(this.meta, null, 2) + "\n");
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

    let target_repository = repository ||  args.shift() || current_repository;

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
    let repositories = [];

    let current_version;
    for(let [, mode] of Object.entries(modes)) {
      let line = mode.analyze.call(mode);
      if(line.version) current_version = line.version;
      repositories.push(line.repository);
    }

    if(unique(repositories).length != 1)
      throw `Inconsitant repository ${unique(repositories).join(',')} detected, use ppackage repository first`;


    let target_version = version || args.shift();
    await passthru("git", ["status"]);
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


  async gitify(branch = null) {

    if(!branch)
      branch = args.shift() || "master";

    if(fs.existsSync(GIT_FOLDER))
      throw `Cowardly aborting working with existing git project`;

    let {repository_url} = await this._find_repo();


    let cloneopts = ["--bare", "--config", `core.askPass=${path.join(__dirname, "bin/askpass")}`];
    await passthru("git", ["clone", ...cloneopts, repository_url, GIT_FOLDER]);

    await passthru("git", ["config", "--unset", "core.bare"]);
    await passthru("git", ["reset", branch]);
    await passthru("git", ["checkout", branch]);

    for(let line of [GITIGNORE_PATH, DOCKERIGNORE_PATH, NPMIGNORE_PATH])
      await passthru("git", ["checkout", "--", line]).catch(()=>{});


    let restore = [".git*", NPMRC_PATH];
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


//ensure module is called directly, i.e. not required
if(module.parent === null) {
  let cmd = args.shift();
  require('cnyks/lib/bundle')(ppackage, null, [`--ir://run=${cmd}`]); //start runner
}

module.exports = ppackage;

