var Promise = require('bluebird');
var mongojs = require('mongojs');
const logger = require("../utils/logger");
var moment = require('moment-timezone');

// Heroku Addon Case - use mongo connection string
if(process.env.MONGODB_URI){
  process.env.DB = process.env.MONGODB_URI
}

var db = mongojs(process.env.DB, ['convoState']);
const userdb = mongojs(process.env.DB, [process.env.PREFSCOLLECTION]);

var tracker = module.exports = {
  // determine if a conversation already exists
  find: function(message){
    return new Promise(function(resolve, reject){
      db.convoState.findOne({channel : message.channel}, function (err, doc) {
        if(err){
          reject(err);
        }else{
          resolve(doc);
        }
      });
    });
  },
  
  // Add a new convo
  add: function(message){
    return new Promise(function(resolve, reject){
      userdb[process.env.PREFSCOLLECTION].findOne({user: message.user}, function(err, userPrefs){
        if(err){
          reject(err);
        }else{
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
            userRequest: null
          };
          
          if(userPrefs){
            var offsets = determineOffset(userPrefs.timezone);
            detail.userTimezone = userPrefs.timezone;
            detail.userOffset = offsets.userOffset;
            detail.userDstOffset = offsets.userDstOffset
          };
          
          logger.debug(detail);

          db.convoState.insert(detail, function(err, doc) {
            if(err){
              reject(err);
            }else{
              resolve(doc);
            }
        })
        }
      })
    });
  },

  // add the details gathered from the room request
  update: function(message, input){
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
  },

  // refresh convo
  validate: function(message){
    return new Promise(function(resolve, reject){
      tracker.find(message)
      .then(dbConvo => {
        if(!dbConvo){
          return tracker.add(message);
        }else{
          // check for stale db entries
          var now = moment();
          var timePassed = now.diff(moment(dbConvo.timestamp), 'minutes');
          if (timePassed > 2 ) {
            tracker.remove(message)
            .then(function(){
              // create a fresh dbConvo if the old one was stale
              return tracker.add(message)
            })
          }
        }
      })
      .then(dbConvo => {
        logger.debug('Validate dbConvo: ', dbConvo);
        resolve(dbConvo);
      })
      .catch(err => {
        reject(err);
      })
    });
  },
  
  // remove completed convo
  remove: function(message){
    return new Promise(function(resolve, reject){
      db.convoState.remove({channel: message.channel}, function(err, doc){
        if(err){
          reject(err);
        }else{
          resolve(doc);
        }
      })
    });
  },

  // Check to see if the timezone has been set
  tzCheck: function(dbConvo){
    if(!dbConvo.userTimezone){
      return false;
    }else{
      return true;
    }
  }
}

function determineOffset(timezone){
  var ts = Math.round((new Date()).getTime() / 1000);
  var min = moment.tz.zone(timezone).utcOffset(1403465838805);
  var max = moment.tz.zone(timezone).utcOffset(1388563200000);
  var dstOffset = max - min;
  var currentOffset = moment.tz.zone(timezone).utcOffset(ts);

  return {userOffset: currentOffset, userDstOffset: dstOffset};
}
