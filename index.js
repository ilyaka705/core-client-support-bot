require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const { commandData } = require('./commands');

const required = ['DISCORD_TOKEN'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing .env values: ${missing.join(', ')}`);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });
const config = {
  categoryId: process.env.TICKET_CATEGORY_ID || null,
};
const settingsPath = process.env.SETTINGS_PATH || path.join(__dirname, 'ticket-settings.json');
let settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : { supportRoleIds: {}, ticketCategoryIds: {}, welcomeChannelIds: {} };
settings.supportRoleIds ??= {};
settings.ticketCategoryIds ??= {};
settings.welcomeChannelIds ??= {};
settings.tiktokFeeds ??= {};
settings.joinToCreateChannelIds ??= {};
settings.temporaryVoiceChannels ??= {};
settings.autoRoleIds ??= {};
settings.logChannelIds ??= {};
settings.rolePanels ??= {};

const ticketTypes = {
  general: 'General support',
  purchase: 'Purchase or billing',
  report: 'Report a player',
  partnership: 'Partnership',
};

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

async function sendLog(guild, title, description, files = []) {
  const channelId = settings.logChannelIds[guild.id];
  if (!channelId) return false;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: 'Staff activity' })],
    files,
    allowedMentions: { parse: [] },
  });
  return true;
}

async function createTicketTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const lines = [...messages.values()]
    .sort((first, second) => first.createdTimestamp - second.createdTimestamp)
    .map((message) => {
      const attachments = [...message.attachments.values()].map((attachment) => attachment.url).join(' ');
      // Ticket details are sent in Discord embeds. Save every readable part of
      // those embeds, so the opening "New request" panel is never lost.
      const embeds = message.embeds.flatMap((embed) => {
        const parts = [
          embed.author?.name,
          embed.title ? `[${embed.title}]` : null,
          embed.description,
          ...embed.fields.map((field) => `${field.name}: ${field.value}`),
          embed.footer?.text,
        ].filter(Boolean);
        return parts.length ? parts : [];
      });
      const content = [message.content.trim(), ...embeds, attachments].filter(Boolean).join('\n');
      return content ? `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.username}\n${content}\n` : null;
    })
    .filter(Boolean);
  return Buffer.from(`CORE. client ticket transcript\nChannel: ${channel.name}\n\n${lines.join('\n')}`, 'utf8');
}

async function sendTranscriptToTicketOwner(ownerId, channelName, transcript) {
  if (!transcript) return false;
  const user = await client.users.fetch(ownerId).catch(() => null);
  if (!user) return false;
  await user.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
      .setTitle('Your ticket transcript')
      .setDescription(`Your support request **${channelName}** has been closed. A copy of the conversation is attached.`)
      .setFooter({ text: 'CORE. client' })],
    files: [{ attachment: transcript, name: `${channelName}-transcript.txt` }],
    allowedMentions: { parse: [] },
  });
  return true;
}

function findTikTokVideos(value, username, videos = new Map()) {
  if (!value || typeof value !== 'object') return videos;
  if (value.id && value.video && value.author?.uniqueId?.toLowerCase() === username.toLowerCase()) {
    videos.set(String(value.id), {
      id: String(value.id),
      description: value.desc || 'New TikTok video',
      createdAt: Number(value.createTime || 0),
      cover: value.video.cover || value.video.dynamicCover || null,
    });
  }
  for (const child of Object.values(value)) findTikTokVideos(child, username, videos);
  return videos;
}

async function getLatestTikTokVideo(username) {
  const response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`TikTok returned ${response.status}`);
  const html = await response.text();
  const state = html.match(/<script id="SIGI_STATE" type="application\/json">(.*?)<\/script>/s)?.[1]
    || html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s)?.[1];
  if (!state) throw new Error('TikTok profile data was not found');
  const videos = [...findTikTokVideos(JSON.parse(state), username).values()]
    .sort((first, second) => second.createdAt - first.createdAt);
  if (!videos.length) throw new Error('No public TikTok videos were found');
  return videos[0];
}

async function checkTikTokFeed(guild, feed) {
  const latest = await getLatestTikTokVideo(feed.username);
  if (!feed.lastVideoId) {
    feed.lastVideoId = latest.id;
    saveSettings();
    return;
  }
  if (feed.lastVideoId === latest.id) return;

  const channel = await guild.channels.fetch(feed.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('Configured TikTok channel was not found');
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setTitle(`New TikTok from @${feed.username}`)
      .setDescription(feed.description || latest.description.slice(0, 1000))
      .setURL(`https://www.tiktok.com/@${feed.username}/video/${latest.id}`)
      .setThumbnail(latest.cover)
      .setFooter({ text: 'CORE. client • TikTok' })],
    allowedMentions: { parse: [] },
  });
  feed.lastVideoId = latest.id;
  saveSettings();
}

