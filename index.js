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
app.get("/calendly", async (req, res) => {
    console.log("🔍 Calendly Redirect Query:", req.query);

    const name = req.query.invitee_full_name;
    const phoneRaw = req.query.answer_1;  // Calendly sent phone here

    if (!phoneRaw) {
        return res.send("❌ Phone number missing from query!");
    }

    const phone = phoneRaw.replace(/\D/g, ""); // clean into WhatsApp format

    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: phone,
                type: "text",
                text: {
                    body: `Hi ${name}! 👋  
Your consultation is confirmed.

Before your session, complete this intake form:
👉 https://in.makeforms.co/12jwuip

Thank you!`
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
    } catch (error) {
        console.error("❌ WhatsApp Error:", error.response?.data || error);
        res.send("Error sending WhatsApp message");
    }
});

// ------------------------------------------------
// NEW: INTAKE FORM SUBMISSION CONFIRMATION WEBHOOK
// ------------------------------------------------

app.post("/intake-webhook", async (req, res) => {
    console.log("📥 Intake Webhook Payload:", req.body);

    const formData = req.body.data;

    if (!formData) {
        return res.send("❌ No intake data received!");
    }

    // Convert array into object for easy lookup
    const formatted = {};
    formData.forEach(item => {
        formatted[item.name] = item;
    });

    const name = formatted["Full Name"]?.value;
    const email = formatted["Email Address"]?.value;
    const countryCode = formatted["Phone Number"]?.countryCode;
    const phoneNumber = formatted["Phone Number"]?.phoneNumber;

    if (!countryCode || !phoneNumber) {
        console.log("❌ Phone missing in intake form");
        return res.send("❌ Phone number missing in intake form!");
    }

    const finalPhone = `${countryCode}${phoneNumber}`; // WhatsApp-ready format

    console.log("📞 Extracted Phone:", finalPhone);

    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: finalPhone,
                type: "text",
                text: {
                    body: `Hi ${name}! 👋  
Your intake form was received successfully.  

Our team will review your information before the consultation.  
Thank you for completing it! 🙌`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ Intake confirmation sent to:", finalPhone);
        res.send("🎉 Intake WhatsApp confirmation sent!");

    } catch (error) {
        console.error("❌ WhatsApp Intake Error:", error.response?.data || error);
        res.send("Error sending Intake WhatsApp message");
    }
});





// --------------------------
// SERVER START
// --------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot running on " + PORT));

//EAAKQjxn2zaMBQBvSiMnHJtlfZAiw7tIft9abQ7ePmV6rsoxMZBohJEIr87ebpLPZAf2ZA4lsyfKsubAtizz0pvUhQvJkKMbHtNCMnZBaW5A4vz779ZBNz0DqOAALQz1Q2FXtexJM5fchVLrv4MZBqoHM1gZBHs1ooYktZCNJIykZCE53qAEBeZCmiyDGHVujHON1Xo5AM6Lsp7pBZAeiyFwKjaXyOUhHExbe3DwgWTRGL60TezkC3F8cQroEqxK0jJvxLXEArC9py9MRl5YvEkbP3j8ZB

//calendly token: eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzY0NTI1ODgwLCJqdGkiOiIxNTBhN2U5Yi04MmJhLTQ3MjItYTQwYy01NWViODgzNjI2NjAiLCJ1c2VyX3V1aWQiOiI2YzU5N2IzYy02NzYzLTQxODktOGRkNi01M2E0NTc5MzgzYWYifQ.AtNgcFjTLNynUy9mxmh7bZ9UYpocMc4yQGzI0O9sYnALidmW8WEgvvmDk0hhHdT8dQBLOva9w0GFVCddlIPx1A