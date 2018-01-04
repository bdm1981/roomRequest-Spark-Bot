const SparkWebSocket = require('ciscospark-websocket-events');
const moment = require('moment-timezone');
require('dotenv').config();

const CiscoSparkClient = require('node-sparkclient');
const spark = new CiscoSparkClient('Bearer '+process.env.BOTTOKEN);

// // api.ai setup
const apiaibotkit = require('api-ai-botkit');
const apiai = apiaibotkit(process.env.APIAI);

const Raven = require('raven');
Raven.config(process.env.DSN).install();

// RoomRequest modules
const gAuth = require('./module/authorize');
const gCmd = require('./module/gSuiteCommand');
const Manager = require('./module/manager');
const time = require('./module/timeNLP');
const privateAPI = require('./module/privateAPI');
const msg = require('./module/msg');

const accessToken = process.env.BOTTOKEN;
const PORT = process.env.PORT || 3090;

const webHookUrl =  "http://localhost:"+PORT+"/ciscospark/receive";

var sparkwebsocket = new SparkWebSocket(accessToken);
sparkwebsocket.connect(function(err){
   if (!err) {
     if(webHookUrl)
      sparkwebsocket.setWebHookURL(webHookUrl);
   }else {
      console.log("Error starting up websocket: "+err);
   }
});

////// Bot Kit //////
const Botkit = require('botkit');

var controller = Botkit.sparkbot({
    stats_optout: true,
    debug: true,
    log: true,
    public_address: "https://localhost",
    ciscospark_access_token: process.env.BOTTOKEN
});


var bot = controller.spawn({
});

controller.setupWebserver(PORT, function(err, webserver) {
  //setup incoming webhook handler
  webserver.post('/ciscospark/receive', function(req, res) {
    controller.handleWebhookPayload(req, res, bot);
  }); 
});

// array for handling the conversation state
var tracker = new Manager.Convo();

controller.hears('hello', 'direct_message,direct_mention', function(bot, message) {
  console.log(message);
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  //console.log(message);
  bot.reply(message, msg.instruct);
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});

controller.hears(['help', 'instructions', 'howto', 'faq'], 'direct_message,direct_mention', function(bot, message) {
  bot.reply(message, msg.instruct);
});

controller.hears(['support'], 'direct_message,direct_mention', function(bot, message) {
  spark.createMembership(process.env.SUPPORTSPACE, message.user, false, function(err, result){
    if(err){
      console.log(err);
    }else{
      console.log(result);
      bot.reply(message, msg.support);
    }
  });
});

controller.hears(['help', 'cancel', 'reset', 'restart'], 'direct_message,direct_mention', function(bot, message) {
  tracker.remove(message)
  .then(function(){
    bot.reply(message, msg.cancelled);
  })
  .catch(function(){
    bot.reply(message, msg.cancelled);
  });
});



controller.hears([/^\d+/g], ['direct_message', 'direct_mention'], function(bot, message) {
  console.log(message);
  apiai.process(message, bot);
});

controller.hears('.*', ['direct_message', 'direct_mention'], function(bot, message) {
  tracker.find(message)
  .then(function(dbConvo){
    if(!dbConvo){
      return tracker.add(message);
    }else{
      // check for stale db entries
      var now = moment();
      var timePassed = now.diff(moment(dbConvo.timestamp), 'minutes');
      //console.log(timePassed);
      if (timePassed > 2 ) {
        return tracker.remove(message)
        .then(function(){
          // create a fresh dbConvo if the old one was stale
          return tracker.add(message);
        })
      }
    }
  })
  .catch(function(err){
    console.error(err);
  })

  apiai.process(message, bot);
});

apiai.all(function(message, resp, bot){
  //console.log(resp.result);
});

apiai.action('lookup', function(message, resp, bot){
  var auth;
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  console.log('lookup action');

  if(resp.result.actionIncomplete){
    console.log('I need more info');
    var responseText = resp.result.fulfillment.speech;
    bot.reply(message, responseText);
    privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
  }else{
    tracker.update(message, {userRequest: resp.result.parameters})
    .then(function(){
      return gAuth();
    })
    .then(function(auth){
      auth = auth;
      return gCmd.findBuilding(auth, resp.result.parameters.location[0]);
    })
    .then(function(output){
      var rooms = output.items;

      return tracker.update(message, {
        rooms: rooms
        }
      );
    })
    .then(function(){
      // pull the current tracker details
      return tracker.find(message)
    })
    .then(function(dbConvo){
      // normalize time input for consumption by EWS.
      var dateString = time.input({apiai: resp, timezone: 'CST'});
      var rooms = dbConvo.rooms.map(room => {
        return { "id": room.resourceEmail };
      });
      // Generator the ewsArgs
      var freeBusy = {
        timeMin: dateString.start,
        timeMax: dateString.end,
        timeZone: 'CST',
        items: rooms
      }

      // add the ewsArgs to the dbConvo
      return tracker.update(message, {freeBusy: freeBusy});
    })
    .then(function(){
      return tracker.find(message)
      .then(function(dbConvo){
        // Send user a message that it is looking up avialable rooms
        var responseText = `One moment while I look for available rooms in **${dbConvo.rooms[0].buildingId.toUpperCase()}** office on **${dbConvo.freeBusy.timeMin} - ${dbConvo.freeBusy.timeMax}**  _(Local ${dbConvo.rooms[0].buildingId.toUpperCase()} Time)_.`
        
        bot.reply(message, responseText);
        return gCmd.freeBusy(auth, dbConvo);
      });
    })
    .then(function(result){
      bot.reply(message, result.responseText);
      privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
      return tracker.update(message, {potentialRooms: result.potentialRooms})
    })
    .catch(function(e){
      console.log(e);
    });

  }
})

apiai.action('selectRoom', function(message, resp, bot){
  tracker.find(message)
  .then(function(dbConvo){
    var index = (parseInt(resp.result.parameters.number)-1);
    var bookDetail = {
      requesterEmail: dbConvo.user, 
      roomEmail: dbConvo.potentialRooms[index].roomEmail, 
      subject: `${dbConvo.user}'s meeting`, 
      body: "", 
      startDateTime: dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime, 
      endDateTime: dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime,
      timezone: ewsCmd.tzId(dbConvo.buildingTZid)
    }
    return ewsCmd.bookRoom(bookDetail);
  })
  .then(function(){
    bot.reply(message, msg.success);
    return tracker.remove(message);
  })
  .catch(function(e){
    Raven.captureException(e);
    bot.reply(message, msg.error);
    return tracker.remove(message);
  })
  .catch(function(e){
    Raven.captureException(e);
    console.log(e);
  });
});
