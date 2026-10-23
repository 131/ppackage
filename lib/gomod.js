"use strict";

// The module directive is an interpolation of {repository, major}:
//   module <host>/<path>[/vN]   (N >= 2, https://go.dev/ref/mod#major-version-suffixes)
// The version marker is a `// version: X.Y.Z` comment line.

const {repository_path} = require('./util');

const MODULE_MASK = /^module[ \t]+(\S+)[ \t]*$/m;
const MAJOR_SUFFIX_MASK = /\/v([2-9]\d*)$/;
const VERSION_MASK = /^\/\/[ \t]*version[ \t]*:[ \t]*(\S+)[ \t]*$/m;

const parse = function(body) {
  const match = MODULE_MASK.exec(body);
  if(!match)
    throw `Invalid go.mod: no module directive`;
  const module_path = match[1];
  const suffix = MAJOR_SUFFIX_MASK.exec(module_path);
  const major = suffix ? Number(suffix[1]) : null; // null: v0 or v1
  const repository_path = module_path.replace(MAJOR_SUFFIX_MASK, "");
  const version = (VERSION_MASK.exec(body) || [])[1];
  return {module_path, major, version, repository_path};
};

const module_path = function(repository_url, major) {
  const base = repository_path(repository_url);
  return major >= 2 ? `${base}/v${major}` : base;
};

const set_module = function(body, repository_url, major) {
  return body.replace(MODULE_MASK, `module ${module_path(repository_url, major)}`);
};

// Replace the marker, or insert it after the module directive
const set_version = function(body, version) {
  const line = `// version: ${version}`;
  if(VERSION_MASK.test(body))
    return body.replace(VERSION_MASK, line);
  return body.replace(MODULE_MASK, (directive) => `${directive}\n\n${line}`);
};

module.exports = {parse, set_module, set_version, module_path};
