# waview-merged

WhatsApp View-Once bypass + Telegram forwarder — with a built-in web UI to pair/link your account via QR code or phone number pairing code.

## How it works

1. Deploy the app (Render, Railway, VPS, Docker, etc.)
2. Open the website → click **Pair Code** or **QR Code**
3. Link your WhatsApp — session is saved to `./auth_info_bot`
4. The bot starts listening: every **view-once** photo/video gets forwarded to your Telegram chat

## Quick start (local)

```bash
cp .env.example .env
# Edit .env — set TELEGRAM_BOT_TOKEN and CHAT_ID at minimum
npm install
npm start
# Open http://localhost:8000
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Bot token from @BotFather |
| `CHAT_ID` | ✅ | — | Your Telegram chat ID |
| `SEND_REGULAR_MEDIA` | ❌ | `false` | Forward regular DM photos/videos |
| `SEND_TEXT_MESSAGES` | ❌ | `false` | Forward DM text messages |
| `CLEAN_DOWNLOADS` | ❌ | `true` | Auto-clean downloads every 48h |
| `MEGA_EMAIL` | ❌ | — | Only needed for MEGA session backup |
| `MEGA_PASSWORD` | ❌ | — | Only needed for MEGA session backup |
| `PORT` | ❌ | `8000` | HTTP server port |

## Routes

| URL | Description |
|---|---|
| `/` | Home page |
| `/pair` | Phone number pairing page |
| `/qrpage` | QR code pairing page |
| `/code?number=994XXXXXXXXX` | API: get pair code |
| `/qr` | API: get QR code |
| `/health` | Health check |

## Docker

```bash
docker build -t waview-merged .
docker run -p 8000:8000 \
  -e TELEGRAM_BOT_TOKEN=xxx \
  -e CHAT_ID=yyy \
  -v $(pwd)/auth_info_bot:/app/auth_info_bot \
  waview-merged
```

> **Note:** Mount `auth_info_bot` as a volume so your session persists across restarts.

## Re-pairing

If the session expires, just delete `./auth_info_bot` and visit the website again to re-pair.
