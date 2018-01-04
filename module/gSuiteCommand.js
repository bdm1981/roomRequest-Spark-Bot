const moment = require('moment-timezone');
const google = require('googleapis');
require('dotenv').config();

const service = google.admin('directory_v1');
const calendar = google.calendar('v3');

module.exports = {
    findBuilding: function(auth, buildingId){
      return new Promise(function(resolve, reject){
        service.resources.calendars.list({
          auth: auth,
          customer: 'my_customer',
          query: `buildingId=${buildingId}`
        }, function(err, building){
          if(err){
            console.error('The API returned an error: ' + err);
            reject(err);
          }else{
            resolve(building);
          }
        })
      });
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
      
    },
    freeBusy: function(auth, dbConvo){
      var body = dbConvo.freeBusy;
      body.auth = auth;
      calendar.freebusy.query(body, function(response){
        console.log(response);
      })
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
        responseText = `I found no rooms available in **${dbConvo.buildingId}** on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}** _(Local ${dbConvo.buildingId.toUpperCase()} Time)_.`;
      }else{
        responseText = `I found ${freeBusyInfo.length} rooms available in ** on **${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.StartTime).format("MM/DD, h:mm a")} - ${moment(dbConvo.ewsArgs.FreeBusyViewOptions.TimeWindow.EndTime).format("h:mm a")}** _(Local ${dbConvo.buildingId.toUpperCase()} Time)_. Enter the number of the room you would like to book.\n\n`;
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
    }
};
