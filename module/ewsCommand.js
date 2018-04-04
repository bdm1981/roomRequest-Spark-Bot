var EWS = require('node-ews');
var Promise = require('bluebird');
var moment = require('moment-timezone');
var fs = require('fs');
const logger = require("../utils/logger");
require('dotenv').config();

if(process.env.O365 > 0){
  // Office 365 Configuration
  var ewsConfig = {
    username: process.env.EWSUSER,
    password: process.env.EWSPASSWD,
    host: process.env.EWSHOST,  
    auth: 'basic'
  };

  var options = {};
}else{
  // exchange server connection info 
  var ewsConfig = {
    username: process.env.EWSUSER,
    password: process.env.EWSPASSWD,
    host: process.env.EWSHOST  
  };

  var options = {
  strictSSL: false
  };
}


process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

var ewsId;

fs.readFile('./tzEWSid.json', function (err, data) {
  if (err) {
    throw err; 
  }else{
    ewsId = JSON.parse(data);
    logger.debug('loaded EWS IDs:', ewsId.length);
  }
});
 
// initialize node-ews 
var ews = new EWS(ewsConfig, options);

if(process.env.O365){
  // Office 356
  var ewsSoapHeader = {
    't:RequestServerVersion': {
      attributes: {
        Version: "Exchange2013"
      }
    }
  };
}else{
  var ewsSoapHeader = {
    't:RequestServerVersion': {
      attributes: {
        Version: "Exchange2010_SP1"
      }
    }
  };
}

