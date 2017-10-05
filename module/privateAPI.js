var request = require('request');

var privateAPI = (function _privateAPI(){

  function atob(a) {
      return new Buffer(a, 'base64').toString('binary');
  }

  function startTyping(token, convoId){
    var decodedData = atob(convoId);
    convoId = decodedData.split("/");
    
    return request({
      method: 'POST',
      url: 'https://conv-a.wbx2.com/conversation/api/v1/status/typing',
      json: {conversationId: convoId[4], eventType: "status.start_typing"},
      headers: {
        'Content-Type': "application/json", 
        'Authorization': "Bearer "+ token
      }
    });
  }

  function stopTyping(token, convoId){
    var decodedData = atob(convoId);
    convoId = decodedData.split("/");

    return request({
      method: 'POST',
      url: 'https://conv-a.wbx2.com/conversation/api/v1/status/typing',
      json: {conversationId: convoId[4], eventType: "status.stop_typing"},
      headers: {
        'Content-Type': "application/json", 
        'Authorization': "Bearer "+ token
      }
    });
  }

  var access = {
    startTyping: startTyping,
    stopTyping: stopTyping
  };

  return access;
})();

module.exports = privateAPI;
