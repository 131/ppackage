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


module.exports = {tokenize};

