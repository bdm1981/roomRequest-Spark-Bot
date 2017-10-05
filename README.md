## roomRequest-Spark-Bot
#### Written by Brad McAllister
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/bdm1981/roomRequest-Spark-Bot)
roomRequest is a Cisco Spark bot created to help users find and book available conferences rooms. Leveraging the Botkit.io and API.AI I have tried to create an experience that is natural to the end user. Allowing the user to determine what rooms are available and book a free room.

# Requirements
* Exchange 2013 or later
* O365
* API.AI account
* Cisco Spark Bot account

When using Office 365, the bot can run in a public cloud. If the bot will interface with an onprem Exchange deployment, the bot will need to be deployed inside your network. This Spark webhook library is used to allow the bot to receive events without a public address.
