require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
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

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
] });
const config = {
  categoryId: process.env.TICKET_CATEGORY_ID || null,
};
// Railway provides this path automatically when a persistent Volume is attached.
// Locally, the bot continues to use ticket-settings.json in the project folder.
const settingsPath = process.env.SETTINGS_PATH
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'core-client-settings.json')
    : path.join(__dirname, 'ticket-settings.json'));
let settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : { supportRoleIds: {}, ticketCategoryIds: {}, welcomeChannelIds: {} };
settings.supportRoleIds ??= {};
settings.ticketCategoryIds ??= {};
settings.welcomeChannelIds ??= {};
settings.tiktokFeeds ??= {};
settings.joinToCreateChannelIds ??= {};
settings.temporaryVoiceChannels ??= {};
settings.autoRoleIds ??= {};
settings.logChannelIds ??= {};
settings.ticketLogChannelIds ??= {};
settings.rolePanels ??= {};
settings.suggestionChannelIds ??= {};
settings.suggestionStaffChannelIds ??= {};
settings.suggestionRoleIds ??= {};
settings.suggestions ??= {};
settings.giveaways ??= {};
settings.polls ??= {};
settings.applicationReviewChannelIds ??= {};
settings.applications ??= {};

const closingTicketChannels = new Set();
const activeActionLocks = new Set();

const ticketTypes = {
  general: 'General support',
  purchase: 'Purchase or billing',
  report: 'Report a player',
  partnership: 'Partnership',
};

function saveSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function takeActionLock(key) {
  if (activeActionLocks.has(key)) return false;
  activeActionLocks.add(key);
  return true;
}

function releaseActionLock(key) {
  activeActionLocks.delete(key);
}

async function sendLog(guild, title, description, files = [], logType = 'general') {
  const channelId = logType === 'ticket'
    ? settings.ticketLogChannelIds[guild.id]
    : settings.logChannelIds[guild.id];
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

function rulesPanelEmbeds() {
  const author = { name: 'CORE. client', iconURL: client.user.displayAvatarURL() };
  return [
    new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setAuthor(author)
      .setTitle('Community guidelines')
      .setDescription('Welcome to **CORE. client**. Keep this space calm, welcoming, and safe for everyone. By participating here, you agree to follow these guidelines.')
      .setThumbnail(client.user.displayAvatarURL())
      .addFields(
        { name: '01  Be respectful', value: 'Treat everyone with respect. Disagreement is fine; harassment, baiting, bullying, or targeted negativity is not.' },
        { name: '02  Keep it appropriate', value: 'No hate speech, discrimination, sexual content, real-world threats, or content intended to harm others.' },
        { name: '03  No spam or advertising', value: 'Do not flood channels, repeatedly tag people, promote servers or products, or send suspicious links without staff approval.' },
        { name: '04  Protect privacy', value: 'Never share personal information, private messages, images, or recordings of someone else without their permission.' },
      )
      .setFooter({ text: 'CORE. client  •  Community guidelines' }),
    new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setAuthor(author)
      .setTitle('A good experience for everyone')
      .addFields(
        { name: '05  Use channels correctly', value: 'Keep conversations on topic and use the right channel for your message. Do not repeatedly join and leave voice channels.' },
        { name: '06  Voice chat etiquette', value: 'Use a clear and respectful microphone. No earrape, disruptive soundboard spam, or deliberately disturbing other members.' },
        { name: '07  Follow staff guidance', value: 'Staff decisions keep the community safe. If you have a concern, please open a private ticket instead of arguing in public.' },
        { name: '08  Report problems safely', value: 'If you see scams, harassment, unsafe content, or a rule violation, report it to staff through a ticket.' },
      )
      .setFooter({ text: 'Thank you for helping us keep CORE. client safe.' }),
  ];
}

function suggestionStatusLabel(status) {
  return ({
    open: 'Open for voting',
    review: 'Under review',
    planned: 'Planned',
    progress: 'In progress',
    shipped: 'Shipped',
    not_planned: 'Not planned',
  })[status] || 'Open for voting';
}

function suggestionIsFinal(suggestion) {
  return ['shipped', 'not_planned'].includes(suggestion.status);
}

function suggestionVoteCounts(suggestion) {
  const votes = Object.values(suggestion.votes || {});
  return {
    support: votes.filter((vote) => vote === 'support').length,
    pass: votes.filter((vote) => vote === 'pass').length,
  };
}

function canUseSuggestions(member) {
  const requiredRoleId = settings.suggestionRoleIds[member.guild.id];
  return !requiredRoleId || member.roles.cache.has(requiredRoleId) || canManageBot(member);
}

function suggestionPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
    .setTitle('Share an idea')
    .setDescription('Have an idea that could make CORE. client better? Share it with the community, let members vote, and the team will keep everyone updated.')
    .addFields(
      { name: '01  Share', value: 'Describe the idea and why it would help.' },
      { name: '02  Vote', value: 'Members can support an idea or mark it as not for them.' },
      { name: '03  Follow', value: 'Staff will share the current status and any team update.' },
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: 'CORE. client  •  Suggestions' });
}

function suggestionPanelActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('suggestion_open:public').setLabel('Submit a Suggestion').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('suggestion_open:anonymous').setLabel('Submit Anonymously').setStyle(ButtonStyle.Secondary),
  );
}

function suggestionPublicActions(suggestion) {
  const disabled = suggestionIsFinal(suggestion);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('suggestion_vote:support').setLabel('Support').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('suggestion_vote:pass').setLabel('Not for me').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('suggestion_vote:remove').setLabel('Remove vote').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('suggestion_discuss').setLabel('Discuss').setStyle(ButtonStyle.Primary).setDisabled(disabled),
  );
}

