const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const token = process.env.WHATSAPP_TOKEN;
const phoneID = process.env.PHONE_NUMBER_ID;

// Webhook verification for Meta
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
        return res.send(req.query["hub.challenge"]);
    }
    res.send("Error");
});

// Incoming messages from WhatsApp
app.post("/webhook", async (req, res) => {
    try {
        const change = req.body.entry?.[0]?.changes?.[0]?.value;

        // Ignore non-message events
        if (!change?.messages) {
            return res.sendStatus(200);
        }

        const message = change.messages[0];
        const from = message.from;

        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
                text: {
                    body: `Hi! 👋 Thanks for reaching out.

You can instantly book your consultation here:
📅 {{Your_Calendly_Link}}

Once you book, you'll get the secure intake form to complete.`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Error:", error?.response?.data || error);
        res.sendStatus(500);
    }
});

// Render must use dynamic port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot running on " + PORT));
