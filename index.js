const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const { makeWASocket, useMultiFileAuthState, delay } = require("@whiskeysockets/baileys");

__path = process.cwd();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store active connections
const activeConnections = new Map();

// WhatsApp connection function
async function createWhatsAppConnection(sessionId, phoneNumber = null) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: { level: 'silent' }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const connection = activeConnections.get(sessionId);
            if (connection) {
                if (update.qr) {
                    connection.qr = update.qr;
                    connection.connected = false;
                }
                if (update.connection === 'open') {
                    connection.connected = true;
                    connection.user = sock.user;
                }
                if (update.connection === 'close') {
                    connection.connected = false;
                }
            }
        });

        // Request pairing code if number provided
        let pairingCode = null;
        if (phoneNumber && !sock.authState.creds.registered) {
            await delay(1000);
            pairingCode = await sock.requestPairingCode(phoneNumber);
        }

        const connectionInfo = {
            sock,
            saveCreds,
            connected: false,
            qr: null,
            pairingCode,
            createdAt: Date.now()
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

    const sessionId = `pair-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const connection = await createWhatsAppConnection(sessionId, number);
        
        // Wait a bit for the pairing code to generate
        await delay(2000);
        
        if (connection.pairingCode) {
            res.json({ 
                code: connection.pairingCode,
                sessionId: sessionId
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
        
        // Wait for QR code to generate
        let qrCode = null;
        let attempts = 0;
        
        while (!qrCode && attempts < 10) {
            await delay(500);
            qrCode = activeConnections.get(sessionId)?.qr;
            attempts++;
        }
        
        if (qrCode) {
            res.json({ 
                qr: qrCode,
                sessionId: sessionId
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
            connected: connection.connected,
            qr: connection.qr,
            user: connection.user
        });
    } else {
        res.status(404).json({ error: "Session not found" });
    }
});

// Cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, connection] of activeConnections.entries()) {
        if (now - connection.createdAt > 300000) { // 5 minutes
            try {
                connection.sock.ws.close();
                activeConnections.delete(sessionId);
            } catch (error) {
                console.error("Cleanup error:", error);
            }
        }
    }
}, 60000); // Check every minute

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 Pairing endpoint: http://localhost:${PORT}/code?number=YOUR_NUMBER`);
    console.log(`📟 QR endpoint: http://localhost:${PORT}/qr`);
});
