"use strict";

const fs   = require('fs');
const semver   = require('semver');
const path = require('path');
const {spawn} = require('child_process');

const args = require('nyks/process/parseArgs')();
const passthru = require('nyks/child_process/passthru');
const wait = require('nyks/child_process/wait');

const Dockerfile = require('./lib/dockerfile');


class ppackage {

  async version(version = false, notag = false) {
    let current_version;

    let modes = {
      composer  : { enabled : fs.existsSync('composer.json') },
      docker    : { enabled : fs.existsSync('Dockerfile') },
      npm       : { enabled : fs.existsSync('package.json') },
    };

    const DOCKER_LABEL_VERSION = "org.opencontainers.image.version";

    let target_version = version || args.args.shift();

    let dirty = await wait(spawn('git', ["diff", "--quiet"])).catch(err => true);

    if(dirty && !notag)
      throw "Working directory not clean, aborting";

    if(modes.composer.enabled) {
      let body = fs.readFileSync('composer.json', 'utf-8');
      modes.composer.meta = JSON.parse(body);
      current_version = modes.composer.meta.version;
    }

    if(modes.npm.enabled) {
      let body = fs.readFileSync('package.json', 'utf-8');
      modes.npm.meta = JSON.parse(body);
      current_version = modes.npm.meta.version;
    }

    if(modes.docker.enabled) {
      let body = fs.readFileSync('Dockerfile', 'utf8');
      modes.docker.meta = Dockerfile.parse(body);
      current_version = modes.docker.meta[DOCKER_LABEL_VERSION];
    }

    if(!current_version)
      current_version =  "0.0.0";

    if(!semver.valid(target_version))
      target_version = semver.inc(current_version, target_version);

    if(!target_version)
      throw `Invalid semver range`;

    let files = [];
    if(modes.docker.enabled) {
      modes.docker.meta.setLabel(DOCKER_LABEL_VERSION, target_version);
      fs.writeFileSync('Dockerfile', modes.docker.meta.toString());
      files.push('Dockerfile');
    }

    if(modes.composer.enabled) {
      modes.composer.meta.version =  target_version;
      fs.writeFileSync('composer.json', JSON.stringify(modes.composer.meta, null, 2));
      files.push('composer.json');
    }

    if(modes.npm.enabled) {
      modes.npm.meta.version =  target_version;
      fs.writeFileSync('package.json', JSON.stringify(modes.npm.meta, null, 2));
      files.push('package.json');
    }

    if(!notag) {
      await passthru('git', ['commit', '-m', `v${target_version}`, ...files]);
      await passthru('git', ['tag', `v${target_version}`]);
    }

    return target_version;
  }

}


module.exports = ppackage;

