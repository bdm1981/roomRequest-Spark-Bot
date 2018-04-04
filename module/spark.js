const fetch = require('node-fetch');
require('dotenv').config();

module.exports = {
  members: function(roomId){
    return fetch('https://api.ciscospark.com/v1/memberships?roomId='+roomId, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+process.env.BOTTOKEN }
    }).then(res => res.json())
    .then(json => {
      var members = [];
      var external = [];
      json.items.forEach(user => {
        var re = new RegExp('^.*@sparkbot.io$');
        var domainRE = new RegExp('^.*@'+process.env.DOMAIN+'$');
        if(!user.isMonitor && !re.test(user.personEmail) && domainRE.test(user.personEmail)){
          members.push({email: user.personEmail, name: user.personDisplayName});
        }
        if(!user.isMonitor && !re.test(user.personEmail) && !domainRE.test(user.personEmail)){
          external.push({email: user.personEmail, name: user.personDisplayName});
        }
      })

      return {members: members, external: external};
    })
  }
};