function suggestionStaffActions(suggestion) {
  const disabled = suggestionIsFinal(suggestion);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('suggestion_staff_status:review').setLabel('Review').setStyle(ButtonStyle.Primary).setDisabled(disabled || suggestion.status === 'review'),
      new ButtonBuilder().setCustomId('suggestion_staff_status:planned').setLabel('Plan').setStyle(ButtonStyle.Success).setDisabled(disabled || suggestion.status === 'planned'),
      new ButtonBuilder().setCustomId('suggestion_staff_status:progress').setLabel('In Progress').setStyle(ButtonStyle.Primary).setDisabled(disabled || suggestion.status === 'progress'),
      new ButtonBuilder().setCustomId('suggestion_staff_status:shipped').setLabel('Shipped').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId('suggestion_staff_status:not_planned').setLabel('Not Planned').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('suggestion_staff_note').setLabel('Add or Edit Team Note').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ),
  ];
}

function suggestionPublicEmbed(suggestion) {
  const votes = suggestionVoteCounts(suggestion);
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({
      name: suggestion.anonymous ? 'Anonymous suggestion' : `Suggestion from ${suggestion.authorName}`,
      iconURL: suggestion.anonymous ? client.user.displayAvatarURL() : suggestion.authorAvatar,
    })
    .setTitle(`[${suggestion.category}] ${suggestion.title}`.slice(0, 256))
    .setDescription(suggestion.details.slice(0, 4096))
    .addFields(
      { name: 'Support', value: String(votes.support), inline: true },
      { name: 'Not for me', value: String(votes.pass), inline: true },
      { name: 'Status', value: suggestionStatusLabel(suggestion.status), inline: true },
      ...(suggestion.teamNote ? [{ name: 'Team update', value: suggestion.teamNote.slice(0, 1024) }] : []),
    )
    .setFooter({ text: 'One vote per member  •  CORE. client' })
    .setTimestamp(suggestion.createdAt);
}

function suggestionStaffEmbed(suggestion) {
  const votes = suggestionVoteCounts(suggestion);
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: `Private review  •  ${suggestion.authorName}`, iconURL: suggestion.authorAvatar })
    .setTitle(`[${suggestion.category}] ${suggestion.title}`.slice(0, 256))
    .setDescription(suggestion.details.slice(0, 4096))
    .addFields(
      { name: 'Submitted by', value: `${suggestion.authorName}\nID: ${suggestion.authorId}`, inline: true },
      { name: 'Public visibility', value: suggestion.anonymous ? 'Anonymous' : 'Named', inline: true },
      { name: 'Votes', value: `Support: **${votes.support}**\nNot for me: **${votes.pass}**`, inline: true },
      { name: 'Status', value: suggestionStatusLabel(suggestion.status), inline: true },
      ...(suggestion.teamNote ? [{ name: 'Team note', value: suggestion.teamNote.slice(0, 1024) }] : []),
    )
    .setFooter({ text: suggestion.staffName ? `Updated by ${suggestion.staffName}  •  CORE. client` : 'CORE. client  •  Private staff review' })
    .setTimestamp(suggestion.createdAt);
}

