/**
 * GET /code?number=994XXXXXXXXX
 * Returns { code: "XXXX-XXXX" } — the WhatsApp pairing code.
 * On successful pair, session is saved to ./auth_info_bot
 * so the main bot picks it up automatically.
 */
import express from 'express'
import fs from 'fs-extra'
import pino from 'pino'
import pn from 'awesome-phonenumber'
import {
    makeWASocket, useMultiFileAuthState, delay,
    makeCacheableSignalKeyStore, Browsers,
    jidNormalizedUser, fetchLatestBaileysVersion, DisconnectReason
} from '@whiskeysockets/baileys'

const router = express.Router()
const AUTH_DIR = './auth_info_bot'        // same dir as the bot
const SESSION_TIMEOUT = 5 * 60 * 1000    // 5 min
const MAX_RECONNECT_ATTEMPTS = 3
const CLEANUP_DELAY = 5000

async function removeDir(p) {
    try { if (await fs.pathExists(p)) await fs.remove(p) } catch {}
}

function randomId(len = 6, numLen = 4) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let out = ''
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)]
    return `${out}${Math.floor(Math.random() * 10 ** numLen)}`
}

router.get('/', async (req, res) => {
    let num = req.query.number
    if (!num) return res.status(400).json({ code: 'Phone number is required' })

    num = num.replace(/[^0-9]/g, '')
    const phone = pn('+' + num)
    if (!phone.isValid()) return res.status(400).json({ code: 'Invalid phone number.' })
    num = phone.getNumber('e164').replace('+', '')

    // Use a temporary session dir for pairing; on success copy to AUTH_DIR
    const tmpDir = `./tmp_pair_${Date.now()}`
    let pairingCodeSent = false, sessionCompleted = false, isCleaningUp = false
    let responseSent = false, reconnectAttempts = 0, currentSocket = null, timeoutHandle = null

    const cleanup = async (reason = 'unknown') => {
        if (isCleaningUp) return
        isCleaningUp = true
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null }
        if (currentSocket) {
            try { currentSocket.ev.removeAllListeners(); await currentSocket.end() } catch {}
            currentSocket = null
        }
        setTimeout(() => removeDir(tmpDir), CLEANUP_DELAY)
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
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Chrome'),
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
            const { connection, lastDisconnect, isNewLogin } = update

            if (connection === 'open') {
                if (sessionCompleted) return
                sessionCompleted = true
                console.log(`[Pair] ✅ Paired successfully for +${num}`)

                try {
                    // Copy session to main auth dir so the bot picks it up
                    await fs.ensureDir(AUTH_DIR)
                    const files = await fs.readdir(tmpDir)
                    for (const f of files) {
                        await fs.copy(`${tmpDir}/${f}`, `${AUTH_DIR}/${f}`, { overwrite: true })
                    }
                    console.log('[Pair] Session copied to bot auth dir. Bot will reconnect automatically.')
                } catch (err) {
                    console.error('[Pair] Failed to copy session:', err.message)
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
                        res.status(401).json({ code: 'Invalid pairing code or session expired' })
                    }
                    await cleanup('logged_out')
                } else if (pairingCodeSent && !sessionCompleted) {
                    reconnectAttempts++
                    await delay(2000)
                    await initiateSession()
                } else {
                    await cleanup('connection_closed')
                }
            }
        })

        if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
            await delay(1500)
            try {
                pairingCodeSent = true
                let code = await sock.requestPairingCode(num)
                code = code?.match(/.{1,4}/g)?.join('-') || code
                if (!responseSent && !res.headersSent) {
                    responseSent = true
                    res.json({ code })
                }
            } catch (error) {
                pairingCodeSent = false
                if (!responseSent && !res.headersSent) {
                    responseSent = true
                    res.status(503).json({ code: 'Failed to get pairing code' })
                }
                await cleanup('pairing_code_error')
            }
        }

        sock.ev.on('creds.update', saveCreds)

        timeoutHandle = setTimeout(async () => {
            if (!sessionCompleted && !isCleaningUp) {
                if (!responseSent && !res.headersSent) {
                    responseSent = true
                    res.status(408).json({ code: 'Pairing timeout' })
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
        const dirs = (await fs.readdir('.')).filter(d => d.startsWith('tmp_pair_'))
        const now = Date.now()
        for (const d of dirs) {
            const stat = await fs.stat(d).catch(() => null)
            if (stat && now - stat.mtimeMs > 10 * 60 * 1000) await fs.remove(d)
        }
    } catch {}
}, 60000)

export default router
