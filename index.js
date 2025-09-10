const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const { makeWASocket, useMultiFileAuthState, delay, Browsers } = require("@whiskeysockets/baileys");
const SessionManager = require('./sessionManager');

const sessionManager = new SessionManager();
const activeConnections = new Map();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// WhatsApp connection function
async function createWhatsAppConnection(sessionId, phoneNumber = null) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: { level: 'silent' },
            browser: Browsers.macOS("Safari")
        });

        let pairingCode = null;
        let qrCode = null;

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            if (update.qr) {
                qrCode = update.qr;
                const connection = activeConnections.get(sessionId);
                if (connection) {
                    connection.qr = qrCode;
                }
            }
            
            if (update.connection === 'open') {
                const connection = activeConnections.get(sessionId);
                if (connection) {
                    connection.connected = true;
                    connection.user = sock.user;
                    
                    // Save session to MEGA
                    try {
                        if (phoneNumber) {
                            const megaUrl = await sessionManager.saveSessionToMega(sessionId, phoneNumber);
                            connection.megaUrl = megaUrl;
                            
                            // Send session to user via WhatsApp
                            const sessionCode = megaUrl.replace("https://mega.nz/file/", "").split('/')[0];
                            const message = `*WhatsApp Session Created* ✅\n\nSession ID: ${sessionCode}\n\nSave this ID for future use.\n\n*Do not share with anyone!*`;
                            
                            await sock.sendMessage(sock.user.id, { text: message });
                        }
                    } catch (error) {
                        console.error('MEGA save failed:', error);
                    }
                    
                    // Close connection after saving
                    setTimeout(() => {
                        sock.ws.close();
                        sessionManager.cleanupSession(sessionId);
                        activeConnections.delete(sessionId);
                    }, 3000);
                }
            }
        });

        // Request pairing code if number provided
        if (phoneNumber && !sock.authState.creds.registered) {
            await delay(2000);
            pairingCode = await sock.requestPairingCode(phoneNumber);
        }

        const connectionInfo = {
            sock,
            saveCreds,
            connected: false,
            qr: qrCode,
            pairingCode,
            createdAt: Date.now(),
            phoneNumber
        };

        activeConnections.set(sessionId, connectionInfo);
        return connectionInfo;

    } catch (error) {
        console.error('Connection error:', error);
        throw error;
    }
}

// Routes
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "pair.html"));
});

// Generate pairing code
app.get("/code", async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        return res.status(400).json({ error: "Phone number required" });
    }

    const cleanNumber = number.replace(/[^0-9]/g, '');
    if (cleanNumber.length < 11) {
        return res.status(400).json({ error: "Invalid phone number" });
    }

    const sessionId = `pair-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const connection = await createWhatsAppConnection(sessionId, cleanNumber);
        
        // Wait for pairing code
        await delay(3000);
        
        if (connection.pairingCode) {
            res.json({ 
                success: true,
                code: connection.pairingCode,
                sessionId: sessionId,
                message: "Enter this code in WhatsApp within 20 seconds"
            });
        } else {
            res.status(500).json({ error: "Failed to generate pairing code" });
        }
        
    } catch (error) {
        console.error("Pairing code error:", error);
        res.status(500).json({ error: "Failed to generate code" });
    }
});

// Generate QR code
app.get("/qr", async (req, res) => {
    const sessionId = `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const connection = await createWhatsAppConnection(sessionId);
        
        // Wait for QR code
        let qrCode = null;
        let attempts = 0;
        
        while (!qrCode && attempts < 10) {
            await delay(500);
            qrCode = activeConnections.get(sessionId)?.qr;
            attempts++;
        }
        
        if (qrCode) {
            res.json({ 
                success: true,
                qr: qrCode,
                sessionId: sessionId,
                message: "Scan this QR code within 20 seconds"
            });
        } else {
            res.status(500).json({ error: "Failed to generate QR code" });
        }
        
    } catch (error) {
        console.error("QR code error:", error);
        res.status(500).json({ error: "Failed to generate QR code" });
    }
});

// Check connection status
app.get("/status/:sessionId", (req, res) => {
    const { sessionId } = req.params;
    const connection = activeConnections.get(sessionId);
    
    if (connection) {
        res.json({
            connected: connection.connected || false,
            qr: connection.qr,
            megaUrl: connection.megaUrl,
            phoneNumber: connection.phoneNumber
        });
    } else {
        res.status(404).json({ error: "Session not found" });
    }
});

// Cleanup old sessions every minute
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, connection] of activeConnections.entries()) {
        if (now - connection.createdAt > 300000) { // 5 minutes
            try {
                connection.sock.ws.close();
                sessionManager.cleanupSession(sessionId);
                activeConnections.delete(sessionId);
            } catch (error) {
                console.error("Cleanup error:", error);
            }
        }
    }
}, 60000);

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 WhatsApp Linking Portal ready`);
});