function suggestionForm(anonymous = false) {
  const category = new TextInputBuilder()
    .setCustomId('category')
    .setLabel('Category')
    .setPlaceholder('For example: Feature, event, community, or server')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(50)
    .setRequired(true);
  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('What is your idea?')
    .setPlaceholder('For example: Add a community event channel')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  const details = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Tell us why this would help')
    .setPlaceholder('Explain the idea in a little more detail...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`suggestion_submit:${anonymous ? 'anonymous' : 'public'}`)
    .setTitle('New suggestion')
    .addComponents(
      new ActionRowBuilder().addComponents(category),
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(details),
    );
}

function suggestionNoteForm(suggestion, status) {
  const note = new TextInputBuilder()
    .setCustomId('note')
    .setLabel(status === 'not_planned' ? 'Why is this not planned?' : 'Team update')
    .setPlaceholder(status === 'not_planned' ? 'Write a clear, respectful explanation...' : 'Share a short update for the community...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`suggestion_note:${status}:${suggestion.publicMessageId}`)
    .setTitle('Suggestion team update')
    .addComponents(new ActionRowBuilder().addComponents(note));
}

async function updatePublicSuggestion(suggestion) {
  const channel = await client.channels.fetch(suggestion.publicChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(suggestion.publicMessageId).catch(() => null);
  if (message) await message.edit({ embeds: [suggestionPublicEmbed(suggestion)], components: [suggestionPublicActions(suggestion)] });
}

async function updateStaffSuggestion(suggestion) {
  const channel = await client.channels.fetch(suggestion.staffChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(suggestion.staffMessageId).catch(() => null);
  if (message) await message.edit({ embeds: [suggestionStaffEmbed(suggestion)], components: suggestionStaffActions(suggestion) });
}

async function deleteSuggestionArtifacts(suggestion) {
  const messages = [
    [suggestion.publicChannelId, suggestion.publicMessageId],
    [suggestion.staffChannelId, suggestion.staffMessageId],
  ];
  for (const [channelId, messageId] of messages) {
    if (!channelId || !messageId) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (message) await message.delete().catch(() => {});
  }
  if (suggestion.threadId) {
    const thread = await client.channels.fetch(suggestion.threadId).catch(() => null);
    if (thread?.delete) await thread.delete('Suggestion test data reset').catch(() => {});
  }
}

async function sendSuggestionStatusDm(suggestion) {
  const user = await client.users.fetch(suggestion.authorId).catch(() => null);
  if (!user) return;
  await user.send({
    embeds: [new EmbedBuilder()
      .setColor(0xF5F5F7)
      .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
      .setTitle('Suggestion update')
      .setDescription(`Your suggestion **${suggestion.title}** is now **${suggestionStatusLabel(suggestion.status)}**.`)
      .setFooter({ text: 'CORE. client' })],
  }).catch(() => {});
}

function suggestionSubmissionBlockReason(guildId, userId) {
  const userSuggestions = Object.values(settings.suggestions)
    .filter((suggestion) => suggestion.guildId === guildId && suggestion.authorId === userId);
  const activeCount = userSuggestions.filter((suggestion) => !suggestionIsFinal(suggestion)).length;
  if (activeCount >= 2) return 'You already have two active suggestions. Please wait for a team update before submitting another one.';
  const lastSubmittedAt = Math.max(0, ...userSuggestions.map((suggestion) => suggestion.createdAt || 0));
  const cooldownMs = 1 * 60 * 60 * 1000;
  if (lastSubmittedAt && Date.now() - lastSubmittedAt < cooldownMs) {
    const minutes = Math.ceil((cooldownMs - (Date.now() - lastSubmittedAt)) / 60000);
    return `Please wait **${minutes} minutes** before sending another suggestion.`;
  }
  return null;
}

function giveawayEmbed(giveaway) {
  const ended = Boolean(giveaway.ended);
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
    .setTitle(ended ? 'Giveaway ended' : 'Giveaway')
    .setDescription(ended
      ? `**Prize**\n${giveaway.prize}\n\nThe winners have been announced below.`
      : `**Prize**\n${giveaway.prize}\n\nPress **Enter Giveaway** below to take part.\nEnds <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`)
    .addFields(
      { name: 'Entries', value: String(giveaway.entries.length), inline: true },
      { name: 'Winners', value: String(giveaway.winnerCount), inline: true },
      { name: 'Hosted by', value: giveaway.hostName, inline: true },
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: ended ? 'CORE. client  •  Giveaway complete' : 'CORE. client  •  Good luck' });
}

function giveawayActions(ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_enter').setLabel(ended ? 'Giveaway ended' : 'Enter Giveaway').setStyle(ButtonStyle.Primary).setDisabled(ended),
    new ButtonBuilder().setCustomId('giveaway_leave').setLabel('Leave Giveaway').setStyle(ButtonStyle.Secondary).setDisabled(ended),
    new ButtonBuilder().setCustomId('giveaway_end').setLabel('End Giveaway').setStyle(ButtonStyle.Danger).setDisabled(ended),
  );
}

function chooseGiveawayWinners(entries, count) {
  const pool = [...entries];
  const winners = [];
  while (pool.length && winners.length < count) winners.push(pool.splice(randomInt(pool.length), 1)[0]);
  return winners;
}

async function finishGiveaway(messageId, giveaway) {
  if (giveaway.ended) return;
  giveaway.ended = true;
  giveaway.endedAt = Date.now();
  giveaway.winnerIds = chooseGiveawayWinners(giveaway.entries, giveaway.winnerCount);
  saveSettings();

  const guild = client.guilds.cache.get(giveaway.guildId);
  const channel = guild ? await guild.channels.fetch(giveaway.channelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) await message.edit({ embeds: [giveawayEmbed(giveaway)], components: [giveawayActions(true)] }).catch(() => {});

  const result = giveaway.winnerIds.length
    ? `Congratulations ${giveaway.winnerIds.map((id) => `<@${id}>`).join(', ')} — you won **${giveaway.prize}**!`
    : `The giveaway for **${giveaway.prize}** ended with no entries.`;
  await channel.send({ content: result, allowedMentions: { parse: [], users: giveaway.winnerIds } }).catch(() => {});
  await sendLog(guild, 'Giveaway ended', `Prize: **${giveaway.prize}**\nEntries: **${giveaway.entries.length}**`).catch(() => {});
}

async function finishDueGiveaways() {
  const now = Date.now();
  for (const [messageId, giveaway] of Object.entries(settings.giveaways)) {
    if (!giveaway.ended && giveaway.endsAt <= now) await finishGiveaway(messageId, giveaway).catch((error) => console.error('Giveaway:', error.message));
  }
}

function pollEmbed(poll) {
  const votes = Object.values(poll.votes);
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
    .setTitle('Poll')
    .setDescription(`**${poll.question}**\n\nChoose one option below. You can change your vote at any time.`)
    .addFields(poll.options.map((option, index) => ({
      name: `${index + 1}. ${option}`.slice(0, 256),
      value: `**${votes.filter((vote) => vote === index).length}** vote(s)`,
      inline: false,
    })))
    .setFooter({ text: `${votes.length} total vote(s)  •  CORE. client` });
}

function pollActions(poll) {
  return new ActionRowBuilder().addComponents(poll.options.map((option, index) => new ButtonBuilder()
    .setCustomId(`poll_vote:${index}`)
    .setLabel(option.slice(0, 80))
    .setStyle(ButtonStyle.Secondary)));
}

function applicationStatusLabel(status) {
  return ({ pending: 'Pending review', claimed: 'Claimed by staff', accepted: 'Accepted', declined: 'Declined' })[status] || 'Pending review';
}

function applicationPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
    .setTitle('Applications')
    .setDescription('Interested in joining or working with CORE. client? Send a private application to our team.')
    .addFields(
      { name: 'Private by default', value: 'Your answers are sent only to the staff review channel.' },
      { name: 'Take your time', value: 'Give clear and honest answers so the team can review your application fairly.' },
    )
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: 'CORE. client  •  Applications' });
}

function applicationActions(status = 'pending') {
  const isFinal = ['accepted', 'declined'].includes(status);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('application_status:claimed').setLabel('Claim').setStyle(ButtonStyle.Primary).setDisabled(isFinal || status === 'claimed'),
    new ButtonBuilder().setCustomId('application_status:accepted').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(isFinal),
    new ButtonBuilder().setCustomId('application_status:declined').setLabel('Decline').setStyle(ButtonStyle.Danger).setDisabled(isFinal),
  );
}

function applicationEmbed(application) {
  return new EmbedBuilder()
    .setColor(0xF5F5F7)
    .setAuthor({ name: `Application from ${application.authorName}`, iconURL: application.authorAvatar })
    .setTitle(application.position.slice(0, 256))
    .addFields(
      { name: 'Experience', value: application.experience.slice(0, 1024) },
      { name: 'Availability', value: application.availability.slice(0, 1024) },
      { name: 'Why should we choose you?', value: application.reason.slice(0, 1024) },
      { name: 'Status', value: applicationStatusLabel(application.status), inline: true },
    )
    .setFooter({ text: application.staffName ? `Reviewed by ${application.staffName}  •  CORE. client` : 'CORE. client  •  Applications' })
    .setTimestamp(application.createdAt);
}

