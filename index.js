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

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
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
      .setColor(0x010101)
      .setTitle(`New TikTok from @${feed.username}`)
      .setDescription(feed.description || latest.description.slice(0, 1000))
      .setURL(`https://www.tiktok.com/@${feed.username}/video/${latest.id}`)
      .setThumbnail(latest.cover)
      .setFooter({ text: 'CORE.client - Support • TikTok Feed' })
      .setTimestamp()],
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

const panelEmbed = new EmbedBuilder()
  .setColor(0x2B6CB0)
  .setTitle('🎫  CORE.client Support Center')
  .setDescription('Welcome! Our support team is ready to help you.\n\nClick **Open Ticket** below to create a private support request.')
  .addFields(
    {
      name: '📋 How it works',
      value: '1. Click **Open Ticket**\n2. Fill in the short form\n3. A support member will claim your ticket',
    },
    {
      name: '🔒 Private & secure',
      value: 'Only you and our support team can see your ticket. Please do not share passwords or other sensitive information.',
    },
  )
  .setFooter({ text: 'CORE.client - Support • We are here to help' })
  .setTimestamp();

const openRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket_open').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
);

function ticketActions(claimedBy = null) {
  const claimButton = new ButtonBuilder()
    .setCustomId('ticket_claim')
    .setLabel(claimedBy ? `Claimed by ${claimedBy}` : 'Claim Ticket')
    .setEmoji(claimedBy ? '✅' : '🙋')
    .setStyle(claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(Boolean(claimedBy));
  const closeButton = new ButtonBuilder()
    .setCustomId('ticket_close')
    .setLabel('Close Ticket')
    .setEmoji('🔒')
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(claimButton, closeButton);
}

async function ensureSupportRole(guild) {
  const configuredId = settings.supportRoleIds[guild.id];
  let role = configuredId ? await guild.roles.fetch(configuredId).catch(() => null) : null;
  if (!role) {
    const roles = await guild.roles.fetch();
    role = roles.find((item) => item.name === 'Support' && !item.managed);
  }
  if (!role) role = await guild.roles.create({ name: 'Support', reason: 'Support role for Ticket Bot staff' });

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

  await interaction.reply('This ticket will close in 5 seconds.');
  setTimeout(() => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(console.error), 5000);
}

function ticketForm() {
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
    .setCustomId('ticket_create')
    .setTitle('New Ticket')
    .addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(description));
}

function isVoiceRoomOwner(interaction) {
  return settings.temporaryVoiceChannels[interaction.channelId] === interaction.user.id
    || interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels);
}

function voiceRoomActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('voice_room_invite').setLabel('Invite Member').setEmoji('➕').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('voice_room_limit').setLabel('Member Limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice_room_delete').setLabel('Close Room').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

async function sendVoiceRoomPanel(channel, owner) {
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x2B6CB0)
      .setTitle('🔊 Your Private Voice Room')
      .setDescription(`This room is private. Use the buttons below to invite members, set a member limit, or close it.\n\nRoom owner: **${owner.displayName}**`)
      .setFooter({ text: 'CORE.client - Support • Temporary Voice Room' })],
    components: [voiceRoomActions()],
    allowedMentions: { parse: [] },
  });
}

async function createTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const existing = interaction.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.topic?.startsWith(`ticket-owner:${interaction.user.id}`),
  );
  if (existing) return interaction.editReply(`You already have an open ticket: ${existing}`);

  const supportRoleId = await ensureSupportRole(interaction.guild);
  const categoryId = settings.ticketCategoryIds[interaction.guild.id] || config.categoryId;
  const subject = interaction.fields.getTextInputValue('subject');
  const description = interaction.fields.getTextInputValue('description');
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 70) || 'gebruiker';
  const channel = await interaction.guild.channels.create({
    name: `ticket-${safeName}`,
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    topic: `ticket-owner:${interaction.user.id}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
    ],
  });

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x2B6CB0)
      .setTitle('🎫 New Support Ticket')
      .setDescription('A new support request has been submitted. A member of the support team can claim it below.')
      .setThumbnail(client.user.displayAvatarURL())
      .setAuthor({ name: `Opened by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .addFields(
        { name: '📌 Subject', value: subject },
        { name: '📝 Issue Details', value: description },
      )
      .setFooter({ text: 'Status: Unclaimed • Please do not share private information' })
      .setTimestamp()],
    components: [ticketActions()],
    allowedMentions: { parse: [] },
  });
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

client.on(Events.GuildMemberAdd, async (member) => {
  const channelId = settings.welcomeChannelIds[member.guild.id];
  if (!channelId) return;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: `Welcome to **${member.guild.name}**, ${member}!`,
    embeds: [new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Welcome!')
      .setDescription(`We're happy to have you here, ${member.user.username}. Please take a moment to read the server rules and enjoy your stay!`)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp()],
    allowedMentions: { users: [member.id] },
  }).catch(console.error);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    if (newState.member.user.bot) return;

    const previousChannel = oldState.channel;
    if (previousChannel && settings.temporaryVoiceChannels[previousChannel.id] && previousChannel.members.size === 0) {
      delete settings.temporaryVoiceChannels[previousChannel.id];
      saveSettings();
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
  } catch (error) {
    console.error('Join to Create:', error.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const managementCommands = new Set([
        'ticketpaneel',
        'set-ticket-category',
        'set-welcome-channel',
        'set-tiktok-feed',
        'remove-tiktok-feed',
        'set-join-to-create',
      ]);
      if (managementCommands.has(interaction.commandName) && !canManageBot(interaction.member)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      }
      if (interaction.commandName === 'ticketpaneel') {
        await interaction.channel.send({ embeds: [panelEmbed], components: [openRow] });
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
      if (interaction.commandName === 'set-welcome-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.welcomeChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Welcome messages will now be sent in ${channel}.`, ephemeral: true });
        } else {
          delete settings.welcomeChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Welcome messages have been disabled.', ephemeral: true });
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
        return interaction.update({ embeds: [claimedEmbed], components: [ticketActions(interaction.user.username)] });
      }
      if (interaction.customId === 'ticket_open') return interaction.showModal(ticketForm());
      if (interaction.customId === 'voice_room_invite') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can invite members.', ephemeral: true });
        return interaction.reply({
          content: 'Choose a member to invite to this private voice room.',
          components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
            .setCustomId('voice_room_invite_user')
            .setPlaceholder('Select a member to invite')
            .setMinValues(1)
            .setMaxValues(1))],
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
      if (interaction.customId === 'voice_room_delete') {
        if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can close this room.', ephemeral: true });
        await interaction.reply({ content: 'This voice room will close in 3 seconds.', ephemeral: true });
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

    if (interaction.isStringSelectMenu() && interaction.customId === 'voice_room_limit_select') {
      if (!isVoiceRoomOwner(interaction)) return interaction.reply({ content: 'Only the room owner can set the member limit.', ephemeral: true });
      const limit = Number(interaction.values[0]);
      await interaction.channel.setUserLimit(limit, `Member limit updated by ${interaction.user.tag}`);
      return interaction.update({ content: limit ? `Member limit set to **${limit}**.` : 'Member limit removed.', components: [] });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'ticket_create') await createTicket(interaction);
  } catch (error) {
    console.error(error);
    const message = 'Something went wrong while processing this ticket.';
    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
