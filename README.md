## roomRequest-Spark-Bot
#### Developed by Brad McAllister
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/bdm1981/roomRequest-Spark-Bot)

roomRequest is a Cisco Spark bot created to help users find and book available conferences rooms. Leveraging the Botkit.io and API.AI I have tried to create an experience that is natural to the end user. Allowing the user to determine what rooms are available and book a free room.

# Requirements
* O365, Exchange 2013 or later
* API.AI Agent Token - Available [Here](https://api.ai)
* MongoDB - This is where the building, room, and conversation state is stored.
* Cisco Spark Bot account - Available [Here](https://developers.ciscospark.com)

When using Office 365, the bot can run in a public cloud. If the bot will interface with an on-prem Exchange deployment, the bot might need to be deployed inside your network to interface with EWS. A Spark web-sockets library is used to allow the bot to receive events without a public address.

# [Installation Instructions](https://github.com/bdm1981/roomRequest-Spark-Bot/wiki)

# Support
If you run into a problem, please raise and issue here. If you make a change that would be helpful for others, please submit a pull request.
