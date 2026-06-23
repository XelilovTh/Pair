import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    jidNormalizedUser
} from '@whiskeysockets/baileys'
import pino from 'pino'
import { writeFileSync, mkdirSync } from 'fs'
import {
    senderDevice,
    senderMetadata,
    sendTelegramMedia,
    sendTelegramText,
    shouldSendRegularMedia,
    shouldSendTextMessages,
    startDownloadsCleanup,
    telegramRuntimeConfig
} from './telegram.js'

const DOWNLOADS_DIR = './downloads'
const AUTH_DIR = './auth_info_bot'
mkdirSync(DOWNLOADS_DIR, { recursive: true })
mkdirSync(AUTH_DIR, { recursive: true })

const PERSONAL_SUFFIXES = ['@s.whatsapp.net', '@lid', '@c.us']
const MAX_MEDIA_BYTES = 20 * 1024 * 1024
const isPersonal = (jid) => PERSONAL_SUFFIXES.some(s => jid?.endsWith(s))

const PRESENCE_INTERVAL_MIN_MS = 4 * 60_000
const PRESENCE_INTERVAL_MAX_MS = 80 * 60_000
const PRESENCE_BLIP_MIN_MS = 1_000
const PRESENCE_BLIP_MAX_MS = 120_000
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

const formatError = (err) => err?.stack || err?.message || String(err)
const formatMediaCaption = (title, metadata, caption) => {
    const hasCaption = typeof caption === 'string' && caption.trim().length > 0
    const parts = [title]
    if (hasCaption) parts.push(caption)
    parts.push(metadata)
    return parts.join('\n\n')
}

async function notifyTelegramEvent(title, details) {
    if (['DISCONNECTED', 'RECONNECTING'].includes(title)) return
    try {
        await sendTelegramText(`[${title}]\nTime: ${new Date().toISOString()}\n${details}`)
    } catch (err) {
        console.log(`[Telegram] Failed to send ${title}: ${err.message}`)
    }
}

function printStartupConfig() {
    const config = telegramRuntimeConfig()
    const will = (enabled) => enabled ? 'will' : 'will NOT'
    const credentials = config.hasCredentials ? 'present ✓' : 'NOT SET ✗'
    console.log([
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  WhatsApp → Telegram Bot',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `  Telegram credentials : ${credentials}`,
        `  View Once messages   : ${will(config.sendViewOnce)} be forwarded`,
        `  Regular DM media     : ${will(config.sendRegularMedia)} be forwarded`,
        `  Text messages        : ${will(config.sendTextMessages)} be forwarded`,
        `  Downloads cleanup    : ${will(config.cleanDownloads)} run every 48h`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
    ].join('\n'))
}

export async function startBot() {
    printStartupConfig()
    startDownloadsCleanup(DOWNLOADS_DIR)

    process.on('unhandledRejection', (err) => {
        console.log(`[Unhandled Rejection] ${formatError(err)}`)
        void notifyTelegramEvent('UNHANDLED REJECTION', formatError(err))
    })

    process.on('uncaughtException', (err) => {
        console.log(`[Uncaught Exception] ${formatError(err)}`)
        void notifyTelegramEvent('UNCAUGHT EXCEPTION', formatError(err))
    })

    await startSession()
}

