# Discord-ticketbot

## Installeren

1. Installeer Node.js 18 of nieuwer.
2. Open een terminal in deze map en voer `npm install` uit.
3. Kopieer `.env.example` naar `.env` en vul de Discord-waarden in. De bot maakt bij de eerste start automatisch de rol **Support** aan.
4. Maak in het [Discord Developer Portal](https://discord.com/developers/applications) een bot en nodig hem uit met de scopes `bot` en `applications.commands`.
5. Geef de bot minstens **Kanalen beheren**, **Kanalen bekijken**, **Berichten verzenden** en **Berichtgeschiedenis lezen**.
6. Registreer de commands met `npm run register`.
7. Start de bot met `npm start`.

## Gebruiken

Een beheerder gebruikt `/ticketpaneel` in het gewenste kanaal. Leden klikken daarna op **Open ticket**. De bot maakt één privé ticket per lid. Geef de automatisch aangemaakte rol **Support** aan je moderators; het lid of die rol kan tickets sluiten.

## Benodigde IDs

Schakel in Discord ontwikkelaarsmodus in, klik met rechts op een server, rol of categorie en kies **ID kopiëren**. `TICKET_CATEGORY_ID` is optioneel.

## Always-on hosting with Railway

For a bot that stays online when your computer is off, deploy this folder as a Railway service.

1. Create a Railway project and deploy this folder or a GitHub repository containing it.
2. Add these Railway variables: `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`. Add `TICKET_CATEGORY_ID` only when you want a default ticket category.
3. Add a Railway Volume mounted at `/data`, then set `SETTINGS_PATH` to `/data/ticket-settings.json`. This keeps your ticket, welcome, and TikTok settings after redeployments.
4. Deploy. Railway runs `node index.js` and restarts the bot after a failure.

Never upload or commit the local `.env` file; it contains the secret Discord bot token.
