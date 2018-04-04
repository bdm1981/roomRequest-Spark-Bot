const CiscoBuildings = require("./buildings");
const ewsCmd = require("./ewsCommand");
const logger = require("../utils/logger");
const tracker = require('./manager');
const moment = require('moment-timezone');
const Spark = require('./spark');
const time = require('./timeNLP');


module.exports = {
  areWeFree: function(params){
    logger.debug('inside are we free');
  

    // Extract time range from request
    var timezone = params.sessionData.userTimezone || params.sessionData.buildingTZid;
    var dateString = time.input({apiai: params.dialogflow, timezone: timezone});
    params.sessionData.requestStart = dateString.start;
    params.sessionData.requestEnd = dateString.end;

    // Who is in the space
    return Spark.members(params.message.channel)
    .then(result => {
      logger.debug('Member Search Results: ', result);
      // Store attendees in session object
      params.sessionData.members = result.members;
      params.sessionData.externalMembers = result.external;
    }).then(() => {
      logger.debug('before new free busy call');
      // Request Free Busy
      params.MailboxDataArray = ewsCmd.createMailboxData(params.sessionData.members);
      return ewsCmd.freeBusy(params);
    }).then((freeBusyRaw) => {
      logger.debug(freeBusyRaw);
      // Save raw free busy output
      params.sessionData.freeBusyRaw = freeBusyRaw.FreeBusyResponseArray.FreeBusyResponse;
      
      // compile freebusy
      params.sessionData.freeBusyCompiled = ewsCmd.compileFreeBusy(freeBusyRaw, params.sessionData);
      
      // Filter free busy
      params.sessionData.freeBusyFiltered = ewsCmd.filterFreeTime(params.sessionData.freeBusyCompiled);

      // format free busy for return message
      params.sessionData.freeBusyResponse = ewsCmd.formatFreeTime(params.sessionData);

      // update the freeBusyFiltered info to include the options value
      params.sessionData.freeBusyFiltered = params.sessionData.freeBusyResponse.data;

      // save all session data in the tracker
      return tracker.update(params.message, params.sessionData);
    }).then(() => {
      //logger.debug(sessionData);
      
      // send response to user
      return params.sessionData.freeBusyResponse;
    }).catch(err => {
      logger.error({sessionData: params.sessionData, error: err});
    })
  },

  bookSlot: function(params){
    // determine start and end times
    var time = parseSlots(params);
    params.sessionData.start = time.start.format();
    params.sessionData.end = time.end.format();

    // build booking detail
    var bookDetail = ewsCmd.buildBookingDetail(params);

    // send booking request
    return ewsCmd.bookRoom(bookDetail)
    .then(() => {
      return tracker.update(params.message, params.sessionData);
    });
  },

  bookPeopleRoom: function(params){
    logger.debug('members start: ', params.sessionData.members);
    var index = (parseInt(params.dialogflow.result.parameters.number)-1);
    var selectedRoom = {
      email: params.sessionData.potentialRooms[index].roomEmail,
      name: params.sessionData.potentialRooms[index].roomName
    };


    if(params.sessionData.members && params.sessionData.members.length > 0){
      params.sessionData.members.push(selectedRoom);
    }else{
      params.sessionData.members = [selectedRoom];
    }
    logger.debug('members after room add: ', params.sessionData.members);

    // build booking detail
    var bookDetail = ewsCmd.buildBookingDetail(params);
    logger.debug('Booking Detail', bookDetail);
    // send booking request
    return ewsCmd.bookRoom(bookDetail)
    .then(() => {
      return tracker.update(params.message, params.sessionData);
    });
  },

  roomLookup: function(params){
    // find Cisco Building
    CiscoBuildings.connect(process.env.DB);
    return new Promise(function(resolve, reject){
      params.sessionData.buildingId = params.dialogflow.result.parameters.location[0];
      CiscoBuildings.find(params.dialogflow.result.parameters.location[0])
      .then(buildings => {
        // Build a list of rooms 
        params.sessionData.rooms = buildings[0].conferenceDetails;
        params.MailboxDataArray = ewsCmd.buildMailboxArray(buildings[0]);
        
        logger.debug('Room Lookup Dialogflow input: ', params.dialogflow);

        if(params.dialogflow.result.action == 'lookup'){
          params.sessionData.start = params.sessionData.requestStart;
          params.sessionData.end = params.sessionData.requestEnd;
        }else{
          // determine start and end times
          var time = parseSlots(params);
          params.sessionData.start = time.start.format();
          params.sessionData.end = time.end.format();;
        }

        params.sessionData.buildingTZid = buildings[0].timeZoneId;
        params.sessionData.buildingBias = (buildings[0].utcOffset / 60 * -1);
        params.sessionData.buildingDstOffset = buildings[0].dstOffset;

      })
      .then(() => {
        // check freebusy
        return ewsCmd.freeBusy(params);
      }).then(result => {
          return ewsCmd.formatFreeBusy(params.sessionData, result);
      }).then(freebusy => {
        params.sessionData.potentialRooms = freebusy.potentialRooms;
        params.responseText = freebusy.responseText
        return tracker.update(params.message, params.sessionData);
      }).then(() => {
        resolve(params);
      }).catch(err => {
        logger.error(err);
        reject(err);
      });
    })  
  },

  roomLookupPrep: function(params){
    return new Promise(function(resolve, reject){
      // Extract time range from request
      var timezone = params.sessionData.userTimezone || params.sessionData.buildingTZid;
      var dateString = time.input({apiai: params.dialogflow, timezone: timezone});
      logger.debug('roomLookupPrep: ', dateString);
      params.sessionData.requestStart = dateString.start;
      params.sessionData.requestEnd = dateString.end;

      params.responseText = `One moment while I look for available rooms in **${params.dialogflow.result.parameters.location[0].toUpperCase()}** office on **${moment(dateString.start).tz(timezone).format("MM/DD, h:mm a")} - ${moment(dateString.end).tz(timezone).format("h:mm a")}**  _(${params.sessionData.userTimezone || params.sessionData.buildingTZid} Time)_.`
      resolve(params);
    });
  }
}


function parseSlots(input){
  var slotInput = input.dialogflow.result.contexts[0].parameters;
  var slotStart = slotInput['slot-start'];
  slotStart = parseInt(slotStart.replace('-', ''));
  var slotEnd = slotInput['slot-end'];
  slotEnd = parseInt(slotEnd.replace('-', ''));
  var start, end;
  
  var startObject = input.sessionData.freeBusyFiltered.filter(match => match.option == slotStart);
  start = moment(startObject[0].time);
  if(isNaN(slotEnd)){
    end = moment(startObject[0].time).add(30, 'm');
  }else{
    var endObject = input.sessionData.freeBusyFiltered.filter(match => match.option == slotEnd);
    end = moment(endObject[0].time).add(30, 'm');
  }

  return {start: start, end: end};
}
