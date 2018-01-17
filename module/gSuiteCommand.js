const moment = require('moment-timezone');
const google = require('googleapis');
require('dotenv').config();
const gAuth = require('./authorize');
const time = require('./timeNLP');
const Manager = require('./manager');
const service = google.admin('directory_v1');
const calendar = google.calendar('v3');

// array for handling the conversation state
var tracker = new Manager.Convo();

var gCmd = module.exports = {
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
    bookRoom: function(auth, bookDetail){
      console.log('bookdetail: ', bookDetail);
      return new Promise(function(resolve, reject){
        calendar.events.insert({
          auth: auth,
          calendarId: bookDetail.calendarId,
          sendNotifications: true,
          resource: bookDetail
        }, function(err, response){
          if(err){
            reject(err);
          }else{
            resolve(response);
          }
        })
      });
    },
    freeBusy: function(auth, dbConvo){
      var body = dbConvo.freeBusy;
      return new Promise(function(resolve, reject){
        calendar.freebusy.query({auth: auth, resource: body }, function(err, response){
          if(err){
            reject(err);
          }else{
            resolve(response);
          }
        });
      })
    },
    formatFreeBusy: function(dbConvo, result){
      console.log(dbConvo);
      
      var roomArray = dbConvo.rooms;
      var freeBusyInfo = [];
      var responseText;
      var availability = [];

      // pull free conference rooms from the freebusy response.
      for(var key in result.calendars){
        if(!result.calendars[key].busy.length){
          availability.push(key);
        }
      }

      availability.forEach(resourceEmail => {
        dbConvo.rooms.forEach(room => {
          if(room.resourceEmail === resourceEmail){
            freeBusyInfo.push(room);
          }
        });
      });
      

      if (freeBusyInfo.length === 0) {
        responseText = `I found no rooms available in **${dbConvo.rooms[0].buildingId.toUpperCase()}** on **${moment(dbConvo.freeBusy.timeMin).format("MM/DD, h:mm a")} - ${moment(dbConvo.freeBusy.timeMax).format("h:mm a")}** _(Local ${dbConvo.rooms[0].buildingId.toUpperCase()} Time)_.`;
      }else{
        responseText = `I found ${freeBusyInfo.length} rooms available in ** on **${moment(dbConvo.freeBusy.timeMin).format("MM/DD, h:mm a")} - ${moment(dbConvo.freeBusy.timeMax).format("h:mm a")}** _(Local ${dbConvo.rooms[0].buildingId.toUpperCase()} Time)_. Enter the number of the room you would like to book.\n\n`;
        for (var i = 0; i < freeBusyInfo.length; i += 1) {
        //  responseText += '> '+ `${i+1}. ${freeBusyInfo[i].roomName.replace(/\(Private-Approval required\)|\(Proxy-Approval required\)|\(Public\)/, "")}`;
        responseText += '> '+ `${i+1}. ${freeBusyInfo[i].generatedResourceName}`;

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
    processLookup: function(input, bot){
      var authStore;
      var convo = input;

      return new Promise(function(resolve, reject){
        gAuth.auth().then(auth => {
          authStore = auth
          // Lookup the building information
          return gCmd.findBuilding(auth, convo.userRequest.result.parameters.location[0]);
        })
        .then(output => {
          // Save a list of the associated rooms
          convo.rooms = output.items;

          // Format the time
          var dateString = time.input({apiai: convo.userRequest, timezone: convo.rooms[0].timeZone});
          var rooms = convo.rooms.map(room => {
            return { "id": room.resourceEmail };
          });
          
          // save to the local convo object
          convo.freeBusy = {
            timeMin: dateString.start,
            timeMax: dateString.end,
            timeZone: rooms[0].timeZone,
            items: rooms
          }
          
          var responseText = `One moment while I look for available rooms in **${convo.rooms[0].buildingId.toUpperCase()}** office on **${moment(convo.freeBusy.timeMin).format('MM/DD')} ${moment(convo.freeBusy.timeMin).format('hh:mm')} - ${moment(convo.freeBusy.timeMax).format('hh:mm')}**  _(Local ${convo.rooms[0].buildingId.toUpperCase()} Time)_.`
          
          bot.reply(convo.message, responseText);

          // pull the freebusy information
          return gCmd.freeBusy(authStore, convo);
        })
        .then(result => {
          // format the info
          return gCmd.formatFreeBusy(convo, result);
        })
        .then(result => {
          convo.potentialRooms = result.potentialRooms;
          tracker.update(convo.message, {
            freeBusy: convo.freeBusy,
            rooms: convo.rooms,
            userRequest: convo.userRequest.result.parameters,
            potentialRooms: convo.potentialRooms
          });
          resolve({result: result, convo: convo});
        })
      });
      
    }
};
