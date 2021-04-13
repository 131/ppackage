"use strict";

const fs   = require('fs');
const semver   = require('semver');
const path = require('path');
const {spawn} = require('child_process');

const args = require('nyks/process/parseArgs')();
const passthru = require('nyks/child_process/passthru');
const wait = require('nyks/child_process/wait');

const Dockerfile = require('./lib/dockerfile');


class ddocker {

  async version(version = false, notag = false) {

    let dirty = await wait(spawn('git', ["diff", "--quiet"])).catch(err => true);
    if(dirty && !notag)
      throw "Working directory not clean, aborting";

    let target_version = version || args.args.shift();

    const LABEL_VERSION = "org.opencontainers.image.version";
    let body = this._read();
    let current = body.labels[LABEL_VERSION] || "0.0.0";

    if(!semver.valid(target_version))
      target_version = semver.inc(current, target_version);


    if(!target_version)
      throw `Invalid semver range`;

    body.setLabel(LABEL_VERSION, target_version);
    fs.writeFileSync('Dockerfile', body.toString());


    await passthru('git', ['add', 'Dockerfile']);
    if(!notag) {
      await passthru('git', ['commit', '-m', `v${target_version}`, 'Dockerfile']);
      await passthru('git', ['tag', `v${target_version}`]);
    }
    return target_version;
  }

  _read() {
    let body = fs.readFileSync('Dockerfile', 'utf8');
    let foo = Dockerfile.parse(body);
    return foo;
  }
}


module.exports = ddocker;