async function checkTikTokFeeds() {
  for (const guild of client.guilds.cache.values()) {
    const feed = settings.tiktokFeeds[guild.id];
    if (!feed) continue;
    await checkTikTokFeed(guild, feed).catch((error) => console.error(`TikTok feed for ${feed.username}:`, error.message));
  }
}

function ticketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
    .setTitle('How can we help?')
    .setDescription('Open a private support request and our team will take it from there.')
    .addFields(
      { name: '01  Start', value: 'Create a ticket below.' },
      { name: '02  Share', value: 'Tell us what you need help with.' },
      { name: '03  Resolve', value: 'A team member will reply as soon as possible.' },
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: 'Private support  •  CORE. client' });
}

const openRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket_open').setLabel('Create ticket').setStyle(ButtonStyle.Primary),
);

function ticketTypeMenu() {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('ticket_open_category')
    .setPlaceholder('Choose a request type')
    .addOptions(
      { label: 'General support', value: 'general', description: 'Questions, help, or general support' },
      { label: 'Purchase or billing', value: 'purchase', description: 'Orders, payments, or purchases' },
      { label: 'Report a player', value: 'report', description: 'Report a player or issue' },
      { label: 'Partnership', value: 'partnership', description: 'Partnership or collaboration request' },
    ));
}

function ticketActions(claimedBy = null) {
  const claimButton = new ButtonBuilder()
    .setCustomId('ticket_claim')
    .setLabel(claimedBy ? `Claimed by ${claimedBy}` : 'Claim Ticket')
    .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(Boolean(claimedBy));
  const closeButton = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(claimButton, closeButton);
}

async function ensureSupportRole(guild) {
  const configuredId = settings.supportRoleIds[guild.id];
  let role = configuredId ? await guild.roles.fetch(configuredId).catch(() => null) : null;
  if (!role) {
    const roles = await guild.roles.fetch();
    role = roles.find((item) => (item.name === 'CORE. assistant' || item.name === 'Support') && !item.managed);
  }
  if (!role) role = await guild.roles.create({ name: 'CORE. assistant', reason: 'Staff role for CORE. client' });
  if (role.name !== 'CORE. assistant') await role.setName('CORE. assistant', 'Updated CORE. client staff role name');

  settings.supportRoleIds[guild.id] = role.id;
  saveSettings();
  return role.id;
}

async function isSupport(member) {
  const supportRoleId = await ensureSupportRole(member.guild);
  return member.roles.cache.has(supportRoleId) || member.permissions.has(PermissionsBitField.Flags.ManageChannels);
}

function canManageBot(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

async function closeTicket(interaction) {
  const ownerId = interaction.channel.topic?.match(/^ticket-owner:(\d+)/)?.[1];
  if (!ownerId) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
  if (interaction.user.id !== ownerId && !(await isSupport(interaction.member))) {
    return interaction.reply({ content: 'Only the ticket owner or the support team can close this ticket.', ephemeral: true });
  }

  const transcript = await createTicketTranscript(interaction.channel).catch((error) => {
    console.error('Ticket transcript:', error.message);
    return null;
  });
  const transcriptSent = await sendTranscriptToTicketOwner(ownerId, interaction.channel.name, transcript).catch(() => false);
  await sendLog(
    interaction.guild,
    'Ticket closed',
    `Ticket: **${interaction.channel.name}**\nClosed by: **${interaction.user.username}**`,
    transcript ? [{ attachment: transcript, name: `${interaction.channel.name}-transcript.txt` }] : [],
  ).catch((error) => console.error('Ticket log:', error.message));

  await interaction.reply(transcriptSent ? 'This ticket will close in 5 seconds. A transcript has been sent by DM.' : 'This ticket will close in 5 seconds.');
  setTimeout(() => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(console.error), 5000);
}

function ticketForm(type) {
  const subject = new TextInputBuilder()
    .setCustomId('subject')
    .setLabel('What is your ticket about?')
    .setPlaceholder('For example: help with an order')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Describe your issue as clearly as possible')
    .setPlaceholder('What happened? When did it start? What have you already tried?')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`ticket_create:${type}`)
    .setTitle('New request')
    .addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(description));
}

