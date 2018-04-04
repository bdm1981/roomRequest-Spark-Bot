// messages sent by the bot in response to the user's requests. These can be updated to match your deployment

module.exports = {
  instruct: `**I\'m the RoomRequest Bot!**  I can help you find and book rooms in Cisco offices!\n\n 
  * To be guided through the process Type: **book a room**, to get started.\n\n
  * In a group space, Type: **when can we meet today** or **when can we meet friday between 10am and 5pm** to find available meetings times for all members in the space.\n\n
  * Once you a familiar with the commands you can Type: **book a room at CHG5 tomorrow from 1 to 4**.\n\n 
  * You will need to know the building ID you want to book a room at. If you don't know it, [click here](http://wwwin.cisco.com/c/cec/employee/buildings.html)\n\n 
  * type: **stop** or **cancel** at any time to cancel a request.\n\n 
  * type **support** to join a Spark space to ask questions about this bot\n\n * [click here](https://ace-rev.cisco.com/#/videos/8ea82ad0-db9f-4114-b62a-736ffb71fe1b) to watch a quick demo video of roomRequest`,

  cancelled: `You current request has been cancelled.`,

  success: `Great! Your room is now booked and you should receive a 📅 invite shortly!`,

  error: `Sorry, we ran into an issue booking the room!  This is usually caused by an unknown timezone for your region or your spark email address doesn't match a mailbox on this exchange system. Please type _support_ to join our spark room. Let us know what building you are trying to book a room at and we can fix it.`,
  
  support: `You have been added to the Room Request Spark space.`,

  when: `I am looking for the best time for this group to meet`,

  inviteSuccess: `🎉 Success! The 📅 invite has been sent. It will appear in your calendar shortly.`,

  includeRoom: 'Would you like to book a room for this meeting?',

  whichBuilding: 'What building would you like to book a room in?',

  setTimezone: 'You need to set your timezone before using this feature. Type **I am on "Your city" time** Example: I am on Chicago Time.'
};
