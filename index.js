const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ENV VARIABLES
const token = process.env.WHATSAPP_TOKEN;
const phoneID = process.env.PHONE_NUMBER_ID;
const verifyToken = process.env.VERIFY_TOKEN;

// --------------------------
// META WEBHOOK VERIFICATION
// --------------------------
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === verifyToken) {
        return res.send(req.query["hub.challenge"]);
    }
    res.send("Error");
});

// --------------------------
// META INCOMING MESSAGES
// --------------------------
app.post("/webhook", async (req, res) => {
    try {
        const change = req.body.entry?.[0]?.changes?.[0]?.value;

        if (!change?.messages) {
            return res.sendStatus(200);
        }

        const message = change.messages[0];
        const from = message.from;

        // SEND WELCOME MESSAGE WITH CALENDLY LINK
        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: from,
                type: "text",
                text: {
                    body: `Hi! 👋 Thanks for reaching out.

You can instantly book your consultation here:
📅 https://calendly.com/asheeraf007/30min

Once you book, you'll receive a confirmation + secure intake form here on WhatsApp.`
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


// ------------------------------------------
// NEW: CALENDLY BOOKING CONFIRMATION WEBHOOK
// ------------------------------------------
app.get("/calendly-booked", async (req, res) => {
    console.log("🔎 Calendly redirect received:", req.query);

    // Calendly sends these exact params:
    const name = req.query.invitee_full_name;
    const phone = req.query["questions[1]"] || req.query["questions%5B1%5D"];

    if (!phone) {
        return res.send("❌ Phone number missing in redirect!");
    }

    const cleanedPhone = phone.replace(/\D/g, ""); // clean into WhatsApp format

    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: cleanedPhone,
                type: "text",
                text: {
                    body: `Hi ${name}! 👋  
Your consultation is confirmed.

Before the session, complete this short intake form:
👉 {{INTAKE_FORM_LINK}}`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        res.send("🎉 WhatsApp confirmation sent!");
    } catch (err) {
        console.error("❌ WhatsApp Error:", err.response?.data || err);
        res.send("Error sending WhatsApp message");
    }
});


// --------------------------
// SERVER START
// --------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot running on " + PORT));

//EAAKQjxn2zaMBQBvSiMnHJtlfZAiw7tIft9abQ7ePmV6rsoxMZBohJEIr87ebpLPZAf2ZA4lsyfKsubAtizz0pvUhQvJkKMbHtNCMnZBaW5A4vz779ZBNz0DqOAALQz1Q2FXtexJM5fchVLrv4MZBqoHM1gZBHs1ooYktZCNJIykZCE53qAEBeZCmiyDGHVujHON1Xo5AM6Lsp7pBZAeiyFwKjaXyOUhHExbe3DwgWTRGL60TezkC3F8cQroEqxK0jJvxLXEArC9py9MRl5YvEkbP3j8ZB

//calendly token: eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzY0NTI1ODgwLCJqdGkiOiIxNTBhN2U5Yi04MmJhLTQ3MjItYTQwYy01NWViODgzNjI2NjAiLCJ1c2VyX3V1aWQiOiI2YzU5N2IzYy02NzYzLTQxODktOGRkNi01M2E0NTc5MzgzYWYifQ.AtNgcFjTLNynUy9mxmh7bZ9UYpocMc4yQGzI0O9sYnALidmW8WEgvvmDk0hhHdT8dQBLOva9w0GFVCddlIPx1A