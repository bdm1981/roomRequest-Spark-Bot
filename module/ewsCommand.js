var EWS = require('node-ews');
var Promise = require('bluebird');
var moment = require('moment-timezone');
var fs = require('fs');
require('dotenv').config();

// exchange server connection info 
// var ewsConfig = {
//   username: process.env.EWSUSER,
//   password: process.env.EWSPASSWD,
//   host: process.env.EWSHOST  
// };

// var options = {
//  strictSSL: false
// };

// Office 365 Configuration
var ewsConfig = {
  username: process.env.EWSUSER,
  password: process.env.EWSPASSWD,
  host: process.env.EWSHOST,  
  auth: 'basic'
};

var options = {

};

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

var ewsId;

fs.readFile('./tzEWSid.json', function (err, data) {
  if (err) {
    throw err; 
  }else{
    ewsId = JSON.parse(data);
    console.log('loaded EWS IDs:', ewsId.length);
  }
});
 
// initialize node-ews 
var ews = new EWS(ewsConfig, options);

// Exchange onPrem
// var ewsSoapHeader = {
//   't:RequestServerVersion': {
//     attributes: {
//       Version: "Exchange2010_SP1"
//     }
//   }
// };

// Office 356
var ewsSoapHeader = {
  't:RequestServerVersion': {
    attributes: {
      Version: "Exchange2013"
    }
  }
};

module.exports = {
    genArgs: function(params){
      var ewsArgs = {
        'TimeZone': {
          'attributes': {
            'xmlns': 'http://schemas.microsoft.com/exchange/services/2006/types'
          },
          'Bias': params.bias,
          //'Bias': bias,
          'StandardTime': {
            'Bias': "0",
            'Time': '02:00:00',
            'DayOrder': "5",
            'Month': "10",
            'DayOfWeek': 'Sunday'
          },
          'DaylightTime': {
            'Bias': params.dstOffset,
            'Time': '02:00:00',
            'DayOrder': "1",
            'Month': "4",
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
            'StartTime': params.startDateTime.format('YYYY-MM-DDTHH:mm:ss'),
            'EndTime': params.endDateTime.format('YYYY-MM-DDTHH:mm:ss')
          },
          'MergedFreeBusyIntervalInMinutes': "30",
          'RequestedView': 'DetailedMerged'
        }
      };

      return ewsArgs;
    },
    roomSearch: function(office){
      console.log("searching for : ", office);
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
      console.log('bookdetail: ', bookDetail);
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
                  "Attendee": {
                    "Mailbox": {
                      "EmailAddress": bookDetail.roomEmail
                    }
                  }
                }
              }
            }
          };
        }
        ews.run(ewsFunction, ewsArgs, ewsSoapHeader)
        .then(result => {
          //console.log(result);
          //console.log(result.response.statusCode);
          resolve(result);
        })
        .catch(err => {
          reject(err);
        });
      });
    },
    freeBusy: function(mailboxData, dbConvo){
      var that = this;
      var ewsFunction = 'GetUserAvailability';

      dbConvo.ewsArgs.MailboxDataArray.MailboxData = mailboxData;
      return ews.run(ewsFunction, dbConvo.ewsArgs, ewsSoapHeader)
      .then(function(result){
        return that.formatFreeBusy(dbConvo, result);
      });
    },
    formatFreeBusy: function(dbConvo, result){
      var roomArray = dbConvo.rooms;
      var freeBusyInfo = [];
      var responseText;
      var availability = [];

      // regex to filter out rooms that are available. "0" indicates its free "2" means its booked
      var re = new RegExp('^(0+)$', "g");
      
      if(Array.isArray(result.FreeBusyResponseArray.FreeBusyResponse)){
        availability = result.FreeBusyResponseArray.FreeBusyResponse;
      }else{
        availability.push(result.FreeBusyResponseArray.FreeBusyResponse);
      }

      for(var i = 0; i < availability.length; i++){
        if(re.test(availability[i].FreeBusyView.MergedFreeBusy) && availability[i].FreeBusyView.CalendarEventArray === undefined){
          freeBusyInfo.push({roomName: roomArray[i].DisplayName, roomEmail: roomArray[i].EmailAddress, status: availability[i].FreeBusyView.MergedFreeBusy, video: roomArray[i].Video});
        }
      }

      if (freeBusyInfo.length === 0) {
        responseText = `I found no rooms available in **${dbConvo.buildingId}** on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}**.`;
      }else{
        responseText = `I found ${freeBusyInfo.length} rooms available in **${dbConvo.buildingId}** on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}**. Enter the number of the room you would like to book.\n\n`;
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
    dstOffset: function(timezone, standard, requestDate){
      var zone = moment.tz.zone(timezone);
      var offset = zone.parse(moment(requestDate));
      // console.log('timezone: ', timezone);
      // console.log('Default offset', standard);
      // console.log('Requested offset', offset);
      if(standard == offset){
        return 0;
      }else{
        offset = -Math.abs(standard - offset);
        return offset;

      }
    },
    // convert standard timezone into EWS timezone Id
    tzId: function(timezone){
      for(var i = 0; i < ewsId.length; i++){
        if(ewsId[i].timezone == timezone){
          //console.log(ewsId[i].EWStimezoneId);
          return ewsId[i].EWStimezoneId;
        }
      }
    }
};
