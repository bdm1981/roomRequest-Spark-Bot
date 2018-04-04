const fetch = require('node-fetch');
require('dotenv').config();
const logger = require("../utils/logger");

module.exports = {
  geo: function(input){
    logger.debug('geo input: ', input);
    return fetch('https://maps.googleapis.com/maps/api/geocode/json?address='+input.city+'&key=AIzaSyB4F_jWdtbj1eIVUtfiw1QiLaicQSwZQwk').then(res => res.json())
           .then(json => {
            return { name: json.results[0].formatted_address, lat: json.results[0].geometry.location.lat, lng: json.results[0].geometry.location.lng}
          })
  },

  lookup: function(input){
    return fetch('https://maps.googleapis.com/maps/api/timezone/json?location='+input.lat+','+input.lng+'&timestamp=1331766000&key=AIzaSyB4F_jWdtbj1eIVUtfiw1QiLaicQSwZQwk').then(res => res.json());
  },

  get: function(input){
    return this.geo(input).then(result => {
      return this.lookup(result);
    })
  }
}
