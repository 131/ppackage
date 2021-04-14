"use strict";

const fs   = require('fs');
const semver   = require('semver');
const path = require('path');


const args = require('nyks/process/parseArgs')();
const passthru  = require('nyks/child_process/passthru');
const escapeRegExp = require('mout/string/escapeRegExp');
const splitArgs = require('nyks/process/splitArgs');

const {tokenize} = require('./util');


const INSTRUCTION = /^\s*#\s+(.*?)\s*=(.*)\s*/;
const COMMENTS    = /^\s*#\s?(.*)/;
const VERBS       = /^\s*(\w+)\s*(.*)/;

class Dockerfile {
  static parse(body) {
    let lines = body.trim().split("\n");
    
    let out = new Dockerfile();

    let lookingForDirectives = true;

    var remainder = '';
    var remainder_raw = '';
    var lineRaw = "";

    for(let line of lines) {
      let multiline = new RegExp(`(.*)${escapeRegExp(out.escape)}\s*$`);

      if(lookingForDirectives && INSTRUCTION.test(line)) {
        let [, instruction, value] = INSTRUCTION.exec(line);
        if(instruction == "escape")
          out.escape = value;
        out.raw.push({
          instruction, value,
          toString : function() {
            return `# ${this.instruction}=${this.value}`;
          }
        });
        continue;
      }

      lookingForDirectives = false

      if(multiline.test(line)) {
        let raw = multiline.exec(line);
        remainder     += raw[1];
        remainder_raw += raw[0] + "\n";
        continue;
      } else {
        lineRaw =  remainder_raw + line ;
        line = remainder + line;
        remainder = "";
        remainder_raw = "";
      }

      let bloc = out.feedLine(line, lineRaw);
    }
    return out;
  }

  constructor() {
    this.escape = "\\";
    this.raw = [];
  }

  get labels() {
    let labels = {};
    for(let entry of this.raw) {
      if(entry.VERB == "LABEL")
        for(let k in entry.labels)
          Object.defineProperty(labels, k, {enumerable : true, value : entry.labels[k]});
    }

    Object.seal(labels);
    return labels;
  }


  feedLine(line, raw = undefined) {
    if(!raw)
      raw = line;

    let what = {
      raw,
      touched : false,

      toString : function() {
        return this.raw;
      }
    }; 

    if(COMMENTS.test(line)) {
      let [, value] = COMMENTS.exec(line);


      Object.defineProperties(what, {
        type : {value : "COMMENT"},
        _comment : {value, writable : true},
        comment : {
          get : function() {return this._comment },
          set : function(value) {
            this._comment = value;
            this.raw = `# ${this.comment}`;
          }
        }
      });
    }

    if(VERBS.test(line)) {
      let [, verb, payload] = VERBS.exec(line);

      Object.defineProperties(what, {
        type : {value : "VERB"},
        VERB : {value : verb},
        payload : {value : payload},
      });

      if(verb == "LABEL") {
        Object.defineProperties(what, {
          labels : {value : tokenize(payload) },
          toString : {value : function() {
            if(!this.touched)
              return this.raw; //preseve indent
            let out = `${this.VERB}`;
            for(let k in this.labels)
              out += ` ${JSON.stringify(k)}=${JSON.stringify(this.labels[k])}`;
            return out;
          }}
        });
      }
    }


    this.raw.push(what);
    return what;
  }

  setLabel(label, value) {
    //search for existing lavel
    let existing = this.raw.find(entry => (entry.VERB == "LABEL") && (label in entry.labels));
    if(existing) {
      existing.touched = true;
      existing.labels[label] = value;
    } else {
      this.feedLine(`LABEL ${JSON.stringify(label)}=${JSON.stringify(value)}`);
    }
  }

  toString() {
    let body = "";
    for(let line of this.raw)
      body += line.toString() + "\n";

    return body;
  }
}


module.exports = Dockerfile;

