require('dotenv').config();
const winston = require("winston");

module.exports = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({
            level: process.env.DEBUG ? "debug" : "info",
            handleExceptions: true,
            colorize: true,
            prettyPrint: true,
        }),
    ],
});
