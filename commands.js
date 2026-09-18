const { ChannelType, SlashCommandBuilder } = require('discord.js');

const commandData = [
  new SlashCommandBuilder()
    .setName('ticketpaneel')
    .setDescription('Post the ticket panel in this channel.')
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
].map((command) => command.toJSON());

module.exports = { commandData };
