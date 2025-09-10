const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
let router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
} = require("@whiskeysockets/baileys");

router.get("/", async (req, res) => {
    let num = req.query.number;

    if (!num) {
        // Immediately return an error if no number is provided
        return res.status(400).send({ error: "Number is required" });
    }

    // Clean the number
    num = num.replace(/[^0-9]/g, "");

    const { state, saveCreds } = await useMultiFileAuthState(`./session-${num}`); // Use a unique session per number

    try {
        let RobinPairWeb = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.macOS("Safari"),
        });

        RobinPairWeb.ev.on("creds.update", saveCreds);

        // --- CRITICAL FIX: Generate and send the code, then END THE RESPONSE ---
        if (!RobinPairWeb.authState.creds.registered) {
            const code = await RobinPairWeb.requestPairingCode(num);
            console.log("Pairing code generated for:", num);
            // Send the response and STOP. Do not let this function continue to set up event listeners for THIS request.
            return res.send({ code });
        }

    } catch (err) {
        console.error("Error in /code route:", err);
        // If something fails before we can send a response, send an error.
        if (!res.headersSent) {
            res.status(500).send({ code: "Service Unavailable" });
        }
    }

    // NOTE: The connection.update event listener has been REMOVED from this function.
    // It will cause problems because it tries to use the `res` object later.
});

// You would need to move the "connection.update" logic to a separate, independent process or a different route.
// It should not be tied to the HTTP request/response cycle.

module.exports = router;
