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

controller.hears([/code:\s(.*)/g], 'direct_message,direct_mention', function(bot, message){
  var re = /code:\s(.*)/;
  var code = message.match[0].match(re);

  gAuth.botCode(code[1]).then(() => {
    bot.reply(message, `RoomRequest has been authorized!.`);
  }).catch(err => {
    bot.reply(message, `Oops, we ran into an error: ${err}`);
  })
});

controller.hears(['help', 'instructions', 'howto', 'faq'], 'direct_message,direct_mention', function(bot, message) {
  bot.reply(message, msg.instruct);
});

controller.hears(['setup'], 'direct_message,direct_mention', function(bot, message) {
  gAuth.botSetup().then(authUrl => {
    bot.reply(message, `[Click Here](${authUrl}) to Authorize this app.`);
  });
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

controller.hears(['cancel', 'reset', 'restart'], 'direct_message,direct_mention', function(bot, message) {
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

  if(resp.result.actionIncomplete){
    console.log('I need more info');
    var responseText = resp.result.fulfillment.speech;
    bot.reply(message, responseText);
    privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
  }else{
    tracker.update(message, {userRequest: resp.result.parameters})
    .then(function(){
      return gCmd.processLookup({message: message, userRequest: resp}, bot);
    })
    .then(function(result){
      bot.reply(message, result.result.responseText);
      privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
    });
  }
})

apiai.action('selectRoom', function(message, resp, bot){
  console.log('select room');
  tracker.find(message)
  .then(function(dbConvo){
    console.log(dbConvo);
    var index = (parseInt(resp.result.parameters.number)-1);
    var bookDetail = {
      attendees: [{email: dbConvo.user}], 
      calendarId: dbConvo.potentialRooms[index].resourceEmail, 
      summary: `${dbConvo.user}'s meeting`,
      location: '@webex', 
      start: { 
        dateTime: dbConvo.freeBusy.timeMin
      },
      end: {
        dateTime: dbConvo.freeBusy.timeMax
      } ,
    }
    return gAuth.auth()
    .then(function(auth){
      return gCmd.bookRoom(auth, bookDetail);
    });
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
});