var ewsCmd = module.exports = {
  genArgs: function(params){
    var ewsArgs = {
      'TimeZone': {
        'attributes': {
          'xmlns': 'http://schemas.microsoft.com/exchange/services/2006/types'
        },
        'Bias': params.bias.toString(),
        'StandardTime': {
          'Bias': "0",
          'Time': '02:00:00',
          'DayOrder': "1",
          'Month': "10",
          'DayOfWeek': 'Sunday'
        },
        'DaylightTime': {
          'Bias': params.dstOffset.toString(),
          'Time': '02:00:00',
          'DayOrder': "2",
          'Month': "3",
          'DayOfWeek': 'Sunday'
        }
      },
      'MailboxDataArray': {
        'MailboxData': {
          'Email': {
            'Address': 'emailAddress'
          },
          'AttendeeType': 'Required',
          'ExcludeConflicts': 'false',
        }
      },
      'FreeBusyViewOptions': {
        'TimeWindow': {
          'StartTime': moment(params.startDateTime).tz(params.timezone).format('YYYY-MM-DDTHH:mm:ss'),
          'EndTime': moment(params.endDateTime).tz(params.timezone).format('YYYY-MM-DDTHH:mm:ss')
        },
        'MergedFreeBusyIntervalInMinutes': "30",
        'RequestedView': 'DetailedMerged'
      }
    };
    logger.debug('Generated EWSArgs: ', ewsArgs);
    return ewsArgs;
  },
    
  roomSearch: function(office){
    logger.debug("searching for : ", office);
    return new Promise(function(resolve, reject){
      var ewsFunction = 'ResolveNames';

      var ewsArgs = {
        'attributes': {
          'ReturnFullContactData': 'true'
        },
        'UnresolvedEntry': office
      };
      ews.run(ewsFunction, ewsArgs, ewsSoapHeader)
      .then(result => {
        resolve(result);
      })
      .catch(err => {
        resolve(err.stack);
      });
    });
  },
  bookRoom: function(bookDetail){
    logger.debug('bookdetail: ', bookDetail);
    var ewsArgs;
    return new Promise(function(resolve, reject){
      var ewsFunction = 'CreateItem';
      // updated SoapHeader to include impersonation
      var ewsSoapHeader = {
        't:RequestServerVersion': {
          attributes: {
            Version: "Exchange2010_SP1"
          }
        },
        't:ExchangeImpersonation': {
          't:ConnectingSID': {
            't:SmtpAddress': bookDetail.requesterEmail
          }
        },
        't:TimeZoneContext': {
          't:TimeZoneDefinition': {
            'attributes': {
              Id: bookDetail.timezone
            }
          }
        }
      };

      if (bookDetail.startDateTime && bookDetail.endDateTime) {
        ewsArgs = {
          "attributes" : {
            "SendMeetingInvitations" : "SendToAllAndSaveCopy"
          },
          "Items" : {
            "CalendarItem": {
              "Subject": bookDetail.subject,
              "Body" : {
                "attributes": {
                  "BodyType" : "Text"
                },
                "$value": bookDetail.body
              },
              "ReminderIsSet": true,
              "ReminderMinutesBeforeStart": 15,
              "Start": bookDetail.startDateTime,
              "End": bookDetail.endDateTime,
              "IsAllDayEvent": false,
              "LegacyFreeBusyStatus": "Busy",
              "Location": "@webex",
              "RequiredAttendees": {
                "Attendee":{
                  "Mailbox": {
                    "EmailAddress": bookDetail.requesterEmail
                  }
                },
                "Attendee": bookDetail.attendees
              }
            }
          }
        };
      }
      logger.debug('EWS Booking Arguments: ', ewsArgs)
      ews.run(ewsFunction, ewsArgs, ewsSoapHeader)
      .then(result => {
        //logger.debug(result);
        //logger.debug(result.response.statusCode);
        resolve(result);
      })
      .catch(err => {
        reject(err);
      });
    });
  },

  freeBusy: function(input){
    logger.debug('freeBusy input: ', input);

    var params = {};
    var ewsFunction = 'GetUserAvailability';

    params.ewsArgs = ewsCmd.genArgs({
      bias: input.sessionData.userOffset || (input.sessionData.buildingBias / 60 * -1),
      dstOffset: input.sessionData.userDstOffset * -1 || input.sessionData.buildingDstOffset * -1,
      startDateTime: input.sessionData.requestStart,
      endDateTime: input.sessionData.requestEnd,
      timezone: input.sessionData.userTimezone || input.sessionData.buildingTZid
    });

    params.ewsArgs.MailboxDataArray = {};

    params.ewsArgs.MailboxDataArray.MailboxData = input.MailboxDataArray;
    return ews.run(ewsFunction, params.ewsArgs, ewsSoapHeader)
  },

  formatFreeBusy: function(dbConvo, result){
    var roomArray = dbConvo.rooms;
    var freeBusyInfo = [];
    var responseText;
    var availability = [];

    // regex to filter out rooms that are available. "0" indicates its free "2" means its booked
    var re = new RegExp('^(0+)$');
    
    if(Array.isArray(result.FreeBusyResponseArray.FreeBusyResponse)){
      availability = result.FreeBusyResponseArray.FreeBusyResponse;
    }else{
      availability.push(result.FreeBusyResponseArray.FreeBusyResponse);
    }

    for(var i = 0; i < availability.length; i++){
      //if(re.test(availability[i].FreeBusyView.MergedFreeBusy) && availability[i].FreeBusyView.CalendarEventArray === undefined){
      if(re.test(availability[i].FreeBusyView.MergedFreeBusy)){
        logger.debug('is free ', roomArray[i].DisplayName+ ' ---- '+ availability[i].FreeBusyView.MergedFreeBusy);
        freeBusyInfo.push({roomName: roomArray[i].DisplayName, roomEmail: roomArray[i].EmailAddress, status: availability[i].FreeBusyView.MergedFreeBusy, video: roomArray[i].Video});
      }else{
        logger.debug('is NOT free ', roomArray[i].DisplayName);
      }
    }

    if (freeBusyInfo.length === 0) {
      responseText = `I found no rooms available in **${dbConvo.buildingId}** on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}** _(${dbConvo.userTimezone || dbConvo.buildingTZid} Time)_.`;
    }else{
      responseText = `I found ${freeBusyInfo.length} rooms available at this time. \n\n Enter the number of the room you would like to book.\n\n`;
      for (var i = 0; i < freeBusyInfo.length; i += 1) {
      //  responseText += '> '+ `${i+1}. ${freeBusyInfo[i].roomName.replace(/\(Private-Approval required\)|\(Proxy-Approval required\)|\(Public\)/, "")}`;
      responseText += '> '+ `${i+1}. ${freeBusyInfo[i].roomName}`;

        // include a video tag if the room has telepresence
        if(freeBusyInfo[i].video){
          responseText += ' (Video)\n';
        }else{
          responseText += '\n';
        }
      }
    }
    return {potentialRooms: freeBusyInfo, responseText: responseText};
  },

  // convert standard timezone into EWS timezone Id
  tzId: function(timezone){
    for(var i = 0; i < ewsId.length; i++){
      if(ewsId[i].timezone == timezone){
        //logger.debug(ewsId[i].EWStimezoneId);
        return ewsId[i].EWStimezoneId;
      }
    }
  },

  compileFreeBusy: function(mergedFreeBusyArray, sessionData){
    var compiledMap = [];
    var freeBusyMap = [];
    var offset = 30;
    if(!Array.isArray(mergedFreeBusyArray.FreeBusyResponseArray.FreeBusyResponse)){
      mergedFreeBusyArray = [mergedFreeBusyArray.FreeBusyResponseArray.FreeBusyResponse];
    }else{
      mergedFreeBusyArray = mergedFreeBusyArray.FreeBusyResponseArray.FreeBusyResponse;
    }
    mergedFreeBusyArray.forEach((freeBusy, index) => {
      var mergedFreeBusy = freeBusy.FreeBusyView.MergedFreeBusy;
      freeBusyMap = [];
      for(var i = 0; i < mergedFreeBusy.length; i++){
        var tempOffset = offset * i;

        if(mergedFreeBusy[i] == 0){
          freeBusyMap.push({index: i, status: mergedFreeBusy[i], free: true, time: moment(sessionData.requestStart).add(tempOffset, 'm').format(), name: sessionData.members[index].name, available: []});
        }else{
          freeBusyMap.push({index: i, status: mergedFreeBusy[i], free: false, time: moment(sessionData.requestStart).add(tempOffset, 'm').format(), name: sessionData.members[index].name, available: []});
        }
      }
      compiledMap.push(freeBusyMap);
    })

    return compiledMap;
  },

  filterFreeTime: function(fbArray){
    var freeStats = fbArray[0];
    var total = fbArray.length;

    fbArray.forEach(freeBusyMap => {
      for(var i = 0; i < freeBusyMap.length; i++){
        if(freeBusyMap[i].free == true && freeStats[i].free != false){
          freeStats[i].total = total;
          freeStats[i].free = true;
          freeStats[i].available.push(freeBusyMap[i].name);
          
          // track how many people are free at this time.
          if(freeStats[i].freeMembers >= 0){
            freeStats[i].freeMembers+= 1;
          }else{
            freeStats[i].freeMembers = 1;
          }

        }else{
          freeStats[i].total = total;
          freeStats[i].free = false;
          if(!freeStats[i].freeMembers || freeStats[i].freeMembers < 0){
            freeStats[i].freeMembers = 0;
          }
        }
      }
    });
    
    return freeStats;
  },

  formatFreeTime: function(sessionData){
    var responseText = '';
    var freeText = '';
    var partialText = '';
    var options = 1;

    if(Array.isArray(sessionData.freeBusyFiltered) && sessionData.freeBusyFiltered.length > 0){
      responseText += 'The following 30 minute slots are currently open on '+moment(sessionData.freeBusyFiltered[0].time).format("dddd, MMMM Do YYYY")+'.\n\n **NOTE:** time displayed in _('+sessionData.userTimezone+')_ Time\n\n';

      for(var i = 0; i < sessionData.freeBusyFiltered.length; i++){
        if(sessionData.freeBusyFiltered[i].free == true){
          sessionData.freeBusyFiltered[i].option = options;

          freeText += '> '+options+': '+moment(sessionData.freeBusyFiltered[i].time).tz(sessionData.userTimezone).format("h:mm a")+' - '+moment(sessionData.freeBusyFiltered[i].time).add(30, "m").tz(sessionData.userTimezone).format("h:mm a")+'<br>\n';

          options++;
        }
      }

      for(var i = 0; i < sessionData.freeBusyFiltered.length; i++){
        if(sessionData.freeBusyFiltered[i].free == false && sessionData.freeBusyFiltered[i].freeMembers > 0){
          var freePercent = Math.floor((sessionData.freeBusyFiltered[i].freeMembers / sessionData.freeBusyFiltered[i].total) * 100);
          if(freePercent >= 60){
            sessionData.freeBusyFiltered[i].option = options;

            partialText += `> ${options}: ${moment(sessionData.freeBusyFiltered[i].time).tz(sessionData.userTimezone).format("h:mm a")} - ${moment(sessionData.freeBusyFiltered[i].time).add(30, "m").tz(sessionData.userTimezone).format("h:mm a")} ${freePercent}% are free <br>\n`;
            partialText += `\-\-\-${sessionData.freeBusyFiltered[i].available} \n\n`;


            options++;
          }
        }
      }

      if(freeText == '' && partialText == ''){
        responseText = `You are all pretty busy, this time is not good. 😓`;
      }else if(freeText != '' && partialText != ''){
        responseText += 'Everyone is open on the following time slots: \n\n '+freeText+'\n';
        responseText += 'At least 60% of the room members are free at these times: \n\n  '+partialText+'\n';
        responseText += 'Select a time slot or a slot range (ie: 1 - 2) to schedule a meeting.\n\n';
      }else if(freeText != '' && partialText == ''){
        responseText += 'Everyone is open on the following time slots: \n\n '+freeText+'\n';
        responseText += 'Select a time slot or a slot range (ie: 1 - 2) to schedule a meeting.\n\n';
      }else if(freeText == '' && partialText != ''){
        responseText += '\n\n At least 60% of the room members are free at these times: \n\n '+partialText+'\n';
        responseText += 'Select a time slot or a slot range (ie: 1 - 2) to schedule a meeting.\n\n';
      }
    }

    logger.debug('freeText: ', freeText);
    logger.debug('partialText: ', partialText);

    return {text: responseText, data: sessionData.freeBusyFiltered};
  },

  // format the attendde list for EWS
  buildAttendeeList: function(list){
    var attendees = [];
    list.forEach(attendee => {
      attendees.push({
        "Mailbox": {
          "EmailAddress": attendee.email
        }
      })
    })

    return attendees;
  },

  // format booking detail Request
  buildBookingDetail: function(params){
    var external;
    var attendees = ewsCmd.buildAttendeeList(params.sessionData.members);

    if(params.sessionData.externalMembers && params.sessionData.externalMembers.length){
      external = ewsCmd.buildAttendeeList(params.sessionData.externalMembers);
      attendees = attendees.concat(external);
    }


    logger.debug('Final Attendees: ', attendees);

    var bookDetail = {
      requesterEmail: params.sessionData.user, 
      attendees: attendees,
      subject: `${params.sessionData.user}'s meeting`, 
      body: "", 
      startDateTime: params.sessionData.start, 
      endDateTime: params.sessionData.end,
      timezone: ewsCmd.tzId(params.sessionData.userTimezone || params.sessionData.buildingTZid)
    };
    return bookDetail;
  },

  buildMailboxArray: function(rooms){
    var MailboxDataArray = rooms.conferenceDetails.map(room => {
      return {
          Email: {
            Address: room.EmailAddress
          },
          AttendeeType: 'Required',
          ExcludeConflicts: true
        };
    });

    return MailboxDataArray;
  },

  createMailboxData: function(members){
    var MailboxDataArray = members.map(member => {
      return {
        Email: {
          Address: member.email
        },
        AttendeeType: 'Required',
        ExcludeConflicts: true
      }
    });
    return MailboxDataArray;
  }
};
