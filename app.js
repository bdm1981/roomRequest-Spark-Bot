const SparkWebSocket = require('ciscospark-websocket-events');
const logger = require("./utils/logger");
require('dotenv').config();

const CiscoSparkClient = require('node-sparkclient');
const spark = new CiscoSparkClient(process.env.BOTTOKEN);

// // api.ai setup
const apiaibotkit = require('api-ai-botkit');
const apiai = apiaibotkit(process.env.APIAI);

const Raven = require('raven');
Raven.config(process.env.DSN).install();

const tracker = require('./module/manager');


// RoomRequest modules
const ewsAction = require('./module/ewsBotActions');
const privateAPI = require('./module/privateAPI');
const tz = require('./module/timezone');
const msg = require('./module/msg');
const user = require('./module/userPrefs');


const accessToken = process.env.BOTTOKEN;
const PORT = process.env.PORT || 3090;

const webHookUrl =  "http://localhost:"+PORT+"/ciscospark/receive";

var sparkwebsocket = new SparkWebSocket(accessToken);
sparkwebsocket.connect(function(err){
   if (!err) {
     if(webHookUrl)
      sparkwebsocket.setWebHookURL(webHookUrl);
   }else {
      logger.debug("Error starting up websocket: "+err);
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


var bot = controller.spawn({ });

controller.setupWebserver(PORT, function(err, webserver) {
  //setup incoming webhook handler
  webserver.post('/ciscospark/receive', function(req, res) {
    controller.handleWebhookPayload(req, res, bot);
    res.sendStatus(200);
  }); 
});

controller.hears('hello', 'direct_message,direct_mention', function(bot, message) {
  logger.debug(message.user + ' - ' + message.text);
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);

  bot.reply(message, msg.instruct);
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});

controller.hears(['help', 'instructions', 'howto', 'faq'], 'direct_message,direct_mention', function(bot, message) {
  bot.reply(message, msg.instruct);
});

controller.hears(['support'], 'direct_message,direct_mention', function(bot, message) {
  spark.createMembership(process.env.SUPPORTSPACE, message.user, false, function(err, result){
    if(err){
      logger.debug(err);
    }else{
      logger.debug(message.user + ' - ' + message.text);
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
  apiai.process(message, bot);
});

controller.hears(['timezone'], ['direct_message', 'direct_mention'], function(bot, message) {
  apiai.process(message, bot);
});

controller.hears('.*', ['direct_message', 'direct_mention'], function(bot, message) {
  tracker.validate(message)
  .then(()=>{
    apiai.process(message, bot);
  })
  .catch(function(err){
    logger.error(err);
  })
});

apiai.action('when', function(message, resp, bot){
  logger.debug('when action');
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  tracker.find(message)
  .then(sessionData => {
    if(!sessionData.userTimezone){
      logger.debug('no timezone');
      bot.reply(message, msg.setTimezone);
      privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
    }else if(resp.result.actionIncomplete){
      logger.debug('I need more info');
      var responseText = resp.result.fulfillment.speech;
      bot.reply(message, responseText);
    }else{
      ewsAction.areWeFree({message: message, dialogflow: resp, sessionData: sessionData})
      .then(responseText => {
        logger.debug('response text: ', responseText);
        bot.reply(message, responseText);
        privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
      })
    }
  })
});

apiai.action('selectSlot', function(message, resp, bot){
  bot.reply(message, msg.includeRoom);
});

apiai.action('includeRoom', function(message, resp, bot){
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  if(resp.result.contexts[0].parameters.Confirmation == 'no'){
    logger.debug('slot selection: ', resp);
    tracker.find(message)
    .then(function(sessionData){
      return ewsAction.bookSlot({message: message, sessionData: sessionData, dialogflow: resp})
    }).then(() => {
      bot.reply(message, msg.inviteSuccess);
    })
  }else{
    bot.reply(message, msg.whichBuilding);
  }
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});

apiai.action('roomAdded', function(message, resp, bot){
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  tracker.find(message)
  .then(function(sessionData){
    return ewsAction.roomLookup({message: message, sessionData: sessionData, dialogflow: resp});
  }).then(result => {
    bot.reply(message, result.responseText);
  });
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});

apiai.action('peopleRoomSelected', function(message, resp, bot){
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  tracker.find(message)
  .then(function(sessionData){
    return ewsAction.roomLookup({message: message, sessionData: sessionData, dialogflow: resp});
  }).then(result => {
    bot.reply(message, result.responseText);
  });
  privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
});


apiai.action('lookup', function(message, resp, bot){
  privateAPI.startTyping(process.env.BOTTOKEN, message.channel);
  logger.debug('lookup action');
  
  if(resp.result.actionIncomplete){
    logger.debug('I need more info');
    logger.debug('current info: ', resp)
    bot.reply(message, resp.result.fulfillment.speech);
  }else{
    tracker.find(message)
    .then(sessionData => {
      if(tracker.tzCheck(sessionData)){
        ewsAction.roomLookupPrep({message: message, sessionData: sessionData, dialogflow: resp})
        .then(result => {
          bot.reply(message, result.responseText);
          return ewsAction.roomLookup(result);
        }).then(result => {
          bot.reply(message, result.responseText);
        })
      }else{
        bot.reply(message, msg.setTimezone);
      }
    }).catch(err => {
      logger.debug('err: ', err);
    })
    privateAPI.stopTyping(process.env.BOTTOKEN, message.channel);
  }
})

apiai.action('selectRoom', function(message, resp, bot){
  logger.debug(message.user + ' selected option: ' + resp.result.parameters.number);
  if(parseInt(resp.result.parameters.number) <= 0){
    bot.reply(message, 'That selection is invalid. Please try again.');
  }else{
    tracker.find(message)
    .then(function(sessionData){
      return ewsAction.bookPeopleRoom({message: message, sessionData: sessionData, dialogflow: resp})
    }).then(function(){
      bot.reply(message, msg.success);
      return tracker.remove(message);
    })
    .catch(function(e){
      Raven.captureException(e);
      logger.debug(e);
      bot.reply(message, msg.error);
      return tracker.remove(message);
    });
  }
});

apiai.action('timezone', function(message, resp, bot){
  var newTZ;
  logger.debug(resp);
  tz.get({city: resp.result.parameters['geo-city']})
  .then(timezone => {
    newTZ = timezone;
    return user.connect();
  })
  .then(() => {
    return user.find(message.user);
  })
  .then(response => {
    logger.debug('user search: ', response);
    if(!response.length){
      logger.debug('creating a new user');
      return user.create({user: message.user, timezone: newTZ.timeZoneId});
    }else{
      logger.debug('updating an existing user');
      return user.update({user: message.user, set: { timezone: newTZ.timeZoneId, } });
    }
  })
  .then(() => {
    return tracker.remove(message);
  })
  .then(() => {
    bot.reply(message, 'Your timezone has been set to: '+newTZ.timeZoneId);
  })
})