async function startSession() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    let presenceTimer = null

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        // Android frankel spoof — works for view-once bypass
        browser: ['frankel', 'WhatsApp', '2.26.16.73'],
        syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'close') {
            if (presenceTimer) { clearTimeout(presenceTimer); presenceTimer = null }
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut
            console.log(`[Bot] Connection closed. Code: ${statusCode}. Reconnecting: ${shouldReconnect}`)

            if ([401, 403].includes(statusCode)) {
                console.log('[Bot] Session invalid — delete ./auth_info_bot and re-pair via the website.')
                return
            }
            if (shouldReconnect) {
                setTimeout(() => startSession(), 5000)
            }
        } else if (connection === 'open') {
            const ownJid = jidNormalizedUser(sock.user?.id)
            console.log(`[Bot] ✅ Connected as ${ownJid}`)
            await sendTelegramText(`✅ WhatsApp bot connected!\nJID: ${ownJid}\nTime: ${new Date().toISOString()}`)

            const schedulePresence = () => {
                const delay = randomBetween(PRESENCE_INTERVAL_MIN_MS, PRESENCE_INTERVAL_MAX_MS)
                presenceTimer = setTimeout(async () => {
                    try {
                        await sock.sendPresenceUpdate('available')
                        await new Promise(r => setTimeout(r, randomBetween(PRESENCE_BLIP_MIN_MS, PRESENCE_BLIP_MAX_MS)))
                        await sock.sendPresenceUpdate('unavailable')
                    } catch (err) {
                        console.log(`[Presence] Failed: ${err.message}`)
                    }
                    schedulePresence()
                }, delay)
            }
            schedulePresence()
        }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            if (!msg.message) continue

            const sender = msg.key.remoteJid
            const metadata = senderMetadata(msg)

            const viewOnceWrapper =
                msg.message.viewOnceMessageV2 ||
                msg.message.viewOnceMessage ||
                msg.message.viewOnceMessageV2Extension
            const directMedia = msg.message.imageMessage || msg.message.videoMessage
            const isViewOnce = directMedia?.viewOnce === true || !!viewOnceWrapper

            if (isViewOnce) {
                // ─── VIEW ONCE ───────────────────────────────────────────────
                const inner = viewOnceWrapper?.message || msg.message
                const mediaType = inner?.imageMessage ? 'image' : inner?.videoMessage ? 'video' : 'unknown'
                const ext = mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin'
                const caption = inner?.imageMessage?.caption ?? inner?.videoMessage?.caption

                console.log(`\n[VIEW ONCE] from ${sender} (${mediaType})`)

                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {})
                    const filename = `${DOWNLOADS_DIR}/viewonce_${Date.now()}.${ext}`
                    writeFileSync(filename, buffer)
                    console.log(`[VIEW ONCE] Saved: ${filename} (${buffer.length} bytes)`)

                    const telegramCaption = formatMediaCaption(`👁 *[VIEW ONCE] ${mediaType.toUpperCase()}*`, metadata, caption)
                    await sendTelegramMedia(buffer, filename, mediaType, telegramCaption)
                    console.log(`[VIEW ONCE] Forwarded to Telegram ✓`)
                } catch (err) {
                    console.log(`[VIEW ONCE] Failed: ${err.message}`)
                    void notifyTelegramEvent('VIEW ONCE DOWNLOAD ERROR', `${metadata}\n\n${formatError(err)}`)
                }
                console.log('─────────────────────────────────────────\n')

            } else if (isPersonal(sender)) {
                // ─── REGULAR DM ──────────────────────────────────────────────
                const shortSender = sender.split('@')[0]
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text

                const mediaMap = {
                    image: { msg: msg.message.imageMessage, ext: 'jpg' },
                    video: { msg: msg.message.videoMessage, ext: 'mp4' },
                    voice: { msg: msg.message.audioMessage, ext: 'ogg' },
                }
                const mediaType = Object.keys(mediaMap).find(k => mediaMap[k].msg)

                if (mediaType) {
                    const { msg: mediaMsg, ext } = mediaMap[mediaType]
                    const size = Number(mediaMsg.fileLength) || 0
                    const caption = mediaMsg.caption

                    if (size && size > MAX_MEDIA_BYTES) {
                        console.log(`[DM Media] ${shortSender} → ${mediaType} skipped (${size} bytes > 20MB)`)
                    } else {
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {})
                            const filename = `${DOWNLOADS_DIR}/${mediaType}_${Date.now()}.${ext}`
                            writeFileSync(filename, buffer)
                            console.log(`[DM Media] ${shortSender} → Saved ${mediaType}: ${filename}`)

                            if (shouldSendRegularMedia()) {
                                const telegramCaption = formatMediaCaption(`📥 *[DM MEDIA] ${mediaType}*`, metadata, caption)
                                await sendTelegramMedia(buffer, filename, mediaType, telegramCaption)
                            }
                        } catch (err) {
                            console.log(`[DM Media] ${shortSender} → Failed: ${err.message}`)
                            void notifyTelegramEvent('DM MEDIA DOWNLOAD ERROR', `${metadata}\n\n${formatError(err)}`)
                        }
                    }
                } else {
                    const device = senderDevice(msg)
                    console.log(`[Normal] ${shortSender}: ${text || '[Non-text]'} (${device})`)
                    if (text && shouldSendTextMessages()) {
                        try {
                            await sendTelegramText(`💬 *[DM TEXT]*\n${metadata}\n\n${text}`)
                        } catch (err) {
                            console.log(`[Normal] ${shortSender} → Telegram send failed: ${err.message}`)
                        }
                    }
                }
            }
        }
    })
}
