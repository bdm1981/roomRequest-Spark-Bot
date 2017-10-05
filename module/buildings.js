var mongojs = require('mongojs');
var Promise = require('bluebird');
require('dotenv').config();

// Heroku Addon Case - use mongo connection string
if(process.env.MONGODB_URI){
  process.env.DB = process.env.MONGODB_URI
}

module.exports = {

  connect: function() {
    this.db = mongojs(process.env.DB, [process.env.COLLECTION]);
    this.db.on('error', function (err) {
      console.log('database error', err);
    });

    this.db.on('connect', function () {
      console.log('database connected')
    });
  },
  db:null,

  find: function(buildingId) {
    var that = this;
    var buildingRegex = new RegExp('^'+buildingId+'$', 'i');
    return new Promise(function(resolve, reject){
      try {
        that.db[process.env.COLLECTION].find({ buildingId: { $regex: buildingRegex, $options: "i" } }, function(err, docs){
          if(!err && docs.length){
            // replace the conferenceDetails with rooms that have addresses
            docs[0].conferenceDetails = that.filterRooms(docs[0].conferenceDetails);
          }
          resolve(docs);

        });
      }
      catch (e){
        reject(e);
      }
    });
  },

  findByName: function(buildingName,callback) {
    var words = buildingName.split(' ');

    var buildingRegex = new RegExp('^'+words[0], 'i');
    try {
      this.db.buildings.find({ $or: [ { buildingName: { $regex: buildingRegex, $options: "i" } },  { buildingId: { $regex: buildingRegex, $options: "i" } }] }, callback);
    }
    catch (e){
      callback(e);
    }
  },

  // returns an array of bookable rooms
  filterRooms: function(rooms){
    var roomsArray = [];
    for(var i in rooms){
      // regex to filter out rooms marked as private
      var re = new RegExp(/PRIVATE/);
      var privateRoom = re.test(rooms[i].proxyStatus);

      if(rooms[i].EmailAddress && !privateRoom){
        roomsArray.push({
          'EmailAddress': rooms[i].EmailAddress, 
          'DisplayName': rooms[i].schedname, 
          'Video': this.videoCheck(rooms[i])});
      }
    }
    return roomsArray;
  },

  // update: function(update, callback){
  //   try{
  //     this.db.buildings.update({_id: update._id}, {$set: {timezoneId: update.timezoneId, timezoneName: update.timezoneName}}, callback);
  //   }
  //   catch (e)
  //   {
  //     callback(e);
  //   }
  // },

  // updateDST: function(update, callback){
  //   try{
  //     console.log(update);
  //     this.db.buildings.update({buildingId: update.buildingId}, {$set: {dstOffset: update.dstOffset}}, callback);
  //   }
  //   catch (e)
  //   {
  //     callback(e);
  //   }
  // },

  videoCheck: function(roomInfo){
    if(roomInfo.tpscreen || roomInfo.tpScreenNumber || roomInfo.videoConferencing == "Y"){
      return true;
    }else{
      return false;
    }
  }

};
