import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// QR Generator Router
import qrRouter from './qr.js';
import pairRouter from './pair.js';

// Waview Bot - MEGA dəstəyi ilə
import './bypass.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// Event listeners limitini artır
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// QR Generator routes
app.use('/qr', qrRouter);
app.use('/code', pairRouter);

// HTML səhifələr
app.use('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});
app.use('/qrpage', (req, res) => {
    res.sendFile(path.join(__dirname, 'qr.html'));
});
app.use('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🚀 MEGA + WAVIEW BOT');
    console.log('═══════════════════════════════════════════════');
    console.log(`📡 Server: http://localhost:${PORT}`);
    console.log(`📱 QR: http://localhost:${PORT}/qrpage`);
    console.log(`🔑 Pair: http://localhost:${PORT}/pair`);
    console.log('═══════════════════════════════════════════════');
    console.log('🤖 Waview bot starting...');
    console.log('📸 View Once media will be forwarded to Telegram');
    console.log('═══════════════════════════════════════════════\n');
});

export default app;