function isVoiceRoomOwner(interaction) {
  return settings.temporaryVoiceChannels[interaction.channelId] === interaction.user.id
    || interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels);
}

function voiceRoomActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('voice_room_invite').setLabel('Invite').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('voice_room_limit').setLabel('Member limit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice_room_transfer').setLabel('Transfer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice_room_revoke').setLabel('Remove').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice_room_delete').setLabel('Close room').setStyle(ButtonStyle.Danger),
  );
}

function voiceMemberSelector(customId, placeholder) {
  return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1));
}

async function sendVoiceRoomPanel(channel, owner) {
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setTitle('Your private room')
      .setDescription(`Private room for **${owner.displayName}**.\n\nInvite people, set a member limit, or close this room when you are done.`)
      .setFooter({ text: 'CORE. client' })],
    components: [voiceRoomActions()],
    allowedMentions: { parse: [] },
  });
}

function rolePanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
    .setTitle('Choose your roles')
    .setDescription('Select the roles you want. You can update your choices whenever you like.')
    .setFooter({ text: 'CORE. client' });
}

function rolePanelMenu(roles) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('role_panel_select')
    .setPlaceholder('Select your roles')
    .setMinValues(0)
    .setMaxValues(roles.length)
    .addOptions(roles.map((role) => ({ label: role.name.slice(0, 100), value: role.id }))));
}

async function createTicket(interaction, type) {
  await interaction.deferReply({ ephemeral: true });
  const existing = interaction.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.topic?.startsWith(`ticket-owner:${interaction.user.id}`),
  );
  if (existing) return interaction.editReply(`You already have an open ticket: ${existing}`);

  const supportRoleId = await ensureSupportRole(interaction.guild);
  const categoryId = settings.ticketCategoryIds[interaction.guild.id] || config.categoryId;
  const subject = interaction.fields.getTextInputValue('subject');
  const description = interaction.fields.getTextInputValue('description');
  const safeName = interaction.member.displayName.replace(/[\\/#:\r\n]/g, '').trim().slice(0, 80) || 'member';
  const channel = await interaction.guild.channels.create({
    name: `✦・${safeName}'s ticket`,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    topic: `ticket-owner:${interaction.user.id};type:${type}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    ],
  });

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setTitle('New request')
      .setDescription('A support member can claim this request below.')
      .setThumbnail(client.user.displayAvatarURL())
      .setAuthor({ name: `Opened by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .addFields(
        { name: 'Request type', value: ticketTypes[type] || ticketTypes.general },
        { name: 'Subject', value: subject },
        { name: 'Details', value: description },
      )
      .setFooter({ text: 'Unclaimed • CORE. client' })],
    components: [ticketActions()],
    allowedMentions: { parse: [] },
  });
  await sendLog(
    interaction.guild,
    'New ticket',
    `Ticket: **${channel.name}**\nType: **${ticketTypes[type] || ticketTypes.general}**\nOpened by: **${interaction.user.username}**`,
  ).catch((error) => console.error('Ticket log:', error.message));
  await interaction.editReply(`Your ticket has been opened: ${channel}`);
}

