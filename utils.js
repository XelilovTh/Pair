/**
 * Utility functions for waview
 */
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export class Logger {
    constructor(prefix = 'waview') {
        this.prefix = prefix
        this.levels = { error: 'ERROR', warn: 'WARN', info: 'INFO', debug: 'DEBUG' }
    }

    format(level, message) {
        const timestamp = new Date().toISOString()
        return `[${timestamp}] [${this.prefix}] [${level}] ${message}`
    }

    error(msg, err = null) {
        console.error(this.format(this.levels.error, msg))
        if (err) console.error(err)
    }

    warn(msg) {
        console.warn(this.format(this.levels.warn, msg))
    }

    info(msg) {
        console.log(this.format(this.levels.info, msg))
    }

    debug(msg) {
        if (process.env.DEBUG === 'true') {
            console.log(this.format(this.levels.debug, msg))
        }
    }
}

export function ensureDir(path) {
    try {
        mkdirSync(path, { recursive: true })
        return true
    } catch (err) {
        console.error(`Failed to create directory ${path}:`, err.message)
        return false
    }
}

export function formatError(err) {
    return err?.stack || err?.message || String(err)
}

export function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex++
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`
}

export function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export const DEFAULT_CONFIG = {
    downloadsDir: './downloads',
    authDir: './auth_info_android_bypass',
    maxMediaBytes: 20 * 1024 * 1024,
    presenceIntervalMin: 4 * 60_000,
    presenceIntervalMax: 80 * 60_000,
    presenceBlipMin: 1_000,
    presenceBlipMax: 120_000,
    downloadCleanupInterval: 48 * 60 * 60 * 1000,
}

export const PERSONAL_SUFFIXES = ['@s.whatsapp.net', '@lid', '@c.us']
export const isPersonal = (jid) => PERSONAL_SUFFIXES.some(s => jid?.endsWith(s))