function applicationForm() {
  const position = new TextInputBuilder().setCustomId('position').setLabel('What are you applying for?').setPlaceholder('For example: Staff member or partnership').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true);
  const experience = new TextInputBuilder().setCustomId('experience').setLabel('Relevant experience').setPlaceholder('Tell us about relevant skills or experience...').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true);
  const availability = new TextInputBuilder().setCustomId('availability').setLabel('Your availability and timezone').setPlaceholder('For example: CET, available evenings and weekends').setStyle(TextInputStyle.Short).setMaxLength(200).setRequired(true);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Why should we choose you?').setPlaceholder('Tell us why you would be a good fit...').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true);
  return new ModalBuilder()
    .setCustomId('application_submit')
    .setTitle('New application')
    .addComponents(
      new ActionRowBuilder().addComponents(position),
      new ActionRowBuilder().addComponents(experience),
      new ActionRowBuilder().addComponents(availability),
      new ActionRowBuilder().addComponents(reason),
    );
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
  if (closingTicketChannels.has(interaction.channelId)) {
    return interaction.reply({ content: 'This ticket is already closing.', ephemeral: true });
  }
  closingTicketChannels.add(interaction.channelId);

  try {
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
      'ticket',
    ).catch((error) => console.error('Ticket log:', error.message));

    await interaction.reply(transcriptSent ? 'This ticket will close in 5 seconds. A transcript has been sent by DM.' : 'This ticket will close in 5 seconds.');
    setTimeout(async () => {
      try {
        await interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`);
      } catch (error) {
        console.error(error);
      } finally {
        closingTicketChannels.delete(interaction.channelId);
      }
    }, 5000);
  } catch (error) {
    closingTicketChannels.delete(interaction.channelId);
    throw error;
  }
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
  const lockKey = `ticket-create:${interaction.guild.id}:${interaction.user.id}`;
  if (!takeActionLock(lockKey)) return interaction.editReply('A ticket is already being created for you.');
  try {
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
    [],
    'ticket',
    ).catch((error) => console.error('Ticket log:', error.message));
    await interaction.editReply(`Your ticket has been opened: ${channel}`);
  } finally {
    releaseActionLock(lockKey);
  }
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
  await finishDueGiveaways();
  setInterval(() => finishDueGiveaways().catch((error) => console.error('Giveaway check:', error.message)), 30 * 1000).unref();
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
      if (interaction.commandName === 'server-status') {
        if (!(await isSupport(interaction.member))) {
          return interaction.reply({ content: 'This private server overview is only available to staff.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const channels = await interaction.guild.channels.fetch();
        const openTickets = channels.filter((channel) => channel.isTextBased() && channel.topic?.startsWith('ticket-owner:')).size;
        const temporaryVoiceRooms = Object.keys(settings.temporaryVoiceChannels)
          .filter((channelId) => channels.get(channelId)?.guild?.id === interaction.guild.id).length;
        const activeGiveaways = Object.values(settings.giveaways)
          .filter((giveaway) => giveaway.guildId === interaction.guild.id && !giveaway.ended && giveaway.endsAt > Date.now()).length;
        const openSuggestions = Object.values(settings.suggestions)
          .filter((suggestion) => suggestion.guildId === interaction.guild.id && !suggestionIsFinal(suggestion)).length;
        const supportRoleId = await ensureSupportRole(interaction.guild);
        const supportRole = interaction.guild.roles.cache.get(supportRoleId);
        const supportCount = supportRole?.members.size || 0;
        const embed = new EmbedBuilder()
          .setColor(0xF5F5F7)
          .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
          .setTitle('Server overview')
          .setDescription(`Private staff overview for **${interaction.guild.name}**.`)
          .addFields(
            { name: 'Members', value: `**${interaction.guild.memberCount}** total`, inline: true },
            { name: 'Open tickets', value: `**${openTickets}** active`, inline: true },
            { name: 'Support team', value: `**${supportCount}** members`, inline: true },
            { name: 'Temporary voice rooms', value: `**${temporaryVoiceRooms}** active`, inline: true },
            { name: 'Active giveaways', value: `**${activeGiveaways}** running`, inline: true },
            { name: 'Open suggestions', value: `**${openSuggestions}** awaiting a final decision`, inline: true },
          )
          .setFooter({ text: 'CORE. client  •  Visible to staff only' })
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      const managementCommands = new Set([
        'ticketpaneel',
        'rulepanel',
        'suggestionpanel',
        'set-suggestion-channel',
        'set-suggestion-staff-channel',
        'set-suggestion-role',
        'reset-suggestion-data',
        'set-ticket-category',
        'set-tiktok-feed',
        'remove-tiktok-feed',
        'set-join-to-create',
        'set-auto-role',
        'set-log-channel',
        'set-ticket-log-channel',
        'applicationpanel',
        'set-application-review-channel',
        'rolepanel',
        'giveaway',
        'poll',
      ]);
      if (managementCommands.has(interaction.commandName) && !canManageBot(interaction.member)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      }
      if (interaction.commandName === 'ticketpaneel') {
        await interaction.channel.send({ embeds: [ticketPanelEmbed()], components: [openRow] });
        await interaction.reply({ content: 'Ticket panel posted.', ephemeral: true });
      }
      if (interaction.commandName === 'rulepanel') {
        await interaction.channel.send({ embeds: rulesPanelEmbeds(), allowedMentions: { parse: [] } });
        await interaction.reply({ content: 'Rules panel posted.', ephemeral: true });
      }
      if (interaction.commandName === 'suggestionpanel') {
        if (!settings.suggestionChannelIds[interaction.guild.id] || !settings.suggestionStaffChannelIds[interaction.guild.id]) {
          return interaction.reply({ content: 'Set both the public suggestion channel and private staff channel first.', ephemeral: true });
        }
        await interaction.channel.send({ embeds: [suggestionPanelEmbed()], components: [suggestionPanelActions()], allowedMentions: { parse: [] } });
        await interaction.reply({ content: 'Suggestion panel posted.', ephemeral: true });
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
      if (interaction.commandName === 'set-suggestion-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.suggestionChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Public suggestions will now be posted in ${channel}.`, ephemeral: true });
        } else {
          delete settings.suggestionChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Suggestions have been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-suggestion-staff-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.suggestionStaffChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Private suggestion reviews will now be sent to ${channel}.`, ephemeral: true });
        } else {
          delete settings.suggestionStaffChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Private suggestion reviews have been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-suggestion-role') {
        const role = interaction.options.getRole('role');
        if (role) {
          settings.suggestionRoleIds[interaction.guild.id] = role.id;
          saveSettings();
          await interaction.reply({ content: `Only members with **${role.name}** can now submit and vote on suggestions.`, ephemeral: true });
        } else {
          delete settings.suggestionRoleIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'All members can now submit and vote on suggestions.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'reset-suggestion-data') {
        const member = interaction.options.getUser('member') || interaction.user;
        const matchingSuggestions = Object.entries(settings.suggestions)
          .filter(([, suggestion]) => suggestion.guildId === interaction.guild.id && suggestion.authorId === member.id);
        if (!matchingSuggestions.length) {
          return interaction.reply({ content: `No suggestion data was found for **${member.username}**.`, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        for (const [suggestionId, suggestion] of matchingSuggestions) {
          await deleteSuggestionArtifacts(suggestion);
          delete settings.suggestions[suggestionId];
        }
        saveSettings();
        await sendLog(
          interaction.guild,
          'Suggestion test data reset',
          `Member: **${member.username}**\nRemoved: **${matchingSuggestions.length}** suggestion record(s)\nBy: **${interaction.user.username}**`,
        ).catch(() => {});
        return interaction.editReply(`Removed **${matchingSuggestions.length}** suggestion record(s) for **${member.username}**. Their suggestion cooldown has been cleared.`);
      }
      if (interaction.commandName === 'set-log-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.logChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `General bot activity will now be saved in ${channel}.`, ephemeral: true });
        } else {
          delete settings.logChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'General bot activity logs have been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-ticket-log-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.ticketLogChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Ticket activity and transcripts will now be saved in ${channel}.`, ephemeral: true });
        } else {
          delete settings.ticketLogChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Ticket activity logs and transcripts have been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'set-application-review-channel') {
        const channel = interaction.options.getChannel('channel');
        if (channel) {
          settings.applicationReviewChannelIds[interaction.guild.id] = channel.id;
          saveSettings();
          await interaction.reply({ content: `Applications will now be sent privately to ${channel}.`, ephemeral: true });
        } else {
          delete settings.applicationReviewChannelIds[interaction.guild.id];
          saveSettings();
          await interaction.reply({ content: 'Applications have been disabled.', ephemeral: true });
        }
      }
      if (interaction.commandName === 'applicationpanel') {
        if (!settings.applicationReviewChannelIds[interaction.guild.id]) {
          return interaction.reply({ content: 'Set a private application review channel first with /set-application-review-channel.', ephemeral: true });
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('application_open').setLabel('Start Application').setStyle(ButtonStyle.Primary),
        );
        await interaction.channel.send({ embeds: [applicationPanelEmbed()], components: [row], allowedMentions: { parse: [] } });
        await interaction.reply({ content: 'Application panel posted.', ephemeral: true });
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
      if (interaction.commandName === 'giveaway') {
        if (!interaction.channel?.isTextBased()) return interaction.reply({ content: 'Giveaways can only be posted in a text channel.', ephemeral: true });
        const giveaway = {
          guildId: interaction.guild.id,
          channelId: interaction.channel.id,
          prize: interaction.options.getString('prize', true).trim().slice(0, 1000),
          endsAt: Date.now() + (interaction.options.getInteger('duration', true) * 60 * 1000),
          winnerCount: interaction.options.getInteger('winners') || 1,
          hostId: interaction.user.id,
          hostName: interaction.user.username,
          entries: [],
          ended: false,
        };
        const message = await interaction.channel.send({ embeds: [giveawayEmbed(giveaway)], components: [giveawayActions()], allowedMentions: { parse: [] } });
        settings.giveaways[message.id] = giveaway;
        saveSettings();
        await sendLog(interaction.guild, 'Giveaway started', `Prize: **${giveaway.prize}**\nHosted by: **${interaction.user.username}**`).catch(() => {});
        await interaction.reply({ content: 'Giveaway posted.', ephemeral: true });
      }
      if (interaction.commandName === 'poll') {
        if (!interaction.channel?.isTextBased()) return interaction.reply({ content: 'Polls can only be posted in a text channel.', ephemeral: true });
        const options = ['option1', 'option2', 'option3', 'option4', 'option5']
          .map((name) => interaction.options.getString(name))
          .filter(Boolean)
          .map((option) => option.trim().slice(0, 80));
        if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
          return interaction.reply({ content: 'Every poll option must be different.', ephemeral: true });
        }
        const poll = {
          question: interaction.options.getString('question', true).trim().slice(0, 1000),
          options,
          votes: {},
        };
        const message = await interaction.channel.send({ embeds: [pollEmbed(poll)], components: [pollActions(poll)], allowedMentions: { parse: [] } });
        settings.polls[message.id] = poll;
        saveSettings();
        await sendLog(interaction.guild, 'Poll posted', `Question: **${poll.question}**\nPosted by: **${interaction.user.username}**`).catch(() => {});
        await interaction.reply({ content: 'Poll posted.', ephemeral: true });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'suggestion_open' || interaction.customId.startsWith('suggestion_open:')) {
        if (!settings.suggestionChannelIds[interaction.guild.id] || !settings.suggestionStaffChannelIds[interaction.guild.id]) {
          return interaction.reply({ content: 'Suggestions are not configured yet. Please contact staff.', ephemeral: true });
        }
        if (!canUseSuggestions(interaction.member)) return interaction.reply({ content: 'You need the verified member role before you can submit suggestions.', ephemeral: true });
        const blockReason = suggestionSubmissionBlockReason(interaction.guild.id, interaction.user.id);
        if (blockReason) return interaction.reply({ content: blockReason, ephemeral: true });
        return interaction.showModal(suggestionForm(interaction.customId.endsWith(':anonymous')));
      }
      if (interaction.customId.startsWith('suggestion_vote:')) {
        const suggestion = settings.suggestions[interaction.message.id];
        const vote = interaction.customId.split(':')[1];
        if (!suggestion || suggestionIsFinal(suggestion)) return interaction.reply({ content: 'Voting on this suggestion has ended.', ephemeral: true });
        if (!canUseSuggestions(interaction.member)) return interaction.reply({ content: 'You need the verified member role before you can vote.', ephemeral: true });
        if (!['support', 'pass', 'remove'].includes(vote)) return interaction.reply({ content: 'Unknown vote.', ephemeral: true });
        const lockKey = `suggestion-vote:${interaction.message.id}:${interaction.user.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'Your vote is already being updated.', ephemeral: true });
        try {
          suggestion.votes ??= {};
          if (vote === 'remove') {
            if (!suggestion.votes[interaction.user.id]) return interaction.reply({ content: 'You do not have a vote to remove.', ephemeral: true });
            delete suggestion.votes[interaction.user.id];
          } else {
            suggestion.votes[interaction.user.id] = vote;
          }
          saveSettings();
          await interaction.update({ embeds: [suggestionPublicEmbed(suggestion)], components: [suggestionPublicActions(suggestion)] });
          await updateStaffSuggestion(suggestion).catch(() => {});
          return;
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId === 'suggestion_discuss') {
        const suggestion = settings.suggestions[interaction.message.id];
        if (!suggestion || suggestionIsFinal(suggestion)) return interaction.reply({ content: 'Discussion is no longer available for this suggestion.', ephemeral: true });
        if (!canUseSuggestions(interaction.member)) return interaction.reply({ content: 'You need the verified member role before you can discuss suggestions.', ephemeral: true });
        if (suggestion.threadId) return interaction.reply({ content: `Join the discussion here: <#${suggestion.threadId}>`, ephemeral: true });
        const lockKey = `suggestion-discuss:${interaction.message.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'The discussion is already being created.', ephemeral: true });
        try {
          await interaction.deferReply({ ephemeral: true });
          const thread = await interaction.message.startThread({
            name: `suggestion-${suggestion.title}`.replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 90) || 'suggestion-discussion',
            autoArchiveDuration: 1440,
            reason: `Discussion started by ${interaction.user.tag}`,
          });
          suggestion.threadId = thread.id;
          saveSettings();
          return interaction.editReply(`Discussion created: ${thread}`);
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId.startsWith('suggestion_staff_status:')) {
        if (!canManageBot(interaction.member)) return interaction.reply({ content: 'You do not have permission to review suggestions.', ephemeral: true });
        const suggestion = Object.values(settings.suggestions).find((item) => item.staffMessageId === interaction.message.id);
        const status = interaction.customId.split(':')[1];
        if (!suggestion || !['review', 'planned', 'progress', 'shipped', 'not_planned'].includes(status)) {
          return interaction.reply({ content: 'This suggestion is no longer being tracked.', ephemeral: true });
        }
        if (suggestionIsFinal(suggestion)) return interaction.reply({ content: 'This suggestion has already received a final decision.', ephemeral: true });
        if (suggestion.status === status) return interaction.reply({ content: `This suggestion is already **${suggestionStatusLabel(status)}**.`, ephemeral: true });
        if (status === 'not_planned') return interaction.showModal(suggestionNoteForm(suggestion, status));
        const lockKey = `suggestion-staff:${suggestion.publicMessageId}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'This suggestion is already being updated.', ephemeral: true });
        try {
          suggestion.status = status;
          suggestion.staffName = interaction.user.username;
          saveSettings();
          await interaction.update({ embeds: [suggestionStaffEmbed(suggestion)], components: suggestionStaffActions(suggestion) });
          await updatePublicSuggestion(suggestion).catch(() => {});
          await sendLog(interaction.guild, 'Suggestion reviewed', `Suggestion: **${suggestion.title}**\nStatus: **${suggestionStatusLabel(status)}**\nBy: **${interaction.user.username}**`).catch(() => {});
          await sendSuggestionStatusDm(suggestion);
          return;
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId === 'suggestion_staff_note') {
        if (!canManageBot(interaction.member)) return interaction.reply({ content: 'You do not have permission to update suggestions.', ephemeral: true });
        const suggestion = Object.values(settings.suggestions).find((item) => item.staffMessageId === interaction.message.id);
        if (!suggestion || suggestionIsFinal(suggestion)) return interaction.reply({ content: 'This suggestion can no longer be updated.', ephemeral: true });
        return interaction.showModal(suggestionNoteForm(suggestion, suggestion.status));
      }
      if (interaction.customId === 'giveaway_enter') {
        const giveaway = settings.giveaways[interaction.message.id];
        if (!giveaway || giveaway.ended || giveaway.endsAt <= Date.now()) {
          if (giveaway && !giveaway.ended) await finishGiveaway(interaction.message.id, giveaway).catch(() => {});
          return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
        }
        if (giveaway.entries.includes(interaction.user.id)) return interaction.reply({ content: 'You have already entered this giveaway.', ephemeral: true });
        const lockKey = `giveaway:${interaction.message.id}:${interaction.user.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'Your giveaway entry is already being processed.', ephemeral: true });
        try {
          giveaway.entries.push(interaction.user.id);
          saveSettings();
          return interaction.update({ embeds: [giveawayEmbed(giveaway)], components: [giveawayActions()] });
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId === 'giveaway_leave') {
        const giveaway = settings.giveaways[interaction.message.id];
        if (!giveaway || giveaway.ended || giveaway.endsAt <= Date.now()) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
        if (!giveaway.entries.includes(interaction.user.id)) return interaction.reply({ content: 'You have not entered this giveaway.', ephemeral: true });
        const lockKey = `giveaway:${interaction.message.id}:${interaction.user.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'Your giveaway entry is already being updated.', ephemeral: true });
        try {
          giveaway.entries = giveaway.entries.filter((id) => id !== interaction.user.id);
          saveSettings();
          return interaction.update({ embeds: [giveawayEmbed(giveaway)], components: [giveawayActions()] });
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId === 'giveaway_end') {
        const giveaway = settings.giveaways[interaction.message.id];
        if (!giveaway || giveaway.ended) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
        if (interaction.user.id !== giveaway.hostId && !canManageBot(interaction.member)) {
          return interaction.reply({ content: 'Only the giveaway host or staff can end this giveaway.', ephemeral: true });
        }
        const lockKey = `giveaway-end:${interaction.message.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'This giveaway is already ending.', ephemeral: true });
        try {
          await interaction.deferUpdate();
          await finishGiveaway(interaction.message.id, giveaway);
          return;
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId.startsWith('poll_vote:')) {
        const poll = settings.polls[interaction.message.id];
        const index = Number(interaction.customId.split(':')[1]);
        if (!poll || !Number.isInteger(index) || !poll.options[index]) return interaction.reply({ content: 'This poll is no longer active.', ephemeral: true });
        const lockKey = `poll:${interaction.message.id}:${interaction.user.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'Your vote is already being updated.', ephemeral: true });
        try {
          poll.votes[interaction.user.id] = index;
          saveSettings();
          return interaction.update({ embeds: [pollEmbed(poll)], components: [pollActions(poll)] });
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId === 'application_open') {
        if (!settings.applicationReviewChannelIds[interaction.guild.id]) {
          return interaction.reply({ content: 'Applications are not configured yet. Please contact staff.', ephemeral: true });
        }
        const hasActiveApplication = Object.values(settings.applications).some((application) =>
          application.guildId === interaction.guild.id
          && application.authorId === interaction.user.id
          && ['pending', 'claimed'].includes(application.status));
        if (hasActiveApplication) return interaction.reply({ content: 'You already have an application under review.', ephemeral: true });
        return interaction.showModal(applicationForm());
      }
      if (interaction.customId.startsWith('application_status:')) {
        if (!canManageBot(interaction.member)) return interaction.reply({ content: 'You do not have permission to review applications.', ephemeral: true });
        const application = settings.applications[interaction.message.id];
        const status = interaction.customId.split(':')[1];
        if (!application || !['claimed', 'accepted', 'declined'].includes(status)) {
          return interaction.reply({ content: 'This application is no longer being tracked.', ephemeral: true });
        }
        if (['accepted', 'declined'].includes(application.status)) return interaction.reply({ content: 'This application has already received a final decision.', ephemeral: true });
        if (application.status === status) return interaction.reply({ content: `This application is already **${applicationStatusLabel(status)}**.`, ephemeral: true });
        const lockKey = `application:${interaction.message.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'This application is already being updated.', ephemeral: true });
        try {
          application.status = status;
          application.staffName = interaction.user.username;
          saveSettings();
          await interaction.update({ embeds: [applicationEmbed(application)], components: [applicationActions(status)] });
          await sendLog(interaction.guild, 'Application reviewed', `Application: **${application.position}**\nStatus: **${applicationStatusLabel(status)}**\nBy: **${interaction.user.username}**`).catch(() => {});
          if (['accepted', 'declined'].includes(status)) {
            const applicant = await client.users.fetch(application.authorId).catch(() => null);
            if (applicant) await applicant.send({
              embeds: [new EmbedBuilder()
                .setColor(0xF5F5F7)
                .setAuthor({ name: 'CORE. client', iconURL: client.user.displayAvatarURL() })
                .setTitle('Application update')
                .setDescription(`Your application for **${application.position}** has been **${status}**.`)
                .setFooter({ text: 'CORE. client' })],
            }).catch(() => {});
          }
          return;
        } finally {
          releaseActionLock(lockKey);
        }
      }
      if (interaction.customId === 'ticket_close') return closeTicket(interaction);
      if (interaction.customId === 'ticket_claim') {
        if (!(await isSupport(interaction.member))) {
          return interaction.reply({ content: 'Only the support team can claim tickets.', ephemeral: true });
        }
        if (interaction.message.embeds[0]?.footer?.text?.startsWith('Claimed by')) {
          return interaction.reply({ content: 'This ticket has already been claimed.', ephemeral: true });
        }
        const lockKey = `ticket-claim:${interaction.message.id}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'This ticket is already being claimed.', ephemeral: true });
        try {
          const claimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setFooter({ text: `Claimed by ${interaction.user.tag}` });
          await sendLog(interaction.guild, 'Ticket claimed', `Ticket: **${interaction.channel.name}**\nClaimed by: **${interaction.user.username}**`, [], 'ticket').catch((error) => console.error('Ticket log:', error.message));
          return interaction.update({ embeds: [claimedEmbed], components: [ticketActions(interaction.user.username)] });
        } finally {
          releaseActionLock(lockKey);
        }
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
        const lockKey = `voice-close:${interaction.channelId}`;
        if (!takeActionLock(lockKey)) return interaction.reply({ content: 'This voice room is already closing.', ephemeral: true });
        try {
          await interaction.reply({ content: 'This voice room will close in 3 seconds.', ephemeral: true });
          await sendLog(interaction.guild, 'Voice room closed', `Room: **${interaction.channel.name}**\nClosed by: **${interaction.user.username}**`).catch((error) => console.error('Voice log:', error.message));
          delete settings.temporaryVoiceChannels[interaction.channelId];
          saveSettings();
          setTimeout(async () => {
            try {
              await interaction.channel.delete('Temporary voice room closed by its owner');
            } catch (error) {
              console.error(error);
            } finally {
              releaseActionLock(lockKey);
            }
          }, 3000);
          return;
        } catch (error) {
          releaseActionLock(lockKey);
          throw error;
        }
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('suggestion_submit:')) {
      if (!canUseSuggestions(interaction.member)) return interaction.reply({ content: 'You need the verified member role before you can submit suggestions.', ephemeral: true });
      const lockKey = `suggestion-submit:${interaction.guild.id}:${interaction.user.id}`;
      if (!takeActionLock(lockKey)) return interaction.reply({ content: 'Your suggestion is already being sent.', ephemeral: true });
      try {
        const blockReason = suggestionSubmissionBlockReason(interaction.guild.id, interaction.user.id);
        if (blockReason) return interaction.reply({ content: blockReason, ephemeral: true });
        const publicChannelId = settings.suggestionChannelIds[interaction.guild.id];
        const staffChannelId = settings.suggestionStaffChannelIds[interaction.guild.id];
        const publicChannel = publicChannelId ? await interaction.guild.channels.fetch(publicChannelId).catch(() => null) : null;
        const staffChannel = staffChannelId ? await interaction.guild.channels.fetch(staffChannelId).catch(() => null) : null;
        if (!publicChannel?.isTextBased() || !staffChannel?.isTextBased()) {
          return interaction.reply({ content: 'Suggestion channels are not configured correctly. Please contact staff.', ephemeral: true });
        }
        const suggestion = {
          guildId: interaction.guild.id,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
          authorAvatar: interaction.user.displayAvatarURL(),
          anonymous: interaction.customId.endsWith(':anonymous'),
          category: interaction.fields.getTextInputValue('category'),
          title: interaction.fields.getTextInputValue('title'),
          details: interaction.fields.getTextInputValue('details'),
          status: 'open',
          votes: {},
          publicChannelId,
          staffChannelId,
          createdAt: Date.now(),
        };
        let publicMessage;
        try {
          publicMessage = await publicChannel.send({
            embeds: [suggestionPublicEmbed(suggestion)],
            components: [suggestionPublicActions(suggestion)],
            allowedMentions: { parse: [] },
          });
          suggestion.publicMessageId = publicMessage.id;
          const staffMessage = await staffChannel.send({
            embeds: [suggestionStaffEmbed(suggestion)],
            components: suggestionStaffActions(suggestion),
            allowedMentions: { parse: [] },
          });
          suggestion.staffMessageId = staffMessage.id;
        } catch (error) {
          if (publicMessage) await publicMessage.delete().catch(() => {});
          throw error;
        }
        settings.suggestions[suggestion.publicMessageId] = suggestion;
        saveSettings();
        await sendLog(interaction.guild, 'Suggestion received', `Suggestion: **${suggestion.title}**\nFrom: **${interaction.user.username}**`).catch(() => {});
        return interaction.reply({ content: 'Your suggestion is now open for community voting. Thank you!', ephemeral: true });
      } finally {
        releaseActionLock(lockKey);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('suggestion_note:')) {
      if (!canManageBot(interaction.member)) return interaction.reply({ content: 'You do not have permission to update suggestions.', ephemeral: true });
      const [, status, publicMessageId] = interaction.customId.split(':');
      const suggestion = settings.suggestions[publicMessageId];
      if (!suggestion || !['open', 'review', 'planned', 'progress', 'not_planned'].includes(status)) {
        return interaction.reply({ content: 'This suggestion is no longer being tracked.', ephemeral: true });
      }
      if (suggestionIsFinal(suggestion)) {
        return interaction.reply({ content: 'This suggestion can no longer be updated.', ephemeral: true });
      }
      const lockKey = `suggestion-staff:${publicMessageId}`;
      if (!takeActionLock(lockKey)) return interaction.reply({ content: 'This suggestion is already being updated.', ephemeral: true });
      try {
        await interaction.deferReply({ ephemeral: true });
        suggestion.teamNote = interaction.fields.getTextInputValue('note');
        if (status === 'not_planned') suggestion.status = 'not_planned';
        suggestion.staffName = interaction.user.username;
        saveSettings();
        await updatePublicSuggestion(suggestion);
        await updateStaffSuggestion(suggestion);
        await sendLog(interaction.guild, 'Suggestion updated', `Suggestion: **${suggestion.title}**\nStatus: **${suggestionStatusLabel(suggestion.status)}**\nBy: **${interaction.user.username}**`).catch(() => {});
        await sendSuggestionStatusDm(suggestion);
        return interaction.editReply('Suggestion update saved.');
      } finally {
        releaseActionLock(lockKey);
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'application_submit') {
      const lockKey = `application-submit:${interaction.guild.id}:${interaction.user.id}`;
      if (!takeActionLock(lockKey)) return interaction.reply({ content: 'Your application is already being sent.', ephemeral: true });
      try {
        const channelId = settings.applicationReviewChannelIds[interaction.guild.id];
        const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
        if (!channel?.isTextBased()) return interaction.reply({ content: 'Applications are not configured correctly. Please contact staff.', ephemeral: true });
        const hasActiveApplication = Object.values(settings.applications).some((application) =>
          application.guildId === interaction.guild.id
          && application.authorId === interaction.user.id
          && ['pending', 'claimed'].includes(application.status));
        if (hasActiveApplication) return interaction.reply({ content: 'You already have an application under review.', ephemeral: true });
        const application = {
          guildId: interaction.guild.id,
          authorId: interaction.user.id,
          authorName: interaction.user.username,
          authorAvatar: interaction.user.displayAvatarURL(),
          position: interaction.fields.getTextInputValue('position'),
          experience: interaction.fields.getTextInputValue('experience'),
          availability: interaction.fields.getTextInputValue('availability'),
          reason: interaction.fields.getTextInputValue('reason'),
          status: 'pending',
          createdAt: Date.now(),
        };
        const message = await channel.send({ embeds: [applicationEmbed(application)], components: [applicationActions()], allowedMentions: { parse: [] } });
        settings.applications[message.id] = application;
        saveSettings();
        await sendLog(interaction.guild, 'Application received', `Application: **${application.position}**\nFrom: **${interaction.user.username}**`).catch(() => {});
        return interaction.reply({ content: 'Your application has been sent privately to the team. Thank you!', ephemeral: true });
      } finally {
        releaseActionLock(lockKey);
      }
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