client.once(Events.ClientReady, async (readyClient) => {
  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await ensureSupportRole(guild);
    } catch (error) {
      console.error(`Could not create Support role in ${guild.name}:`, error.message);
    }
    try {
      await guild.commands.set(commandData);
    } catch (error) {
      console.error(`Could not register commands in ${guild.name}:`, error.message);
    }
  }
  await checkTikTokFeeds();
  setInterval(checkTikTokFeeds, 5 * 60 * 1000).unref();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await ensureSupportRole(guild);
  } catch (error) {
    console.error(`Could not create Support role in ${guild.name}:`, error.message);
  }
  try {
    await guild.commands.set(commandData);
    console.log(`Configured commands for ${guild.name}`);
  } catch (error) {
    console.error(`Could not register commands in ${guild.name}:`, error.message);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    if (newState.member.user.bot) return;

    const previousChannel = oldState.channel;
    if (previousChannel && settings.temporaryVoiceChannels[previousChannel.id] && previousChannel.members.size === 0) {
      delete settings.temporaryVoiceChannels[previousChannel.id];
      saveSettings();
      await sendLog(newState.guild, 'Voice room closed', `Room: **${previousChannel.name}**\nReason: Empty room`).catch((error) => console.error('Voice log:', error.message));
      await previousChannel.delete('Temporary voice channel is empty').catch(console.error);
    }

    const joinToCreateId = settings.joinToCreateChannelIds[newState.guild.id];
    if (!joinToCreateId || newState.channelId !== joinToCreateId) return;

    const sourceChannel = newState.channel;
    const displayName = newState.member.displayName.replace(/[\\/@#:]/g, '').trim().slice(0, 80) || newState.member.user.username;
    const voiceChannel = await newState.guild.channels.create({
      name: `╰・voice・${displayName}`,
      type: ChannelType.GuildVoice,
      parent: sourceChannel.parentId || undefined,
      permissionOverwrites: [
        { id: newState.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: newState.member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ],
      reason: `Temporary voice room for ${newState.member.user.tag}`,
    });
    settings.temporaryVoiceChannels[voiceChannel.id] = newState.member.id;
    saveSettings();
    await newState.setChannel(voiceChannel, 'Moved to a personal temporary voice room');
    await sendVoiceRoomPanel(voiceChannel, newState.member);
    await sendLog(newState.guild, 'Voice room created', `Room: **${voiceChannel.name}**\nOwner: **${newState.member.user.username}**`).catch((error) => console.error('Voice log:', error.message));
  } catch (error) {
    console.error('Join to Create:', error.message);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const roleId = settings.autoRoleIds[member.guild.id];
  if (!roleId) return;
  const role = await member.guild.roles.fetch(roleId).catch(() => null);
  if (!role) return;
  await member.roles.add(role, 'Automatic role for new member').catch((error) =>
    console.error(`Could not give auto role in ${member.guild.name}:`, error.message),
  );
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'clear') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
          return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }
        if (typeof interaction.channel.bulkDelete !== 'function') {
          return interaction.reply({ content: 'Messages cannot be cleared in this channel.', ephemeral: true });
        }
        const amount = interaction.options.getInteger('amount', true);
        const deleted = await interaction.channel.bulkDelete(amount, true);
        await sendLog(interaction.guild, 'Messages cleared', `Channel: **${interaction.channel.name}**\nDeleted: **${deleted.size}** messages\nBy: **${interaction.user.username}**`).catch((error) => console.error('Staff log:', error.message));
        return interaction.reply({ content: `Cleared **${deleted.size}** messages. Messages older than 14 days cannot be removed by Discord.`, ephemeral: true });
      }
      const managementCommands = new Set([
        'ticketpaneel',
        'set-ticket-category',
        'set-tiktok-feed',
        'remove-tiktok-feed',
        'set-join-to-create',
        'set-auto-role',
        'set-log-channel',
        'rolepanel',
      ]);
      if (managementCommands.has(interaction.commandName) && !canManageBot(interaction.member)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      }
      if (interaction.commandName === 'ticketpaneel') {
        await interaction.channel.send({ embeds: [ticketPanelEmbed()], components: [openRow] });
        await interaction.reply({ content: 'Ticket panel posted.', ephemeral: true });
      }
      if (interaction.commandName === 'set-ticket-category') {
        const category = interaction.options.getChannel('category');
        if (category) {
          settings.ticketCategoryIds[interaction.guild.id] = category.id;
          saveSettings();
          await interaction.reply({ content: `New tickets will now be created in **${category.name}**.`, ephemeral: true });
        } else {
          delete settings.ticketCategoryIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Ticket category removed. New tickets will be created without a category.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-tiktok-feed') {
        const username = interaction.options.getString('username', true).replace(/^@/, '').trim();
        const channel = interaction.options.getChannel('channel', true);
        settings.tiktokFeeds[interaction.guild.id] = { username, channelId: channel.id, lastVideoId: null };
        saveSettings();
        await interaction.reply({ content: `TikTok feed saved. New videos from **@${username}** will be posted in ${channel}.`, ephemeral: true });
        await checkTikTokFeed(interaction.guild, settings.tiktokFeeds[interaction.guild.id]).catch(() => {});
      }
      if (interaction.commandName === 'remove-tiktok-feed') {
        delete settings.tiktokFeeds[interaction.guild.id];
        saveSettings();
        await interaction.reply({ content: 'Automatic TikTok posts have been disabled.', ephemeral: true });
      }
      if (interaction.commandName === 'set-join-to-create') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.joinToCreateChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Join to Create is now active. Members who join ${channel} will receive a temporary voice room.`, ephemeral: true });
        } else {
          delete settings.joinToCreateChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Join to Create has been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-auto-role') {
        const role = interaction.options.getRole('role');
        if (role) {
          if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.reply({ content: 'Move the bot role above this role before using it as an auto role.', ephemeral: true });
          }
          settings.autoRoleIds[interaction.guild.id] = role.id;
          saveSettings();
          await interaction.reply({ content: `New members will now automatically receive the **${role.name}** role.`, ephemeral: true });
        } else {
          delete settings.autoRoleIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Automatic role assignment has been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-log-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.logChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Staff logs and ticket transcripts will now be saved in ${channel}.`, ephemeral: true });
        } else {
          delete settings.logChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Staff logs and ticket transcripts have been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'rolepanel') {
        const roles = [...new Map(['role1', 'role2', 'role3', 'role4', 'role5']
          .map((name) => interaction.options.getRole(name))
          .filter(Boolean)
          .map((role) => [role.id, role])).values()];
        const unmanageableRole = roles.find((role) => role.managed || role.position >= interaction.guild.members.me.roles.highest.position);
        if (unmanageableRole) {
          return interaction.reply({ content: `Move the bot role above **${unmanageableRole.name}** before adding it to a role panel.`, ephemeral: true });
        }
        const message = await interaction.channel.send({ embeds: [rolePanelEmbed()], components: [rolePanelMenu(roles)] });
        settings.rolePanels[message.id] = roles.map((role) => role.id);
        saveSettings();
        await interaction.reply({ content: 'Role panel posted.', ephemeral: true });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_close') return closeTicket(interaction);
      if (interaction.customId === 'ticket_claim') {
        if (!(await isSupport(interaction.member))) {
          return interaction.reply({ content: 'Only the support team can claim tickets.', ephemeral: true });
        }
        if (interaction.message.embeds[0]?.footer?.text?.startsWith('Claimed by')) {
          return interaction.reply({ content: 'This ticket has already been claimed.', ephemeral: true });
        }
        const claimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setFooter({ text: `Claimed by ${interaction.user.tag}` });
        await sendLog(interaction.guild, 'Ticket claimed', `Ticket: **${interaction.channel.name}**\nClaimed by: **${interaction.user.username}**`).catch((error) => console.error('Ticket log:', error.message));
        return interaction.update({ embeds: [claimedEmbed], components: [ticketActions(interaction.user.username)] });
      }
      if (interaction.customId === 'ticket_open') {
        return interaction.reply({
          content: 'Choose the type of support you need.',
          components: [ticketTypeMenu()],
          ephemeral: true,
        });
      }
      if (interaction.customId === 'voice_room_invite') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can invite members.', ephemeral: true });
        return interaction.reply({
          content: 'Choose a member to invite to this private voice room.',
          components: [voiceMemberSelector('voice_room_invite_user', 'Select a member to invite')],
          ephemeral: true,
        });
      }
      if (interaction.customId === 'voice_room_limit') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can set the member limit.', ephemeral: true });
        return interaction.reply({
          content: 'Choose the maximum number of members allowed in this room.',
          components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('voice_room_limit_select')
            .setPlaceholder('Select a member limit')
            .addOptions(
              { label: 'No limit', value: '0' },
              { label: '2 members', value: '2' },
              { label: '3 members', value: '3' },
              { label: '5 members', value: '5' },
              { label: '10 members', value: '10' },
              { label: '20 members', value: '20' },
              { label: '50 members', value: '50' },
            ))],
          ephemeral: true,
        });
      }
      if (interaction.customId === 'voice_room_transfer') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can transfer this room.', ephemeral: true });
        return interaction.reply({
          content: 'Choose the new room owner.',
          components: [voiceMemberSelector('voice_room_transfer_user', 'Select the new owner')],
          ephemeral: true,
        });
      }
      if (interaction.customId === 'voice_room_revoke') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can remove members.', ephemeral: true });
        return interaction.reply({
          content: 'Choose a member to remove from this private room.',
          components: [voiceMemberSelector('voice_room_revoke_user', 'Select a member to remove')],
          ephemeral: true,
        });
      }
      if (interaction.customId === 'voice_room_delete') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can close this room.', ephemeral: true });
        await interaction.reply({ content: 'This voice room will close in 3 seconds.', ephemeral: true });
        await sendLog(interaction.guild, 'Voice room closed', `Room: **${interaction.channel.name}**\nClosed by: **${interaction.user.username}**`).catch((error) => console.error('Voice log:', error.message));
        delete settings.temporaryVoiceChannels[interaction.channelId];
        saveSettings();
        return setTimeout(() => interaction.channel.delete('Temporary voice room closed by its owner').catch(console.error), 3000);
      }
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'voice_room_invite_user') {
      if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can invite members.', ephemeral: true });
      const memberId = interaction.values[0];
      await interaction.channel.permissionOverwrites.edit(memberId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }, { reason: `Invited to private voice room by ${interaction.user.tag}` });
      return interaction.update({ content: 'Member invited. They can now see and join this room.', components: [] });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'voice_room_transfer_user') {
      if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can transfer this room.', ephemeral: true });
      const memberId = interaction.values[0];
      if (memberId === client.user.id) return interaction.reply({ content: 'The bot cannot own a voice room.', ephemeral: true });
      await interaction.channel.permissionOverwrites.edit(memberId, {
        ViewChannel: true,
        Connect: true,
        Speak: true,
        SendMessages: true,
        ReadMessageHistory: true,
      }, { reason: `Voice room ownership transferred by ${interaction.user.tag}` });
      settings.temporaryVoiceChannels[interaction.channelId] = memberId;
      saveSettings();
      await sendLog(interaction.guild, 'Voice room transferred', `Room: **${interaction.channel.name}**\nNew owner selected by: **${interaction.user.username}**`).catch((error) => console.error('Voice log:', error.message));
      return interaction.update({ content: 'Room ownership transferred.', components: [] });
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'voice_room_revoke_user') {
      if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can remove members.', ephemeral: true });
      const memberId = interaction.values[0];
      if (memberId === settings.temporaryVoiceChannels[interaction.channelId] || memberId === client.user.id) {
        return interaction.reply({ content: 'Choose an invited member instead.', ephemeral: true });
      }
      await interaction.channel.permissionOverwrites.delete(memberId, `Removed from private voice room by ${interaction.user.tag}`);
      const member = interaction.channel.members.get(memberId);
      if (member) await member.voice.setChannel(null, 'Removed from private voice room').catch(() => {});
      await sendLog(interaction.guild, 'Member removed from voice room', `Room: **${interaction.channel.name}**\nRemoved by: **${interaction.user.username}**`).catch((error) => console.error('Voice log:', error.message));
      return interaction.update({ content: 'Member removed from this room.', components: [] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_open_category') {
      const type = interaction.values[0];
      return interaction.showModal(ticketForm(ticketTypes[type] ? type : 'general'));
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'voice_room_limit_select') {
      if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can set the member limit.', ephemeral: true });
      const limit = Number(interaction.values[0]);
      await interaction.channel.setUserLimit(limit, `Member limit updated by ${interaction.user.tag}`);
      return interaction.update({ content: limit ? `Member limit set to **${limit}**.` : 'Member limit removed.', components: [] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'role_panel_select') {
      const panelRoles = settings.rolePanels[interaction.message.id];
      if (!panelRoles) return interaction.reply({ content: 'This role panel is no longer active.', ephemeral: true });
      const selectedRoles = interaction.values;
      const rolesToRemove = interaction.member.roles.cache
        .filter((role) => panelRoles.includes(role.id) && !selectedRoles.includes(role.id))
        .map((role) => role.id);
      const rolesToAdd = selectedRoles.filter((roleId) => !interaction.member.roles.cache.has(roleId));
      if (rolesToRemove.length) await interaction.member.roles.remove(rolesToRemove, 'Updated roles from CORE. client role panel');
      if (rolesToAdd.length) await interaction.member.roles.add(rolesToAdd, 'Updated roles from CORE. client role panel');
      return interaction.reply({ content: 'Your roles have been updated.', ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_create:')) {
      const type = interaction.customId.split(':')[1];
      return createTicket(interaction, ticketTypes[type] ? type : 'general');
    }
  } catch (error) {
    console.error(error);
    const message = 'Something went wrong while processing this ticket.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
