const express = require("express");
const app = express();
const path = require("path");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const { makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");

__path = process.cwd();
let code = require("./pair");

app.use("/code", code);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store active sessions
let activeSessions = new Map();

app.use("/", async (req, res, next) => {
  res.sendFile(path.join(__path, "pair.html"));
});

// New endpoint to start QR session
app.post("/start-session", async (req, res) => {
  try {
    const sessionId = Date.now().toString(); // Simple session ID
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: { level: 'silent' }
    });
    
    // Store session
    activeSessions.set(sessionId, { sock, saveCreds });
    
    sock.ev.on('connection.update', (update) => {
      if (update.qr) {
        // QR code available for scanning
        activeSessions.get(sessionId).qr = update.qr;
      }
      
      if (update.connection === 'open') {
        // Connected successfully
        activeSessions.get(sessionId).connected = true;
      }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Wait a bit for QR to generate
    setTimeout(() => {
      const session = activeSessions.get(sessionId);
      res.json({
        qr: session.qr,
        connected: session.connected || false,
        sessionId: sessionId
      });
    }, 1000);
    
  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Check connection status
app.get("/connection-status", (req, res) => {
  // This would need proper session management
  // For simplicity, check first session
  const session = Array.from(activeSessions.values())[0];
  if (session) {
    res.json({
      connected: session.connected || false,
      qr: session.qr || null
    });
  } else {
    res.json({ connected: false, qr: null });
  }
});

app.listen(PORT, () => {
  console.log(`⏩ Server running on http://localhost:${PORT}`);
});

module.exports = app;
