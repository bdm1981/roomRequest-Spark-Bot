var mongojs = require('mongojs');
var Promise = require('bluebird');
require('dotenv').config();

// Heroku Addon Case - use mongo connection string
if(process.env.MONGODB_URI){
  process.env.DB = process.env.MONGODB_URI
}

module.exports = {
  connect: function() {
    this.db = mongojs(process.env.DB, [process.env.PREFSCOLLECTION]);
    this.db.on('error', function (err) {
      console.log('database error', err);
    });

    this.db.on('connect', function () {
      console.log('database connected')
    });
  },
  db:null,

  find: function(user) {
    var that = this;

    return new Promise(function(resolve, reject){
      try {
        that.db[process.env.PREFSCOLLECTION].find({ user: user }, function(err, docs){
          if(!err){
            resolve(docs);
          }
        });
      }
      catch (e){
        reject(e);
      }
    });
  },

  update: function(params) {
    var that = this;
    return new Promise(function(resolve, reject){
      that.db[process.env.PREFSCOLLECTION].findAndModify({
        query: { user: params.user},
        update: { $set: params.set },
        new: true
      }, function(err, doc){
        if(err){
          reject(err);
        }else{
          resolve(doc);
        }
      })
    })
  },

  create: function(params) {
    var that = this;
    return new Promise(function(resolve, reject){
      that.db[process.env.PREFSCOLLECTION].insert(params, function(err, doc){
        if(err){
          reject(err);
        }else{
          resolve(doc);
        }
      })
    })
  },
}
