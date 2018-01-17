var chrono = require('chrono-node');
var guessPMRefiner = new chrono.Refiner();
var moment = require('moment-timezone');

module.exports = {
  parse: function(intent){
    var parsedInfo = custom.parse(intent);
    console.log('parsed time: ', parsedInfo);
    var startDateTime = moment(parsedInfo[0].start.date());
    var endDateTime = null;

    if (parsedInfo[0].end) {
      endDateTime = moment(parsedInfo[0].end.date());
      console.log("End time passed in: ", endDateTime.format());
    } else {
      endDateTime = moment(startDateTime).add(1, 'h');
      console.log("Default End time used: ", endDateTime.format());
    }
    return {start: startDateTime.format(), end: endDateTime.format()};
  },

  input: function(params){
    // Build a dateTime object for use with Scheduling
    var timeInput = params.apiai.result.parameters.period;
    for(var i = 0; i < timeInput.length; i++){
      if(params.apiai.result.contexts[0].parameters['period.original'] === "now"){
        var inputTime = moment(timeInput[0].time, ['h:m:s a', 'H:m:s']);
        return this.parse(`${params.apiai.result.parameters.date} ${moment(inputTime).tz(params.timezone).format('h:m:s a')}`);

        // dateString.start = moment(dateString.start).utcOffset(dbConvo.offset).format();
      }else if(timeInput[i]['time-period']){
        return this.parse(`${params.apiai.result.parameters.date} ${timeInput[i]['time-period'].replace("/", " - ")}`);
      }else if(timeInput[i].time && timeInput.length > 1){
        return this.parse(`${params.apiai.result.parameters.date} ${timeInput[0].time} - ${timeInput[1].time}`);
      }else if(timeInput[i].time){
        return this.parse(`${params.apiai.result.parameters.date} ${timeInput[i].time}`);
      }
    }
  }
};

guessPMRefiner.refine = function(text, results, opt) {
    // If there is no AM/PM (meridiem) specified,
    //  let all time between 1:00 - 4:00 be PM (13.00 - 16.00)
    results.forEach(function (result) {
        if (!result.start.isCertain('meridiem')
            &&  result.start.get('hour') >= 1 && result.start.get('hour') < 6) {

            result.start.assign('meridiem', 1);
            result.start.assign('hour', result.start.get('hour') + 12);
        }
        if (result.end && !result.end.isCertain('meridiem')
            &&  result.end.get('hour') >= 1 && result.end.get('hour') < 6) {

            result.end.assign('meridiem', 1);
            result.end.assign('hour', result.end.get('hour') + 12);
        }
    });
    return results;
};
// Create a new custom Chrono. The initial pipeline 'option' can also be specified as
// - new chrono.Chrono(exports.options.strictOption())
// - new chrono.Chrono(exports.options.casualOption())
var custom = new chrono.Chrono();
custom.refiners.push(guessPMRefiner);
