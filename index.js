import express from 'express'
import { createServer } from 'http'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pairRouter from './routes/pair.js'
import qrRouter from './routes/qr.js'
import { startBot } from './bot.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 8000

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Static HTML pages
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'main.html'))
})
app.get('/pair', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'pair.html'))
})
app.get('/qrpage', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'qr.html'))
})

// API routes
app.use('/code', pairRouter)
app.use('/qr', qrRouter)

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
})

const server = createServer(app)

server.listen(PORT, () => {
    console.log(`\n🌐 Server running on port ${PORT}`)
    console.log(`   → Home:      http://localhost:${PORT}/`)
    console.log(`   → Pair Code: http://localhost:${PORT}/pair`)
    console.log(`   → QR Code:   http://localhost:${PORT}/qrpage\n`)
})

// Start the WhatsApp → Telegram bot
startBot()
