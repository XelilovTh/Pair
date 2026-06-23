/**
 * GET /qr
 * Returns { qr: "data:image/png;base64,...", message, instructions }
 * On successful scan, session is saved to ./auth_info_bot
 * so the main bot picks it up automatically.
 */
import express from 'express'
import fs from 'fs-extra'
import pino from 'pino'
import QRCode from 'qrcode'
import {
    makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore,
    Browsers, jidNormalizedUser, fetchLatestBaileysVersion, delay, DisconnectReason
} from '@whiskeysockets/baileys'

const router = express.Router()
const AUTH_DIR = './auth_info_bot'
const SESSION_TIMEOUT = 60000
const MAX_RECONNECT_ATTEMPTS = 3

async function removeDir(p) {
    try { if (await fs.pathExists(p)) await fs.remove(p) } catch {}
}

router.get('/', async (req, res) => {
    const tmpDir = `./tmp_qr_${Date.now()}`
    let qrGenerated = false, sessionCompleted = false, responseSent = false
    let reconnectAttempts = 0, currentSocket = null, timeoutHandle = null, isCleaningUp = false

    const cleanup = async (reason = 'unknown') => {
        if (isCleaningUp) return
        isCleaningUp = true
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
        if (currentSocket) {
            try { currentSocket.ev.removeAllListeners(); await currentSocket.end() } catch {}
            currentSocket = null
        }
        setTimeout(() => removeDir(tmpDir), 5000)
    }

    const initiateSession = async () => {
        if (sessionCompleted || isCleaningUp) return
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            if (!responseSent && !res.headersSent) {
                responseSent = true
                res.status(503).json({ code: 'Connection failed after multiple attempts' })
            }
            await cleanup('max_reconnects')
            return
        }

        await fs.ensureDir(tmpDir)
        const { state, saveCreds } = await useMultiFileAuthState(tmpDir)
        const { version } = await fetchLatestBaileysVersion()

        if (currentSocket) {
            try { currentSocket.ev.removeAllListeners(); await currentSocket.end() } catch {}
        }

        currentSocket = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
            },
            printQRInTerminal: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
            maxRetries: 3,
        })

        const sock = currentSocket

        sock.ev.on('connection.update', async (update) => {
            if (isCleaningUp) return
            const { connection, lastDisconnect, qr } = update

            // Send QR code to browser
            if (qr && !qrGenerated && !sessionCompleted) {
                qrGenerated = true
                try {
                    const qrDataURL = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'M' })
                    if (!responseSent && !res.headersSent) {
                        responseSent = true
                        res.json({
                            qr: qrDataURL,
                            message: 'QR Code ready! Scan with WhatsApp.',
                            instructions: [
                                'Open WhatsApp on your phone',
                                'Go to Settings → Linked Devices',
                                'Tap "Link a Device"',
                                'Scan the QR code'
                            ]
                        })
                        console.log('[QR] QR code sent to browser')
                    }
                } catch (err) {
                    if (!responseSent && !res.headersSent) {
                        responseSent = true
                        res.status(500).json({ code: 'Failed to generate QR code' })
                    }
                    await cleanup('qr_error')
                }
            }

            if (connection === 'open') {
                if (sessionCompleted) return
                sessionCompleted = true
                console.log('[QR] ✅ QR scanned and connected!')

                try {
                    await fs.ensureDir(AUTH_DIR)
                    const files = await fs.readdir(tmpDir)
                    for (const f of files) {
                        await fs.copy(`${tmpDir}/${f}`, `${AUTH_DIR}/${f}`, { overwrite: true })
                    }
                    console.log('[QR] Session copied to bot auth dir. Bot will reconnect automatically.')
                } catch (err) {
                    console.error('[QR] Failed to copy session:', err.message)
                } finally {
                    await cleanup('session_complete')
                }
            }

            if (connection === 'close') {
                if (sessionCompleted || isCleaningUp) { await cleanup('already_complete'); return }
                const statusCode = lastDisconnect?.error?.output?.statusCode
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    if (!responseSent && !res.headersSent) {
                        responseSent = true
                        res.status(401).json({ code: 'Invalid QR scan or session expired' })
                    }
                    await cleanup('logged_out')
                } else if (qrGenerated && !sessionCompleted) {
                    reconnectAttempts++
                    await delay(2000)
                    await initiateSession()
                } else {
                    await cleanup('connection_closed')
                }
            }
        })

        sock.ev.on('creds.update', saveCreds)

        timeoutHandle = setTimeout(async () => {
            if (!sessionCompleted && !isCleaningUp) {
                if (!responseSent && !res.headersSent) {
                    responseSent = true
                    res.status(408).json({ code: 'QR generation timeout' })
                }
                await cleanup('timeout')
            }
        }, SESSION_TIMEOUT)
    }

    await initiateSession()
})

// Cleanup stale tmp dirs every minute
setInterval(async () => {
    try {
        const dirs = (await fs.readdir('.')).filter(d => d.startsWith('tmp_qr_'))
        const now = Date.now()
        for (const d of dirs) {
            const stat = await fs.stat(d).catch(() => null)
            if (stat && now - stat.mtimeMs > 5 * 60 * 1000) await fs.remove(d)
        }
    } catch {}
}, 60000)

export default router
