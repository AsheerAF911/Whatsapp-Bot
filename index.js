const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const token = process.env.WHATSAPP_TOKEN;
const phoneID = process.env.PHONE_NUMBER_ID;

app.post("/webhook", async (req, res) => {
    try {
        const message = req.body.entry[0].changes[0].value.messages[0];
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
        console.error(error);
        res.sendStatus(500);
    }
});

app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
        res.send(req.query["hub.challenge"]);
    } else {
        res.send("Error");
    }
});

app.listen(3000, () => console.log("Bot running"));
