const SparkWebSocket = require('ciscospark-websocket-events');
const moment = require('moment-timezone');
const fetch = require('node-fetch');
require('dotenv').config();

const CiscoSparkClient = require('node-sparkclient');
const spark = new CiscoSparkClient('Bearer '+process.env.BOTTOKEN);

// // api.ai setup
const apiaibotkit = require('api-ai-botkit');
const apiai = apiaibotkit(process.env.APIAI);

const Raven = require('raven');
Raven.config(process.env.DSN).install();

// RoomRequest modules
const CiscoBuildings = require("./module/buildings");
const ewsCmd = require("./module/ewsCommand");
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
  console.log(message.user + ' - ' + message.text);
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  //console.log(message);
  bot.reply(message, msg.instruct);
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});

controller.hears(['help', 'instructions', 'howto', 'faq'], 'direct_message,direct_mention', function(bot, message) {
  bot.reply(message, msg.instruct);
});

controller.hears(['who'], 'direct_mention', function(bot, message){
  members({roomId: message.channel})
  .then(function(members){
    console.log('members: ', members);
  });
})

controller.hears(['support'], 'direct_message,direct_mention', function(bot, message) {
  spark.createMembership(process.env.SUPPORTSPACE, message.user, false, function(err, result){
    if(err){
      console.log(err);
    }else{
      console.log(message.user + ' - ' + message.text);
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
  console.log(message);
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
      
      MailboxDataArray = buildings[0].conferenceDetails.map(room => {
        return {
            Email: {
              Address: room.EmailAddress
            },
            AttendeeType: 'Required',
            ExcludeConflicts: true
          };
      });

      return tracker.update(message, {
        buildingId: output[0].buildingId, 
        buildingTZid: output[0].timeZoneId, 
        rooms: output[0].conferenceDetails,
        offset: output[0].offset
        }
      );
    })
    .then(function(){
      // pull the current tracker details
      return tracker.find(message);
    })
    .then(function(dbConvo){
      // normalize time input for consumption by EWS.
      var dateString = time.input({apiai: resp, timezone: dbConvo.buildingTZid});
      
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
        var responseText = `One moment while I look for available rooms in **${dbConvo.buildingId.toUpperCase()}** office on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}**  _(Local ${dbConvo.buildingId.toUpperCase()} Time)_.`
        
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
  console.log(message.user + ' selected option: ' + resp.result.parameters.number);
  if(parseInt(resp.result.parameters.number) <= 0){
    bot.reply(message, 'That selection is invalid. Please try again.');
  }else{
    tracker.find(message)
    .then(function(dbConvo){
      var index = (parseInt(resp.result.parameters.number)-1);
      return buildBookingDetail(dbConvo, index);
    }).then(function(bookDetail){
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
    });
  }
});

function members(roomId){
  return fetch('https://api.ciscospark.com/v1/memberships?roomId='+roomId, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer '+process.env.BOTTOKEN }
  }).then(res => res.json())
  .then(json => {
    var members = [];
    json.items.forEach(user => {
      var re = new RegExp('^.*@sparkbot.io$');
      if(!user.isMonitor && !re.test(user.personEmail)){
        members.push(user.personEmail);
      }
    })
    return members;
  })
}

// format the attendde list for EWS
function buildAttendeeList(list){
  var attendees = [];
  list.forEach(attendee => {
    attendees.push({
      "Mailbox": {
        "EmailAddress": attendee
      }
    })
  })

  return attendees;
}

function buildBookingDetail(dbConvo, index){
  var list = [];
  return new Promise(function(resolve, reject){
    if(dbConvo.messages[0].roomType === 'group'){
      members(dbConvo.channel).then(result => {
        list = result;
        list.push(dbConvo.potentialRooms[index].roomEmail);
      }).then(() => {
        var attendees = buildAttendeeList(list);
        
        var bookDetail = {
          requesterEmail: dbConvo.user, 
          attendees: attendees,
          subject: `${dbConvo.user}'s meeting`, 
          body: "", 
          startDateTime: dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime, 
          endDateTime: dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime,
          timezone: ewsCmd.tzId(dbConvo.buildingTZid)
        };

        resolve(bookDetail);
      })
    }else{
      var attendees = buildAttendeeList([dbConvo.potentialRooms[index].roomEmail]);
      var bookDetail = {
        requesterEmail: dbConvo.user, 
        attendees: attendees,
        subject: `${dbConvo.user}'s meeting`, 
        body: "", 
        startDateTime: dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime, 
        endDateTime: dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime,
        timezone: ewsCmd.tzId(dbConvo.buildingTZid)
      };

      resolve(bookDetail);
    }
  })
}
