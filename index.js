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

    const name = req.query.invitee_full_name || "there";
    const phoneRaw = req.query.text_reminder_number;

    if (!phoneRaw) {
        console.log("❌ Phone number missing from Calendly");
        return res.send("Booking confirmed! We’ll contact you shortly.");
    }

    const phone = phoneRaw.replace(/\D/g, "");

    try {
        await axios.post(
            `https://graph.facebook.com/v20.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: phone,
                type: "text",
                text: {
                    body: `Hi ${name}! 👋  
Your consultation is confirmed.

Next step: please complete your intake form:
👉 https://tally.so/r/INTAKE_FORM_ID

Looking forward to meeting you!`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ Calendly WhatsApp sent to", phone);
        res.send("🎉 Booking confirmed! Check WhatsApp.");

    } catch (error) {
        console.error("❌ WhatsApp Error:", error.response?.data || error);
        res.send("Booking confirmed!");
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

    // Convert array → object
    const formatted = {};
    formData.forEach(item => {
        formatted[item.name] = item;
    });

    const name = formatted["Full Name"]?.value || "";
    const email = formatted["Email Address"]?.value || "";
    const countryCode = formatted["Phone Number"]?.countryCode;
    const phoneNumber = formatted["Phone Number"]?.phoneNumber;
    const address = formatted["Home Address"]?.value || "";
    const dob = formatted["Date of Birth"]?.value || "";

    if (!countryCode || !phoneNumber) {
        console.log("❌ Phone missing in intake form");
        return res.send("❌ Phone number missing in intake form!");
    }

    const finalPhone = `${countryCode}${phoneNumber}`;

    // ----- BUILD INSURANCE FORM PREFILL URL -----

    const insuranceFormBase = "https://in.makeforms.co/bmd61p5"; // CHANGE THIS

    const prefillParams = new URLSearchParams({
        "Full Name": name,
        "Email": email,
        "Phone Number": countryCode + phoneNumber,
        "Residential Address": address,
        "Date of Birth": dob
    });

    const insuranceFormURL = `${insuranceFormBase}?${prefillParams.toString()}`;

    console.log("🔗 Prefilled Insurance Form URL:", insuranceFormURL);

    try {
        // ----- SEND WHATSAPP -----

        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: finalPhone,
                type: "text",
                text: {
                    body:
`Hi ${name}! 👋  
Your intake form was received successfully. 🙌  

Next step: please complete your insurance verification form (auto-filled for your convenience):

👉 ${insuranceFormURL}

This helps us verify your eligibility before the consultation.`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ Intake confirmation sent with insurance form link:", finalPhone);
        res.send("🎉 Intake WhatsApp + Insurance Form link sent!");

    } catch (error) {
        console.error("❌ WhatsApp Intake Error:", error.response?.data || error);
        res.send("Error sending Intake WhatsApp message");
    }
});


app.post("/insurance-webhook", async (req, res) => {
    console.log("📥 Insurance Webhook Payload:", req.body);

    const formData = req.body.data;

    if (!formData) {
        return res.send("❌ No insurance form data received!");
    }

    // Convert array into lookup object
    const formatted = {};
    formData.forEach(item => {
        formatted[item.name] = item;
    });

    const name = formatted["Full Name"]?.value;
    const countryCode = formatted["Phone Number"]?.countryCode;
    const phoneNumber = formatted["Phone Number"]?.phoneNumber;

    const insuranceCompany = formatted["Insurance Company Name"]?.value;
    const policyNumber = formatted["Policy Number"]?.value;

    if (!countryCode || !phoneNumber) {
        console.log("❌ Phone missing in insurance form");
        return res.send("❌ Phone number missing in insurance form!");
    }

    const finalPhone = `${countryCode}${phoneNumber}`; // WhatsApp-ready
    console.log("📞 Extracted Phone:", finalPhone);

    try {
        await axios.post(
            `https://graph.facebook.com/v17.0/${phoneID}/messages`,
            {
                messaging_product: "whatsapp",
                to: finalPhone,
                type: "text",
                text: {
                    body:
`Hi ${name}! 👋  
Your insurance details were received successfully.

📄 *Insurance Company:* ${insuranceCompany || "Not provided"}
🆔 *Policy Number:* ${policyNumber || "Not provided"}

Our team will verify your coverage and update you soon.`
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("✅ Insurance confirmation sent to:", finalPhone);
        res.send("🎉 Insurance WhatsApp confirmation sent!");

    } catch (error) {
        console.error("❌ WhatsApp Insurance Error:", error.response?.data || error);
        res.send("Error sending Insurance WhatsApp message");
    }
});




// --------------------------
// SERVER START
// --------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot running on " + PORT));

//EAAKQjxn2zaMBQBvSiMnHJtlfZAiw7tIft9abQ7ePmV6rsoxMZBohJEIr87ebpLPZAf2ZA4lsyfKsubAtizz0pvUhQvJkKMbHtNCMnZBaW5A4vz779ZBNz0DqOAALQz1Q2FXtexJM5fchVLrv4MZBqoHM1gZBHs1ooYktZCNJIykZCE53qAEBeZCmiyDGHVujHON1Xo5AM6Lsp7pBZAeiyFwKjaXyOUhHExbe3DwgWTRGL60TezkC3F8cQroEqxK0jJvxLXEArC9py9MRl5YvEkbP3j8ZB

//calendly token: eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzY0NTI1ODgwLCJqdGkiOiIxNTBhN2U5Yi04MmJhLTQ3MjItYTQwYy01NWViODgzNjI2NjAiLCJ1c2VyX3V1aWQiOiI2YzU5N2IzYy02NzYzLTQxODktOGRkNi01M2E0NTc5MzgzYWYifQ.AtNgcFjTLNynUy9mxmh7bZ9UYpocMc4yQGzI0O9sYnALidmW8WEgvvmDk0hhHdT8dQBLOva9w0GFVCddlIPx1A