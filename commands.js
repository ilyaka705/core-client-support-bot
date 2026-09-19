const { ChannelType, SlashCommandBuilder } = require('discord.js');

const coreCommand = new SlashCommandBuilder()
  .setName('core')
  .setDescription('Manage CORE. client panels, posts, setup, and community tools.')
  .setDefaultMemberPermissions(0n)
  .addSubcommandGroup((group) => group
    .setName('panels')
    .setDescription('Post CORE. client panels in this channel.')
    .addSubcommand((command) => command
      .setName('tickets')
      .setDescription('Post the ticket panel.'))
    .addSubcommand((command) => command
      .setName('rules')
      .setDescription('Post the community rules panel.'))
    .addSubcommand((command) => command
      .setName('suggestions')
      .setDescription('Post the suggestion panel.'))
    .addSubcommand((command) => command
      .setName('links')
      .setDescription('Post one official links panel with up to five links.')
      .addStringOption((option) => option.setName('link1_label').setDescription('First link name, for example Website').setMaxLength(60).setRequired(true))
      .addStringOption((option) => option.setName('link1_url').setDescription('First full https:// link').setMaxLength(500).setRequired(true))
      .addStringOption((option) => option.setName('link2_label').setDescription('Second link name').setMaxLength(60).setRequired(false))
      .addStringOption((option) => option.setName('link2_url').setDescription('Second full https:// link').setMaxLength(500).setRequired(false))
      .addStringOption((option) => option.setName('link3_label').setDescription('Third link name').setMaxLength(60).setRequired(false))
      .addStringOption((option) => option.setName('link3_url').setDescription('Third full https:// link').setMaxLength(500).setRequired(false))
      .addStringOption((option) => option.setName('link4_label').setDescription('Fourth link name').setMaxLength(60).setRequired(false))
      .addStringOption((option) => option.setName('link4_url').setDescription('Fourth full https:// link').setMaxLength(500).setRequired(false))
      .addStringOption((option) => option.setName('link5_label').setDescription('Fifth link name').setMaxLength(60).setRequired(false))
      .addStringOption((option) => option.setName('link5_url').setDescription('Fifth full https:// link').setMaxLength(500).setRequired(false)))
    .addSubcommand((command) => command
      .setName('applications')
      .setDescription('Post the private application panel.'))
    .addSubcommand((command) => command
      .setName('roles')
      .setDescription('Post a self-role panel.')
      .addRoleOption((option) => option.setName('role1').setDescription('First role').setRequired(true))
      .addRoleOption((option) => option.setName('role2').setDescription('Second role').setRequired(false))
      .addRoleOption((option) => option.setName('role3').setDescription('Third role').setRequired(false))
      .addRoleOption((option) => option.setName('role4').setDescription('Fourth role').setRequired(false))
      .addRoleOption((option) => option.setName('role5').setDescription('Fifth role').setRequired(false))))
  .addSubcommandGroup((group) => group
    .setName('posts')
    .setDescription('Post changelogs, announcements, and sneak peeks.')
    .addSubcommand((command) => command
      .setName('changelog')
      .setDescription('Post a polished changelog entry.')
      .addStringOption((option) => option.setName('version').setDescription('For example: v1.4.0').setMaxLength(40).setRequired(true))
      .addStringOption((option) => option.setName('title').setDescription('Short title for this update').setMaxLength(100).setRequired(true))
      .addStringOption((option) => option.setName('changes').setDescription('Changes, fixes, and improvements').setMaxLength(3900).setRequired(true))
      .addRoleOption((option) => option.setName('notify_role').setDescription('Optional role to notify about this update').setRequired(false)))
    .addSubcommand((command) => command
      .setName('announcement')
      .setDescription('Post a polished announcement.')
      .addStringOption((option) => option.setName('title').setDescription('Announcement title').setMaxLength(100).setRequired(true))
      .addStringOption((option) => option.setName('message').setDescription('Announcement message').setMaxLength(3900).setRequired(true))
      .addRoleOption((option) => option.setName('notify_role').setDescription('Optional role to notify about this announcement').setRequired(false)))
    .addSubcommand((command) => command
      .setName('sneakpeek')
      .setDescription('Post a polished image sneak peek.')
      .addAttachmentOption((option) => option.setName('image').setDescription('Image to post').setRequired(true))
      .addStringOption((option) => option.setName('title').setDescription('Optional sneak peek title').setMaxLength(100).setRequired(false))
      .addStringOption((option) => option.setName('message').setDescription('Optional sneak peek text').setMaxLength(3900).setRequired(false))
      .addRoleOption((option) => option.setName('notify_role').setDescription('Optional role to notify about this sneak peek').setRequired(false))))
  .addSubcommandGroup((group) => group
    .setName('setup')
    .setDescription('Configure tickets, roles, logs, and community tools.')
    .addSubcommand((command) => command
      .setName('ticket-category')
      .setDescription('Choose where new tickets are created.')
      .addChannelOption((option) => option.setName('category').setDescription('Ticket category (leave empty to disable it)').addChannelTypes(ChannelType.GuildCategory).setRequired(false)))
    .addSubcommand((command) => command
      .setName('tiktok')
      .setDescription('Automatically post new TikToks in a channel.')
      .addStringOption((option) => option.setName('username').setDescription('TikTok username, without @').setRequired(true))
      .addChannelOption((option) => option.setName('channel').setDescription('Channel where new TikToks are posted').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((command) => command
      .setName('tiktok-off')
      .setDescription('Turn off automatic TikTok posts.'))
    .addSubcommand((command) => command
      .setName('voice')
      .setDescription('Choose the Join to Create voice channel.')
      .addChannelOption((option) => option.setName('channel').setDescription('Join this channel to create a personal voice room').addChannelTypes(ChannelType.GuildVoice).setRequired(false)))
    .addSubcommand((command) => command
      .setName('auto-role')
      .setDescription('Choose a role that new members receive automatically.')
      .addRoleOption((option) => option.setName('role').setDescription('Role to give new members (leave empty to disable)').setRequired(false)))
    .addSubcommand((command) => command
      .setName('suggestions')
      .setDescription('Choose the public channel where suggestions are posted.')
      .addChannelOption((option) => option.setName('channel').setDescription('Public suggestion channel (leave empty to disable suggestions)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((command) => command
      .setName('suggestion-staff')
      .setDescription('Choose the private channel where suggestions are reviewed.')
      .addChannelOption((option) => option.setName('channel').setDescription('Private staff channel (leave empty to disable suggestions)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((command) => command
      .setName('suggestion-role')
      .setDescription('Choose the role allowed to submit and vote on suggestions.')
      .addRoleOption((option) => option.setName('role').setDescription('Verified or member role (leave empty to allow everyone)').setRequired(false)))
    .addSubcommand((command) => command
      .setName('logs')
      .setDescription('Choose where general bot activity is saved.')
      .addChannelOption((option) => option.setName('channel').setDescription('General log channel (leave empty to disable)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((command) => command
      .setName('ticket-logs')
      .setDescription('Choose where ticket activity and transcripts are saved.')
      .addChannelOption((option) => option.setName('channel').setDescription('Ticket log channel (leave empty to disable)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand((command) => command
      .setName('anti-raid')
      .setDescription('Configure automatic protection against mass joins.')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Turn anti-raid on or off').setRequired(true))
      .addIntegerOption((option) => option.setName('join_limit').setDescription('Joins allowed before protection starts (default: 6)').setMinValue(3).setMaxValue(30).setRequired(false))
      .addIntegerOption((option) => option.setName('window_seconds').setDescription('Join detection window in seconds (default: 60)').setMinValue(10).setMaxValue(300).setRequired(false))
      .addIntegerOption((option) => option.setName('timeout_minutes').setDescription('Automatic timeout length (default: 60)').setMinValue(1).setMaxValue(1440).setRequired(false)))
    .addSubcommand((command) => command
      .setName('anti-spam')
      .setDescription('Configure automatic protection against spam and invites.')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Turn anti-spam on or off').setRequired(true))
      .addIntegerOption((option) => option.setName('message_limit').setDescription('Messages allowed before protection starts (default: 6)').setMinValue(3).setMaxValue(20).setRequired(false))
      .addIntegerOption((option) => option.setName('window_seconds').setDescription('Message detection window in seconds (default: 8)').setMinValue(3).setMaxValue(60).setRequired(false))
      .addIntegerOption((option) => option.setName('mention_limit').setDescription('Mentions allowed in one message (default: 5)').setMinValue(3).setMaxValue(20).setRequired(false))
      .addIntegerOption((option) => option.setName('timeout_minutes').setDescription('Automatic timeout length (default: 10)').setMinValue(1).setMaxValue(1440).setRequired(false))
      .addBooleanOption((option) => option.setName('block_invites').setDescription('Block Discord invite links (default: on)').setRequired(false)))
    .addSubcommand((command) => command
      .setName('applications')
      .setDescription('Choose the private channel where applications are reviewed.')
      .addChannelOption((option) => option.setName('channel').setDescription('Private staff channel (leave empty to disable applications)').addChannelTypes(ChannelType.GuildText).setRequired(false))))
  .addSubcommandGroup((group) => group
    .setName('manage')
    .setDescription('Manage moderation, events, and staff tools.')
    .addSubcommand((command) => command
      .setName('clear')
      .setDescription('Delete a number of recent messages from this channel.')
      .addIntegerOption((option) => option.setName('amount').setDescription('Number of messages to delete (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand((command) => command
      .setName('giveaway')
      .setDescription('Start a giveaway in this channel.')
      .addStringOption((option) => option.setName('prize').setDescription('What can members win?').setRequired(true))
      .addIntegerOption((option) => option.setName('duration').setDescription('Duration in minutes').setMinValue(1).setMaxValue(43200).setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners (default: 1)').setMinValue(1).setMaxValue(10).setRequired(false))
      .addRoleOption((option) => option.setName('notify_role').setDescription('Optional role to notify about this giveaway').setRequired(false)))
    .addSubcommand((command) => command
      .setName('poll')
      .setDescription('Post a poll in this channel.')
      .addStringOption((option) => option.setName('question').setDescription('Poll question').setRequired(true))
      .addStringOption((option) => option.setName('option1').setDescription('First option').setRequired(true))
      .addStringOption((option) => option.setName('option2').setDescription('Second option').setRequired(true))
      .addStringOption((option) => option.setName('option3').setDescription('Third option').setRequired(false))
      .addStringOption((option) => option.setName('option4').setDescription('Fourth option').setRequired(false))
      .addStringOption((option) => option.setName('option5').setDescription('Fifth option').setRequired(false)))
    .addSubcommand((command) => command
      .setName('reset-suggestions')
      .setDescription('Remove a member’s suggestion data and test cards.')
      .addUserOption((option) => option.setName('member').setDescription('Member whose test suggestions should be removed (default: you)').setRequired(false)))
    .addSubcommand((command) => command
      .setName('warn')
      .setDescription('Give a member a staff warning.')
      .addUserOption((option) => option.setName('member').setDescription('Member to warn').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning').setMaxLength(1000).setRequired(true)))
    .addSubcommand((command) => command
      .setName('warnings')
      .setDescription('View a member’s warning history.')
      .addUserOption((option) => option.setName('member').setDescription('Member whose warnings you want to view').setRequired(true)))
    .addSubcommand((command) => command
      .setName('clear-warnings')
      .setDescription('Remove all stored warnings for a member.')
      .addUserOption((option) => option.setName('member').setDescription('Member whose warnings you want to clear').setRequired(true)))
    .addSubcommand((command) => command
      .setName('timeout')
      .setDescription('Temporarily restrict a member.')
      .addUserOption((option) => option.setName('member').setDescription('Member to timeout').setRequired(true))
      .addIntegerOption((option) => option.setName('duration').setDescription('Duration in minutes (up to 28 days)').setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the timeout').setMaxLength(1000).setRequired(true)))
    .addSubcommand((command) => command
      .setName('remove-timeout')
      .setDescription('Remove a member’s timeout.')
      .addUserOption((option) => option.setName('member').setDescription('Member whose timeout you want to remove').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for removing the timeout').setMaxLength(1000).setRequired(false)))
    .addSubcommand((command) => command
      .setName('kick')
      .setDescription('Remove a member from the server.')
      .addUserOption((option) => option.setName('member').setDescription('Member to kick').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the kick').setMaxLength(1000).setRequired(true)))
    .addSubcommand((command) => command
      .setName('ban')
      .setDescription('Ban a member from the server.')
      .addUserOption((option) => option.setName('member').setDescription('Member to ban').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban').setMaxLength(1000).setRequired(true)))
    .addSubcommand((command) => command
      .setName('status')
      .setDescription('View the private CORE. client staff server overview.')));

const commandData = [coreCommand.toJSON()];

module.exports = { commandData };
