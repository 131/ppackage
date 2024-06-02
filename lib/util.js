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


module.exports = {tokenize, git_to_https};

