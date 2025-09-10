const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const { makeWASocket, useMultiFileAuthState, delay } = require("@whiskeysockets/baileys");
const SessionManager = require('./sessionManager');

const sessionManager = new SessionManager();
const activeConnections = new Map();

// ... [keep the rest of your index.js code] ...

// Modify the connection creation function to handle MEGA saving
async function createWhatsAppConnection(sessionId, phoneNumber = null) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: { level: 'silent' }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const connection = activeConnections.get(sessionId);
            if (connection) {
                if (update.qr) {
                    connection.qr = update.qr;
                    connection.connected = false;
                }
                
                if (update.connection === 'open') {
                    connection.connected = true;
                    connection.user = sock.user;
                    
                    // ✅ SAVE TO MEGA WHEN CONNECTED!
                    try {
                        if (phoneNumber) {
                            const megaUrl = await sessionManager.saveSessionToMega(sessionId, phoneNumber);
                            connection.megaUrl = megaUrl;
                            console.log('Session successfully saved to MEGA');
                        }
                    } catch (error) {
                        console.error('MEGA save failed:', error);
                    }
                }
                
                if (update.connection === 'close') {
                    connection.connected = false;
                }
            }
        });

        // ... [rest of the function] ...

    } catch (error) {
        console.error('Connection error:', error);
        throw error;
    }
}

// Add cleanup endpoint
app.post('/cleanup/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        await sessionManager.cleanupSession(sessionId);
        res.json({ success: true, message: 'Session cleaned up' });
    } catch (error) {
        res.status(500).json({ error: 'Cleanup failed' });
    }
});

// ... [rest of your server code] ...
