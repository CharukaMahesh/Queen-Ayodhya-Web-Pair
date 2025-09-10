const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const { makeWASocket, useMultiFileAuthState, delay, Browsers } = require("@whiskeysockets/baileys");
const { uploadToMega } = require("./mega");
const fs = require("fs");

// Create sessions directory
const sessionsDir = './sessions';
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store active connections
const activeConnections = new Map();

// WhatsApp connection function
async function createWhatsAppConnection(sessionId, phoneNumber = null) {
    try {
        console.log("Creating connection for session:", sessionId);
        
        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true, // Enable terminal QR for debugging
            logger: { level: 'error' }, // Only show errors
            browser: Browsers.macOS("Safari")
        });

        let pairingCode = null;
        let qrCode = null;

        // Handle credentials update
        sock.ev.on('creds.update', saveCreds);

        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            console.log("Connection update:", update);
            
            if (update.qr) {
                qrCode = update.qr;
                const connection = activeConnections.get(sessionId);
                if (connection) {
                    connection.qr = qrCode;
                    console.log("QR code generated");
                }
            }
            
            if (update.connection === 'open') {
                console.log("✅ WhatsApp connected successfully!");
                const connection = activeConnections.get(sessionId);
                if (connection) {
                    connection.connected = true;
                    connection.user = sock.user;
                    
                    // Save session to MEGA
                    try {
                        const credsPath = `./sessions/${sessionId}/creds.json`;
                        if (fs.existsSync(credsPath)) {
                            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                            const megaFileName = `whatsapp-${phoneNumber || 'session'}-${timestamp}.json`;
                            
                            const megaUrl = await uploadToMega(credsPath, megaFileName);
                            connection.megaUrl = megaUrl;
                            console.log('Session saved to MEGA:', megaUrl);
                            
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
                        try {
                            sock.ws.close();
                        } catch (e) {}
                        cleanupSession(sessionId);
                    }, 3000);
                }
            }
        });

        // Request pairing code if number provided
        if (phoneNumber && !sock.authState.creds.registered) {
            await delay(3000); // Wait for connection to initialize
            try {
                pairingCode = await sock.requestPairingCode(phoneNumber);
                console.log("Pairing code generated:", pairingCode);
            } catch (error) {
                console.error("Error generating pairing code:", error);
                throw error;
            }
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

// Cleanup session
function cleanupSession(sessionId) {
    try {
        const sessionPath = `./sessions/${sessionId}`;
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('Cleaned up session:', sessionId);
        }
        activeConnections.delete(sessionId);
    } catch (error) {
        console.error('Cleanup error:', error);
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
        console.log("Generating pairing code for:", cleanNumber);
        const connection = await createWhatsAppConnection(sessionId, cleanNumber);
        
        // Wait for pairing code to generate
        let attempts = 0;
        while (!connection.pairingCode && attempts < 10) {
            await delay(1000);
            attempts++;
        }
        
        if (connection.pairingCode) {
            res.json({ 
                success: true,
                code: connection.pairingCode,
                sessionId: sessionId,
                message: "Enter this code in WhatsApp within 20 seconds"
            });
        } else {
            throw new Error("No pairing code generated");
        }
        
    } catch (error) {
        console.error("Pairing code error:", error);
        cleanupSession(sessionId);
        res.status(500).json({ error: "Failed to generate pairing code: " + error.message });
    }
});

// Generate QR code
app.get("/qr", async (req, res) => {
    const sessionId = `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        console.log("Generating QR code");
        const connection = await createWhatsAppConnection(sessionId);
        
        // Wait for QR code to generate
        let qrCode = null;
        let attempts = 0;
        
        while (!qrCode && attempts < 15) {
            await delay(1000);
            qrCode = activeConnections.get(sessionId)?.qr;
            attempts++;
            console.log("Waiting for QR code, attempt:", attempts);
        }
        
        if (qrCode) {
            res.json({ 
                success: true,
                qr: qrCode,
                sessionId: sessionId,
                message: "Scan this QR code within 20 seconds"
            });
        } else {
            throw new Error("No QR code generated");
        }
        
    } catch (error) {
        console.error("QR code error:", error);
        cleanupSession(sessionId);
        res.status(500).json({ error: "Failed to generate QR code: " + error.message });
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

// Cleanup endpoint
app.delete("/cleanup/:sessionId", (req, res) => {
    const { sessionId } = req.params;
    cleanupSession(sessionId);
    res.json({ success: true, message: "Session cleaned up" });
});

// Cleanup old sessions every minute
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, connection] of activeConnections.entries()) {
        if (now - connection.createdAt > 300000) { // 5 minutes
            console.log("Cleaning up old session:", sessionId);
            cleanupSession(sessionId);
        }
    }
}, 60000);

// Error handling middleware
app.use((error, req, res, next) => {
    console.error("Unhandled error:", error);
    res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📱 WhatsApp Linking Portal ready`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    // Cleanup all sessions
    for (const [sessionId] of activeConnections.entries()) {
        cleanupSession(sessionId);
    }
    process.exit(0);
});
