var Promise = require('bluebird');
var mongojs = require('mongojs');
var moment = require('moment-timezone');

// Heroku Addon Case - use mongo connection string
if(process.env.MONGODB_URI){
  process.env.DB = process.env.MONGODB_URI
}

var db = mongojs(process.env.DB, ['convoState']);

module.exports = {
  Convo: function(){
    // determine if a conversation already exists
    this.find = function(message){
      return new Promise(function(resolve, reject){
        db.convoState.findOne({channel : message.channel}, function (err, doc) {
          if(err){
            reject(err);
          }else{
            resolve(doc);
          }
        });
      });
    };
    
    // Add a new convo
    this.add = function(message){
      return new Promise(function(resolve, reject){
        var detail = {
          user: message.user,
          channel: message.channel,
          created: message.original_message.created,
          messages: [message.original_message],
          buildingId: [], // array of building IDs
          rooms: [], // array containing buildingID and array of rooms
          status: 'pending',
          potentialRooms: [],
          ewsArgs: null,
          userRequest: null,
          userTimezone: null,
          userOffset: null,
          userDstOffset: null
        };
        
        db.convoState.insert(detail, function(err, doc) {
          if(err){
            reject(err);
          }else{
            resolve(doc);
          }
        });
      });
    };

    // add the details gathered from the room request
    this.update = function(message, input){
      return new Promise(function(resolve, reject){
        var now = moment().toISOString();
        input.timestamp = now;
        db.convoState.update({channel : message.channel}, {$set: input}, function (err, doc) {
          if (err) {
            reject(err);
          }else{
            resolve(doc);
          }
        });
      });
    };
    
    // remove completed convo
    this.remove = function(message){
      return new Promise(function(resolve, reject){
        db.convoState.remove({channel: message.channel}, function(err, doc){
          if(err){
            reject(err);
          }else{
            resolve(doc);
          }
        })
      });
    };
  }
};
