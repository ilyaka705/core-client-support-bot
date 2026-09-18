const { ChannelType, SlashCommandBuilder } = require('discord.js');

const commandData = [
  new SlashCommandBuilder()
    .setName('ticketpaneel')
    .setDescription('Post the ticket panel in this channel.')
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('rulepanel')
    .setDescription('Post the community rules panel in this channel.')
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('suggestionpanel')
    .setDescription('Post the suggestion panel in this channel.')
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-ticket-category')
    .setDescription('Choose where new tickets are created.')
    .addChannelOption((option) => option
      .setName('category')
      .setDescription('Ticket category (leave empty to disable it)')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-tiktok-feed')
    .setDescription('Automatically post new TikToks in a channel.')
    .addStringOption((option) => option
      .setName('username')
      .setDescription('TikTok username, without @')
      .setRequired(true))
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Channel where new TikToks are posted')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('remove-tiktok-feed')
    .setDescription('Turn off automatic TikTok posts.')
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-join-to-create')
    .setDescription('Choose the voice channel that creates temporary voice rooms.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Join this channel to create a personal voice room')
      .addChannelTypes(ChannelType.GuildVoice)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-auto-role')
    .setDescription('Choose a role that new members receive automatically.')
    .addRoleOption((option) => option
      .setName('role')
      .setDescription('Role to give new members (leave empty to disable)')
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-suggestion-channel')
    .setDescription('Choose where member suggestions are posted.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Suggestion channel (leave empty to use the panel channel)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-log-channel')
    .setDescription('Choose where general bot activity is saved.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('General log channel (leave empty to disable)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-ticket-log-channel')
    .setDescription('Choose where ticket activity and transcripts are saved.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Ticket log channel (leave empty to disable)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('applicationpanel')
    .setDescription('Post the private application panel in this channel.')
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('set-application-review-channel')
    .setDescription('Choose the private channel where applications are reviewed.')
    .addChannelOption((option) => option
      .setName('channel')
      .setDescription('Private staff channel (leave empty to disable applications)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('Post a self-role panel in this channel.')
    .addRoleOption((option) => option.setName('role1').setDescription('First role').setRequired(true))
    .addRoleOption((option) => option.setName('role2').setDescription('Second role').setRequired(false))
    .addRoleOption((option) => option.setName('role3').setDescription('Third role').setRequired(false))
    .addRoleOption((option) => option.setName('role4').setDescription('Fourth role').setRequired(false))
    .addRoleOption((option) => option.setName('role5').setDescription('Fifth role').setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete a number of recent messages from this channel.')
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Number of messages to delete (1-100)')
      .setMinValue(1)
      .setMaxValue(100)
      .setRequired(true))
    .setDefaultMemberPermissions(0x2000n),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start a giveaway in this channel.')
    .addStringOption((option) => option
      .setName('prize')
      .setDescription('What can members win?')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('duration')
      .setDescription('Duration in minutes')
      .setMinValue(1)
      .setMaxValue(43200)
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('winners')
      .setDescription('Number of winners (default: 1)')
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(false))
    .setDefaultMemberPermissions(0x20n),
  new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Post a poll in this channel.')
    .addStringOption((option) => option.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption((option) => option.setName('option1').setDescription('First option').setRequired(true))
    .addStringOption((option) => option.setName('option2').setDescription('Second option').setRequired(true))
    .addStringOption((option) => option.setName('option3').setDescription('Third option').setRequired(false))
    .addStringOption((option) => option.setName('option4').setDescription('Fourth option').setRequired(false))
    .addStringOption((option) => option.setName('option5').setDescription('Fifth option').setRequired(false))
    .setDefaultMemberPermissions(0x20n),
].map((command) => command.toJSON());

module.exports = { commandData };
