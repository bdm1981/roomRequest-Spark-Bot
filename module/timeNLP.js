var chrono = require('chrono-node');
var guessPMRefiner = new chrono.Refiner();
const logger = require("../utils/logger");
var moment = require('moment-timezone');

module.exports = {
  parse: function(intent, timezone){
    var parsedInfo = custom.parse(intent);
    logger.debug('parse input timezone: ', timezone);
    logger.debug('parsed intent', intent);
    parsedInfo[0].start.assign('timezoneOffset', 0);
    var rawParsedStartTime = parsedInfo[0].start.date().toISOString();
    rawParsedStartTime = rawParsedStartTime.slice(0, -1);
    var startDateTime = moment.tz(rawParsedStartTime, timezone).format();
    var endDateTime = null;

    if (parsedInfo[0].end) {
      logger.debug('end time: ', parsedInfo[0]);
      var rawParsedEndTime = parsedInfo[0].end.date().toISOString();
      rawParsedEndTime = rawParsedEndTime.slice(0, -1);
      endDateTime = moment.tz(rawParsedEndTime, timezone).format();
    } else {
      endDateTime = moment.tz(rawParsedStartTime, timezone).add(1, 'h').format();
    }
    return {start: startDateTime, end: endDateTime};
  },

  input: function(params){
    // Build a dateTime object for use with Scheduling
    logger.debug('input time params: ', params);
    var timeInput = params.apiai.result.parameters.period;

    if(params.apiai.result.contexts[0].parameters['period.original'] === "now"){
      var now = moment().tz('UTC');
      logger.debug('TIME NLP:  Parsing with the NOW keyword');
      return this.parse(`${params.apiai.result.parameters.date} ${now.format('h:m:s a')}`);
    }else if(
        params.apiai.result.parameters.date && 
        params.apiai.result.parameters.period.length == 0

      ){
        logger.debug('TIME NLP:  Parsing with a date keyword');
        return this.parse(`${params.apiai.result.contexts[0].parameters['date']} 08:00:00 - 17:00:00`, params.timezone);
    }else if(timeInput[0]['time-period']){
      logger.debug('TIME NLP:  parsing input time range');
      return this.parse(`${params.apiai.result.parameters.date} ${timeInput[0]['time-period'].replace("/", " - ")}`, params.timezone);
    }else if(timeInput[0].time && timeInput.length > 1){
      logger.debug('TIME NLP:  parsing Date and time range');
      return this.parse(`${params.apiai.result.parameters.date} ${timeInput[0].time} - ${timeInput[1].time}`, params.timezone);
    }else if(timeInput[0].time){
      logger.debug('TIME NLP:  Parsing date and start time');
      return this.parse(`${params.apiai.result.parameters.date} ${timeInput[0].time}`, params.timezone);
    }else{
      logger.debug('TIME NLP:  NO match found');
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
