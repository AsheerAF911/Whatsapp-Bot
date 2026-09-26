const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ENV VARIABLES
const token = process.env.WHATSAPP_TOKEN;
const phoneID = process.env.PHONE_NUMBER_ID;
const verifyToken = process.env.VERIFY_TOKEN;

// Prefer keeping Graph API version in env too
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v23.0";

// ----------------------------------
// HELPER: SEND WHATSAPP MESSAGE
// ----------------------------------
async function sendWhatsAppMessage(to, payload) {
    return axios.post(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneID}/messages`,
        {
            messaging_product: "whatsapp",
            to,
            ...payload
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        }
    );
}

// ----------------------------------
// META WEBHOOK VERIFICATION
// ----------------------------------
app.get("/webhook", (req, res) => {
    if (req.query["hub.verify_token"] === verifyToken) {
        return res.send(req.query["hub.challenge"]);
    }

    return res.status(403).send("Error");
});

// ----------------------------------
// SEND MAIN MENU
// ----------------------------------
async function sendMainMenu(to) {
    await sendWhatsAppMessage(to, {
        type: "interactive",

        interactive: {
            type: "button",

            body: {
                text:
`Hi! 👋 Welcome to our clinic.

How can we help you today?`
            },

            action: {
                buttons: [
                    {
                        type: "reply",
                        reply: {
                            id: "book_appointment",
                            title: "Book Appointment"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: "ask_question",
                            title: "Ask a Question"
                        }
                    },
                    {
                        type: "reply",
                        reply: {
                            id: "existing_patient",
                            title: "Existing Patient"
                        }
                    }
                ]
            }
        }
    });
}

// ----------------------------------
// META INCOMING MESSAGES
// ----------------------------------
app.post("/webhook", async (req, res) => {

    console.log("📩 WEBHOOK RECEIVED:");
    console.log(JSON.stringify(req.body, null, 2));

    try {
        const change = req.body.entry?.[0]?.changes?.[0]?.value;

        if (!change?.messages) {
            return res.sendStatus(200);
        }

        const message = change.messages[0];
        const from = message.from;

        // -------------------------------------------------
        // 1. NORMAL TEXT MESSAGE
        // -------------------------------------------------

        if (message.type === "text") {

            const text = message.text?.body
                ?.trim()
                ?.toLowerCase();

            console.log("Incoming text:", text);

            // User says hi / hello
            if (
                text === "hi" ||
                text === "hello" ||
                text === "hey" ||
                text === "start"
            ) {
                await sendMainMenu(from);
                return res.sendStatus(200);
            }

            // Optional fallback for any random message
            await sendWhatsAppMessage(from, {
                type: "text",

                text: {
                    body:
`Thanks for reaching out.

Please send *Hi* to open the clinic menu.`
                }
            });

            return res.sendStatus(200);
        }

        // -------------------------------------------------
        // 2. BUTTON RESPONSE
        // -------------------------------------------------

        if (
            message.type === "interactive" &&
            message.interactive?.type === "button_reply"
        ) {

            const buttonId =
                message.interactive.button_reply.id;

            console.log("Button selected:", buttonId);

            // ----------------------------------
            // BOOK APPOINTMENT
            // ----------------------------------

            if (buttonId === "book_appointment") {

                await sendWhatsAppMessage(from, {
                    type: "text",

                    text: {
                        body:
`Great! 📅

You can book your consultation here:

👉 https://calendly.com/asheeraf007/30min

After booking, please complete this short intake form:

👉 https://tally.so/r/0Q757Z

This helps the doctor prepare before your consultation.`
                    }
                });

                return res.sendStatus(200);
            }

            // ----------------------------------
            // ASK A QUESTION
            // ----------------------------------

            if (buttonId === "ask_question") {

                await sendWhatsAppMessage(from, {
                    type: "text",

                    text: {
                        body:
`Sure 😊

Please type your question here.

Our clinic team will review it and get back to you as soon as possible.`
                    }
                });

                return res.sendStatus(200);
            }

            // ----------------------------------
            // EXISTING PATIENT
            // ----------------------------------

            if (buttonId === "existing_patient") {

                await sendWhatsAppMessage(from, {
                    type: "interactive",

                    interactive: {
                        type: "button",

                        body: {
                            text:
`Welcome back 👋

What would you like help with?`
                        },

                        action: {
                            buttons: [
                                {
                                    type: "reply",
                                    reply: {
                                        id: "existing_followup",
                                        title: "Follow-up"
                                    }
                                },
                                {
                                    type: "reply",
                                    reply: {
                                        id: "existing_checkin",
                                        title: "Check-in"
                                    }
                                },
                                {
                                    type: "reply",
                                    reply: {
                                        id: "existing_support",
                                        title: "Talk to Clinic"
                                    }
                                }
                            ]
                        }
                    }
                });

                return res.sendStatus(200);
            }

            // ----------------------------------
            // EXISTING PATIENT → FOLLOW-UP
            // ----------------------------------

            if (buttonId === "existing_followup") {

                await sendWhatsAppMessage(from, {
                    type: "text",

                    text: {
                        body:
`You can request your follow-up here:

👉 YOUR_FOLLOWUP_LINK

If you need help, just reply to this message.`
                    }
                });

                return res.sendStatus(200);
            }

            // ----------------------------------
            // EXISTING PATIENT → CHECK-IN
            // ----------------------------------

            if (buttonId === "existing_checkin") {

                await sendWhatsAppMessage(from, {
                    type: "text",

                    text: {
                        body:
`Please complete your latest patient check-in here:

👉 YOUR_CHECKIN_FORM_LINK

Your update will be shared with the clinic team.`
                    }
                });

                return res.sendStatus(200);
            }

            // ----------------------------------
            // EXISTING PATIENT → TALK TO CLINIC
            // ----------------------------------

            if (buttonId === "existing_support") {

                await sendWhatsAppMessage(from, {
                    type: "text",

                    text: {
                        body:
`Of course.

Please type your message below and our clinic team will respond as soon as possible.`
                    }
                });

                return res.sendStatus(200);
            }
        }

        return res.sendStatus(200);

    } catch (error) {

        console.error("❌ WEBHOOK ERROR");

        console.error(
            JSON.stringify(
                error.response?.data || error.message,
                null,
                2
            )
        );

        return res.sendStatus(500);
    }
});