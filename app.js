var SparkWebSocket = require('ciscospark-websocket-events');
var moment = require('moment-timezone');
require('dotenv').config();

var CiscoSparkClient = require('node-sparkclient');
var spark = new CiscoSparkClient('Bearer '+process.env.BOTTOKEN);

// // api.ai setup
const apiaibotkit = require('api-ai-botkit');
const apiai = apiaibotkit(process.env.APIAI);

var Raven = require('raven');
Raven.config(process.env.DSN).install();

// RoomRequest modules
var CiscoBuildings = require("./module/buildings");
var ewsCmd = require("./module/ewsCommand");
var Manager = require('./module/manager');
var time = require('./module/timeNLP');
var privateAPI = require('./privateAPI');


var accessToken = process.env.BOTTOKEN;
var PORT = process.env.PORT || 3090;

var webHookUrl =  "http://localhost:"+PORT+"/ciscospark/receive";

var sparkwebsocket = new SparkWebSocket(accessToken);
sparkwebsocket.connect(function(err,res){
   if (!err) {
     if(webHookUrl)
      sparkwebsocket.setWebHookURL(webHookUrl);
   }else {
      console.log("Error starting up websocket: "+err);
   }
});

////// Bot Kit //////
var Botkit = require('botkit');

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
  bot.reply(message, 'Hi,\n\n '+instruct);
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});

// messages sent by the bot in response to the user's requests. These can be updated to match your deployment

var msg = {
  instruct: `
  **I\'m the RoomRequest Bot!**  I can help you find and book rooms in your offices!\n\n 
  * To be guided through the process Type: **book a room**, to get started.\n\n
  * Once you a familiar with the commands you can Type: **book a room at CHG5 tomorrow from 1 to 4**.\n\n 
  * You will need to know the building ID you want to book a room at. If you don't know it, [click here](http://www.exmple.com/buildings.html)\n\n 
  * type: **stop** or **cancel** at any time to cancel a request.\n\n 
  * type **support** to join a Spark space to ask questions about this bot\n\n * [click here](https://www.example.com/videodemo.mp4) to watch a quick demo video of roomRequest`,
  cancelled: `You current request has been cancelled.`,
  success: `Great! Your room is now booked and you should receive a calendar invite shortly!`,
  error: `Sorry, we ran into an issue booking the room!  This is usually caused by an unknown timezone for your region. Please type _support_ to join our spark room. Let us know what building you are trying to book a room at and we can fix it.`,
  support: `You have been added to the Room Request Spark space.`
}

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
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  console.log('lookup action');
  var buildings;
  var MailboxDataArray = [];

  if(resp.result.actionIncomplete){
    console.log('I need more info');
    var responseText = resp.result.fulfillment.speech;
    bot.reply(message, responseText);
    privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
  }else{
    tracker.update(message, {userRequest: resp.result.parameters})
    .then(function(){
      CiscoBuildings.connect(process.env.DB);
      return CiscoBuildings.find(resp.result.parameters.location[0])
    })
    .then(function(output){
      buildings = output;
      
      for(var i = 0; i < buildings[0].conferenceDetails.length; i++){
        var MailboxData = {};
        MailboxData.Email = {};
        MailboxData.Email.Address = buildings[0].conferenceDetails[i].EmailAddress;
        MailboxData.AttendeeType = 'Required';
        MailboxData.ExcludeConflicts = true;
        MailboxDataArray.push(MailboxData);
      };
      
      //store building info with the current convo
      return tracker.update(message, {buildingId: output[0].buildingId, buildingTZid: output[0].timeZoneId, rooms: output[0].conferenceDetails});
    })
    .then(function(){
      // Build a dateTime object for use with Scheduling
      var timeInput = resp.result.parameters.period;
      var dateString;
      for(var i = 0; i < timeInput.length; i++){
        if(timeInput[i]['time-period']){
          dateString = time.parse(`${resp.result.parameters.date} ${timeInput[i]['time-period'].replace("/", " - ")}`);
          break;
        }else if(timeInput[i].time && timeInput.length > 1){
          dateString = time.parse(`${resp.result.parameters.date} ${timeInput[0].time} - ${timeInput[1].time}`);
          break;
        }else if(timeInput[i].time){
          dateString = time.parse(`${resp.result.parameters.date} ${timeInput[i].time}`);
          break;
        }
      }
      
      // Generator the ewsArgs
      var ewsArgs = ewsCmd.genArgs({
        bias: (buildings[0].offset / 60 * -1),
        dstOffset: buildings[0].dstOffset,
        startDateTime: dateString.start,
        endDateTime: dateString.end
      });
      
      // add the ewsArgs to the dbConvo
      return tracker.update(message, {ewsArgs: ewsArgs});
    })
    .then(function(){
      return tracker.find(message)
      .then(function(dbConvo){
        // Send user a message that it is looking up avialable rooms
        var responseText = `One moment while I look for available rooms in **${dbConvo.buildingId.toUpperCase()}** office on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}**.`
        
        bot.reply(message, responseText);
        return ewsCmd.freeBusy(MailboxDataArray, dbConvo);
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
  .then(function(result){
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
