const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
let router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega");

// Create sessions directory if it doesn't exist
const sessionsDir = './sessions';
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Store active connections to prevent multiple connections for same number
const activeConnections = new Map();

router.get("/", async (req, res) => {
  let num = req.query.number;

  if (!num) {
    return res.status(400).send({ error: "Phone number is required" });
  }

  // Clean the number
  num = num.replace(/[^0-9]/g, "");
  
  if (num.length < 11) {
    return res.status(400).send({ error: "Invalid phone number format" });
  }

  // Check if already processing this number
  if (activeConnections.has(num)) {
    return res.send({ code: "Already processing your request. Please wait..." });
  }

  activeConnections.set(num, true);

  async function RobinPair() {
    const sessionPath = `./sessions/${num}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    try {
      let RobinPairWeb = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "fatal" }).child({ level: "fatal" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }).child({ level: "fatal" }),
        browser: Browsers.macOS("Safari"),
      });

      // Generate pairing code immediately
      if (!RobinPairWeb.authState.creds.registered) {
        await delay(2000); // Wait a bit before requesting code
        try {
          const code = await RobinPairWeb.requestPairingCode(num);
          console.log("Pairing code generated for:", num, "Code:", code);
          
          if (!res.headersSent) {
            res.send({ code, sessionId: num });
          }
        } catch (codeError) {
          console.error("Error generating pairing code:", codeError);
          if (!res.headersSent) {
            res.status(500).send({ error: "Failed to generate pairing code" });
          }
          activeConnections.delete(num);
          return;
        }
      }

      // Setup event listeners
      RobinPairWeb.ev.on("creds.update", saveCreds);
      
      RobinPairWeb.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "open") {
          console.log("✅ WhatsApp connected successfully for:", num);
          
          try {
            await delay(3000); // Wait for connection to stabilize
            
            // Upload session to MEGA
            try {
              const credsFilePath = path.join(sessionPath, "creds.json");
              
              if (fs.existsSync(credsFilePath)) {
                function randomMegaId(length = 8, numberLength = 4) {
                  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
                  let result = "";
                  for (let i = 0; i < length; i++) {
                    result += characters.charAt(Math.floor(Math.random() * characters.length));
                  }
                  const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                  return `${result}${number}`;
                }

                const mega_url = await upload(
                  fs.createReadStream(credsFilePath),
                  `${randomMegaId()}.json`
                );

                console.log("Session uploaded to MEGA:", mega_url);

                // Send session info to user
                const user_jid = jidNormalizedUser(RobinPairWeb.user.id);
                const string_session = mega_url.replace("https://mega.nz/file/", "");
                
                const sid = `*ROBIN WhatsApp Bot*\n\nSession ID: ${string_session}\n\n*Copy this ID and paste into your config.js file*\n\n*Support: wa.me/message/WKGLBR2PCETWD1*\n\n*Join group: https://chat.whatsapp.com/GAOhr0qNK7KEvJwbenGivZ*`;
                const mg = `🛑 *Do not share this session ID with anyone* 🛑`;
                
                await RobinPairWeb.sendMessage(user_jid, {
                  image: {
                    url: "https://raw.githubusercontent.com/Dark-Robin/Bot-Helper/refs/heads/main/autoimage/Bot%20robin%20WP.jpg",
                  },
                  caption: sid,
                });
                
                await RobinPairWeb.sendMessage(user_jid, { text: mg });
              }
            } catch (uploadError) {
              console.error("MEGA upload error:", uploadError);
            }

          } catch (messageError) {
            console.error("Error sending messages:", messageError);
          }

          // Cleanup and close connection
          await delay(2000);
          try {
            RobinPairWeb.ws.close();
          } catch (e) {}
          
          await removeFile(sessionPath);
          activeConnections.delete(num);
          process.exit(0);
          
        } else if (
          connection === "close" &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output.statusCode !== 401
        ) {
          console.log("Connection closed, attempting reconnect...");
          await delay(10000);
          activeConnections.delete(num);
          RobinPair();
          
        } else if (connection === "close") {
          console.log("Connection closed normally");
          activeConnections.delete(num);
        }
      });

    } catch (err) {
      console.error("Error in RobinPair:", err);
      exec("pm2 restart Robin-md");
      activeConnections.delete(num);
      
      if (!res.headersSent) {
        res.status(500).send({ error: "Service Unavailable" });
      }
      
      await removeFile(`./sessions/${num}`);
    }
  }

  // Set timeout for the pairing process (2 minutes)
  setTimeout(() => {
    if (activeConnections.has(num)) {
      console.log("Pairing timeout for:", num);
      activeConnections.delete(num);
      if (!res.headersSent) {
        res.status(408).send({ error: "Pairing timeout. Please try again." });
      }
    }
  }, 120000);

  return await RobinPair();
});

// Add endpoint to check connection status
router.get("/status/:number", (req, res) => {
  const num = req.params.number.replace(/[^0-9]/g, "");
  const isProcessing = activeConnections.has(num);
  res.send({ processing: isProcessing, number: num });
});

// Add endpoint to cleanup sessions
router.delete("/cleanup/:number", async (req, res) => {
  const num = req.params.number.replace(/[^0-9]/g, "");
  activeConnections.delete(num);
  await removeFile(`./sessions/${num}`);
  res.send({ success: true, message: "Session cleaned up" });
});

process.on("uncaughtException", function (err) {
  console.log("Caught exception: " + err);
  exec("pm2 restart Robin");
});

module.exports = router;
