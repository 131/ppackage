"use strict";


const mask = "(\\s+=)|(=)|([^\\s\\\"'=]+)|\\\"([^\\\"]*)\\\"|'([^']*)'";

const tokenize = function(str) {
  var r = new RegExp(mask, "g");
  var step, sep, value, eql;
  let dict = {};
  let k;

  while((step = r.exec(str || ""))) {
    sep   = step[1] !== undefined;
    value = step[3] || step[4] || step[5] || "";
    eql = step[2] !== undefined;

    if(sep || eql)
      continue;
    if(!k) {
      k = value;
    } else {
      dict[k] = value;
      k = false;
    }
  }

  return dict;

};

const git_to_https = function(repository_url) {
  const GIT_PREFIX = new RegExp("^git\\+");
  if(GIT_PREFIX.test(repository_url))
    repository_url = repository_url.replace(GIT_PREFIX, "");


  if(process.env.SSH_AUTH_SOCK)
    return repository_url;

  const SSH_MASK = new RegExp("^git@([^:]+):(.*)");
  if(SSH_MASK.test(repository_url))
    return repository_url.replace(SSH_MASK, "https://$1/$2");

  // git+ssh://git@github.com/131/ppackage.git
  const GIT_SSH_MASK = new RegExp("^ssh://git@([^/]+)/(.*)");
  if(GIT_SSH_MASK.test(repository_url))
    return repository_url.replace(GIT_SSH_MASK, "https://$1/$2");

  return repository_url;
};


// Any git url => {repository_path : "host/path", repository_protocol : "git@" | "ssh://git@" | "git+https://" | ... | null}
// (git@github.com:131/vvauth.git, ssh://git@github.com/131/vvauth.git, https://github.com/131/vvauth, github.com/131/vvauth)
const PROTOCOL_MASK = /^(?:git\+)?(?:[a-z]+:\/\/(?:[^@/]+@)?|[a-z]+@)/;

const parse_repository = function(repository_url) {
  if(!repository_url)
    return {repository_path : undefined, repository_protocol : null};

  let url = String(repository_url), repository_protocol = null;
  let match = PROTOCOL_MASK.exec(url);
  if(match) {
    repository_protocol = match[0];
    url = url.slice(repository_protocol.length);
    if(!repository_protocol.includes("://")) // scp-like git@host:path
      url = url.replace(':', '/');
  }
  let repository_path = url.replace(/\.git$/, "").replace(/\/+$/, "");
  return {repository_path, repository_protocol};
};

const format_repository = function(repository_path, repository_protocol) {
  if(!repository_protocol)
    repository_protocol = "git@"; // git style
  if(!repository_protocol.includes("://")) // scp-like git@host:path
    repository_path = repository_path.replace('/', ':');
  return `${repository_protocol}${repository_path}.git`;
};

const repository_path = (repository_url) => parse_repository(repository_url).repository_path;

module.exports = {tokenize, git_to_https, parse_repository, format_repository, repository_path};

