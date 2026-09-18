# 🤖 Complete Telegram Bot & Mini-App Setup Guide

This guide walks you through registering your bot with `@BotFather`, setting commands, and connecting it to your deployed **API_Hashira** instance.

---

## 1. Registering the Bot via `@BotFather`

1. Open the Telegram app and search for `@BotFather`.
2. Start the chat and send:
   ```
   /newbot
   ```
3. Enter a display name (e.g., `API Hashira ATS Screener`).
4. Enter a username ending in `bot` (e.g., `API_Hashira_ATS_bot`).
5. `@BotFather` will reply with your **HTTP API Token**:
   ```
   7123456789:AAFlkB4XYZ1234567890abcdefghijklmno
   ```
   *(Keep this token private!)*

---

## 2. Setting Up Bot Commands

To make the commands auto-suggest in Telegram's menu, send `/setcommands` to `@BotFather`, select your bot, and paste this list:

```
start - Launch the ATS bot and view active vacancy
scan - Run 5-factor ATS audit on uploaded resume
compare - Head-to-head comparison of uploaded candidates
setjd - Update target vacancy job description
viewjd - View current job description & required skills
tips - Get ATS resume optimization advice
questions - Generate AI-tailored interview questions
help - Display all available commands and shortcuts
```

---

## 3. Registering the Webhook

Once your app is running on a public HTTPS URL (such as Cloud Run or a reverse proxy), execute:

```bash
curl -F "url=https://YOUR-APP-URL.run.app/api/telegram/webhook" \
     https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
```

You should receive:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

---

## 4. Optional: Configuring Telegram WebApp / Mini-App

To open the full-screen ATS Dashboard inside Telegram:
1. Send `/newapp` to `@BotFather`.
2. Select your bot.
3. Provide an app title and description.
4. Set the WebApp URL to:
   ```
   https://YOUR-APP-URL.run.app
   ```
5. You will receive a direct link (e.g., `t.me/YourBot/atsapp`) that launches the full interactive recruitment workspace directly inside Telegram!
