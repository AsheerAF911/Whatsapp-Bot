const express = require("express");
const axios = require("axios");
const { Client } = require("@notionhq/client");

const app = express();
app.use(express.json());

const { google } = require("googleapis");


// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

// META / WHATSAPP
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const GRAPH_API_VERSION =
    process.env.GRAPH_API_VERSION || "v23.0";


// NOTION
const NOTION_TOKEN = process.env.NOTION_TOKEN;

const NOTION_PATIENTS_DATA_SOURCE_ID =
    process.env.NOTION_PATIENTS_DATA_SOURCE_ID;

// Optional for now.
// If configured, check-in form responses will also
// create records inside a separate Check-ins database.
const NOTION_CHECKINS_DATA_SOURCE_ID =
    process.env.NOTION_CHECKINS_DATA_SOURCE_ID;


// EXTERNAL LINKS
const GOOGLE_BOOKING_URL =
    process.env.GOOGLE_BOOKING_URL ||
    "https://calendar.app.google/FHcgeVLDPfEyf61Q6";

const googleOAuthClient =
    new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );

googleOAuthClient.setCredentials({
    refresh_token:
        process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({
    version: "v3",
    auth: googleOAuthClient
});

const INTAKE_FORM_URL =
    process.env.INTAKE_FORM_URL ||
    "https://tally.so/r/0Q757Z";

const CHECKIN_FORM_URL =
    process.env.CHECKIN_FORM_URL ||
    "https://tally.so/r/2EBgP9";

const FOLLOWUP_FORM_URL =
    process.env.FOLLOWUP_FORM_URL || "";


// ======================================================
// NOTION CLIENT
// ======================================================

const notion = new Client({
    auth: NOTION_TOKEN,
    notionVersion: "2026-03-11"
});


// ======================================================
// NOTION PROPERTY NAMES
//
// IMPORTANT:
// These must match your Notion database property names.
// ======================================================

const PATIENT = {
    name: "Client Name",
    phone: "Phone Number",
    email: "Email Address",
    stage: "Patient Stage",
    programStatus: "Program Status",
    program: "Program Type",
    appointmentDate: "Appointment Date",
    lastCheckin: "Last Check-in Date",
    dateOfBirth: "Date of Birth",
    address: "Home Address",
    source: "Source"
};


// If you create a separate Check-ins database,
// these are the property names expected there.

const CHECKIN = {
    title: "Check-in",
    patient: "Patient",
    submittedAt: "Submitted At",
    summary: "Response Summary"
};



// ======================================================
// BASIC HELPERS
// ======================================================

function normalizePhone(value) {

    if (!value) return null;

    // Handles form systems that return:
    // { countryCode: "+91", phoneNumber: "9876543210" }

    if (typeof value === "object") {

        if (value.countryCode && value.phoneNumber) {
            return `${value.countryCode}${value.phoneNumber}`
                .replace(/\D/g, "");
        }

        if (value.phoneNumber) {
            return String(value.phoneNumber)
                .replace(/\D/g, "");
        }
    }

    return String(value).replace(/\D/g, "");
}


function toDateOnly(value) {

    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().split("T")[0];
}


function readableValue(value) {

    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "object") {

        if (value.countryCode && value.phoneNumber) {
            return `${value.countryCode}${value.phoneNumber}`;
        }

        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    return String(value);
}


// ======================================================
// WHATSAPP HELPER
// ======================================================

async function sendWhatsAppMessage(to, payload) {

    return axios.post(

        `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,

        {
            messaging_product: "whatsapp",
            to,
            ...payload
        },

        {
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );
}


// ======================================================
// NOTION PROPERTY BUILDERS
// ======================================================

function titleProperty(value) {

    return {
        title: [
            {
                text: {
                    content: String(value)
                }
            }
        ]
    };
}


function textProperty(value) {

    return {
        rich_text: [
            {
                text: {
                    content: String(value)
                }
            }
        ]
    };
}


function selectProperty(value) {

    return {
        select: {
            name: value
        }
    };
}


function dateProperty(value) {

    return {
        date: {
            start: value
        }
    };
}


// ======================================================
// FIND PATIENT BY PHONE
// ======================================================

async function findPatientByPhone(phone) {

    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
        return null;
    }

    const response = await notion.dataSources.query({

        data_source_id:
            NOTION_PATIENTS_DATA_SOURCE_ID,

        filter: {

            property: PATIENT.phone,

            rich_text: {
                equals: normalizedPhone
            }
        }
    });

    const patient = response.results.find(
        item => item.object === "page"
    );

    return patient || null;
}


// ======================================================
// CREATE PATIENT
// ======================================================

async function createPatient({
    phone,
    name,
    stage = "New Lead"
}) {

    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
        throw new Error(
            "Cannot create patient without phone number"
        );
    }

    const displayName =
        name || `WhatsApp ${normalizedPhone.slice(-4)}`;

    const patient = await notion.pages.create({

        parent: {
            data_source_id:
                NOTION_PATIENTS_DATA_SOURCE_ID
        },

        properties: {

            [PATIENT.name]:
                titleProperty(displayName),

            [PATIENT.phone]:
                textProperty(normalizedPhone),

            [PATIENT.stage]:
                selectProperty(stage),

            [PATIENT.source]:
                selectProperty("WhatsApp")
        }
    });

    console.log(
        `✅ Notion patient created: ${displayName}`
    );

    return patient;
}


// ======================================================
// CREATE NEW LEAD ONLY IF PATIENT DOESN'T EXIST
// ======================================================

async function ensureNewLead(phone) {

    const normalizedPhone = normalizePhone(phone);

    let patient =
        await findPatientByPhone(normalizedPhone);

    if (patient) {

        console.log(
            `ℹ️ Patient already exists: ${normalizedPhone}`
        );

        // IMPORTANT:
        // Do NOT reset an existing patient to New Lead.
        return patient;
    }

    patient = await createPatient({
        phone: normalizedPhone,
        stage: "New Lead"
    });

    return patient;
}


// ======================================================
// UPDATE NOTION PATIENT
// ======================================================

async function updatePatient(pageId, updates) {

    const properties = {};


    if (updates.name) {

        properties[PATIENT.name] =
            titleProperty(updates.name);
    }


    if (updates.phone) {

        properties[PATIENT.phone] =
            textProperty(
                normalizePhone(updates.phone)
            );
    }


    if (updates.email) {

        properties[PATIENT.email] = {
            email: updates.email
        };
    }


    if (updates.stage) {

        properties[PATIENT.stage] =
            selectProperty(updates.stage);
    }


    if (updates.programStatus) {

        properties[PATIENT.programStatus] =
            selectProperty(
                updates.programStatus
            );
    }


    if (updates.program) {

        properties[PATIENT.program] =
            selectProperty(updates.program);
    }


    if (updates.appointmentDate) {

        properties[PATIENT.appointmentDate] =
            dateProperty(
                updates.appointmentDate
            );
    }


    if (updates.lastCheckin) {

        properties[PATIENT.lastCheckin] =
            dateProperty(
                updates.lastCheckin
            );
    }


    if (updates.dateOfBirth) {

        properties[PATIENT.dateOfBirth] =
            dateProperty(
                updates.dateOfBirth
            );
    }


    if (updates.address) {

        properties[PATIENT.address] =
            textProperty(
                updates.address
            );
    }


    if (Object.keys(properties).length === 0) {

        console.log(
            "ℹ️ No Notion properties to update."
        );

        return null;
    }


    const result = await notion.pages.update({

        page_id: pageId,

        properties
    });


    console.log(
        `✅ Notion patient updated: ${pageId}`
    );

    return result;
}


// ======================================================
// FIND OR CREATE PATIENT
// ======================================================

async function findOrCreatePatient({
    phone,
    name,
    fallbackStage = "New Lead"
}) {

    let patient =
        await findPatientByPhone(phone);

    if (patient) {
        return patient;
    }

    return createPatient({
        phone,
        name,
        stage: fallbackStage
    });
}


// ======================================================
// FORM FIELD HELPERS
//
// Supports:
// req.body.data
// req.body.data.fields
// req.body.fields
// ======================================================

function getFormFields(body) {

    if (Array.isArray(body?.data?.fields)) {
        return body.data.fields;
    }

    if (Array.isArray(body?.data)) {
        return body.data;
    }

    if (Array.isArray(body?.fields)) {
        return body.fields;
    }

    return [];
}


function findField(fields, patterns) {

    const regexes =
        patterns.map(pattern =>
            new RegExp(pattern, "i")
        );

    return fields.find(field => {

        const label =
            field.label ||
            field.name ||
            field.key ||
            "";

        return regexes.some(regex =>
            regex.test(label)
        );
    });
}


function getFieldValue(fields, patterns) {

    const field =
        findField(fields, patterns);

    if (!field) {
        return null;
    }

    return (
        field.value ??
        field.answer ??
        field.response ??
        null
    );
}


// ======================================================
// WHATSAPP MAIN MENU
// ======================================================

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
                            id: "existing_patient",
                            title: "Existing Patient"
                        }
                    }
                ]
            }
        }
    });
}


// ======================================================
// META WEBHOOK VERIFICATION
// ======================================================

app.get("/webhook", (req, res) => {

    const mode =
        req.query["hub.mode"];

    const verify =
        req.query["hub.verify_token"];

    const challenge =
        req.query["hub.challenge"];


    if (
        mode === "subscribe" &&
        verify === VERIFY_TOKEN
    ) {

        console.log(
            "✅ Meta webhook verified"
        );

        return res
            .status(200)
            .send(challenge);
    }


    return res.sendStatus(403);
});


// ======================================================
// WHATSAPP WEBHOOK
// ======================================================

app.post("/webhook", async (req, res) => {

    console.log("📩 WhatsApp webhook");

    console.log(
        JSON.stringify(
            req.body,
            null,
            2
        )
    );


    try {

        const change =
            req.body.entry?.[0]
                ?.changes?.[0]
                ?.value;


        // Delivery/read status events also arrive
        // at the webhook.
        if (!change?.messages) {

            return res.sendStatus(200);
        }


        const message =
            change.messages[0];

        const from =
            normalizePhone(message.from);


        // =================================================
        // NORMAL TEXT
        // =================================================

        if (message.type === "text") {

            const text =
                message.text?.body
                    ?.trim()
                    ?.toLowerCase();


            console.log(
                `💬 Message from ${from}: ${text}`
            );


            if (
                text === "hi" ||
                text === "hello" ||
                text === "hey" ||
                text === "start" ||
                text === "menu"
            ) {

                await sendMainMenu(from);

                return res.sendStatus(200);
            }


            await sendWhatsAppMessage(from, {

                type: "text",

                text: {

                    body:
`Thanks for reaching out. 😊

Please send *Hi* to open the clinic menu.`
                }
            });


            return res.sendStatus(200);
        }


        // =================================================
        // BUTTON RESPONSES
        // =================================================

        if (
            message.type === "interactive" &&
            message.interactive?.type ===
                "button_reply"
        ) {

            const buttonId =
                message.interactive
                    .button_reply.id;


            console.log(
                "🔘 Button selected:",
                buttonId
            );


            // =============================================
            // BOOK APPOINTMENT
            // =============================================

            if (
                buttonId ===
                "book_appointment"
            ) {

                // -----------------------------------------
                // AUTOMATION #1
                //
                // Create patient in Notion:
                // Patient Stage = New Lead
                // -----------------------------------------

                 try {

                    console.log(
                        "🟡 Creating/finding patient in Notion..."
                    );

                    const patient = await ensureNewLead(from);

                    console.log(
                        "✅ Patient ready in Notion:",
                        patient?.id
                    );

                } catch (error) {

                    console.error(
                        "❌ NOTION LEAD CREATION FAILED"
                    );

                    console.error(
                        error.body || error.message
                    );
                }


                await sendWhatsAppMessage(from, {

                    type: "text",

                    text: {

                        body:
                        `Great! 📅

                        Choose a convenient consultation slot here:

                        👉 ${GOOGLE_BOOKING_URL}

                        You'll only see the practitioner's available times.

                        Once your appointment is booked, we'll update your clinic record automatically.`
                        }
                    }
                );


                return res.sendStatus(200);
            }


            // =============================================
            // EXISTING PATIENT
            // =============================================

            if (
                buttonId ===
                "existing_patient"
            ) {

                await sendWhatsAppMessage(
                    from,
                    {

                        type: "interactive",

                        interactive: {

                            type: "button",

                            body: {

                                text:
`Welcome back 👋

What would you like to do?`
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
                                    }
                                ]
                            }
                        }
                    }
                );


                return res.sendStatus(200);
            }


            // =============================================
            // FOLLOW-UP
            // =============================================

            if (
                buttonId ===
                "existing_followup"
            ) {

                if (!FOLLOWUP_FORM_URL) {

                    await sendWhatsAppMessage(
                        from,
                        {

                            type: "text",

                            text: {

                                body:
`Your follow-up request has been received.

The clinic team will contact you shortly.`
                            }
                        }
                    );

                } else {

                    await sendWhatsAppMessage(
                        from,
                        {

                            type: "text",

                            text: {

                                body:
`You can request your follow-up here:

👉 ${FOLLOWUP_FORM_URL}`
                            }
                        }
                    );
                }


                return res.sendStatus(200);
            }


            // =============================================
            // CHECK-IN
            // =============================================

            if (
                buttonId ===
                "existing_checkin"
            ) {

                await sendWhatsAppMessage(
                    from,
                    {

                        type: "text",

                        text: {

                            body:
`Please complete your latest check-in here:

👉 ${CHECKIN_FORM_URL}

Your update will be shared with the clinic team.`
                        }
                    }
                );


                return res.sendStatus(200);
            }
        }


        return res.sendStatus(200);


    } catch (error) {

        console.error(
            "❌ WhatsApp webhook error:"
        );

        console.error(
            JSON.stringify(
                error.response?.data ||
                error.body ||
                error.message,
                null,
                2
            )
        );


        return res.sendStatus(500);
    }
});


// ======================================================
// CALENDLY HELPERS
// ======================================================

function extractCalendlyPhone(payload) {

    const questions =
        payload?.questions_and_answers || [];


    const phoneQuestion =
        questions.find(item => {

            const question =
                item.question || "";

            return (
                /phone/i.test(question) ||
                /mobile/i.test(question) ||
                /whatsapp/i.test(question)
            );
        });


    return normalizePhone(
        phoneQuestion?.answer ||
        payload?.phone_number ||
        payload?.invitee?.phone_number
    );
}


// ======================================================
// CALENDLY BOOKING WEBHOOK
// ======================================================

app.post(
    "/calendly-webhook",
    async (req, res) => {

        console.log(
            "📅 Calendly webhook received:"
        );

        console.log(
            JSON.stringify(
                req.body,
                null,
                2
            )
        );


        // Respond only to booking creation events.
        const eventType =
            req.body?.event;

        if (
            eventType &&
            eventType !==
                "invitee.created"
        ) {

            return res.sendStatus(200);
        }


        try {

            const payload =
                req.body?.payload || {};


            const phone =
                extractCalendlyPhone(
                    payload
                );


            const name =
                payload?.name ||
                payload?.invitee?.name ||
                null;


            const email =
                payload?.email ||
                payload?.invitee?.email ||
                null;


            const appointmentDate =
                payload
                    ?.scheduled_event
                    ?.start_time ||
                payload
                    ?.event
                    ?.start_time ||
                null;


            if (!phone) {

                console.error(
                    "❌ Calendly booking has no phone number."
                );

                console.error(
                    "Add a required phone/WhatsApp number question to Calendly."
                );

                return res.sendStatus(200);
            }


            // -----------------------------------------
            // AUTOMATION #2
            //
            // Appointment booked:
            // Patient Stage = Booked
            // -----------------------------------------

            const patient =
                await findOrCreatePatient({

                    phone,

                    name,

                    fallbackStage:
                        "Booked"
                });


            const changes = {

                stage: "Booked"
            };


            if (name) {
                changes.name = name;
            }


            if (email) {
                changes.email = email;
            }


            if (appointmentDate) {

                changes.appointmentDate =
                    appointmentDate;
            }


            await updatePatient(
                patient.id,
                changes
            );


            console.log(
                `✅ ${phone} moved to Booked`
            );


            // Send intake form AFTER booking.
            await sendWhatsAppMessage(
                phone,
                {

                    type: "text",

                    text: {

                        body:
`Your appointment is confirmed ✅

Before your consultation, please complete this short intake form:

👉 ${INTAKE_FORM_URL}

This helps the practitioner prepare for your appointment.`
                    }
                }
            );


            return res.sendStatus(200);


        } catch (error) {

            console.error(
                "❌ Calendly automation failed:"
            );

            console.error(
                error.body ||
                error.message
            );


            return res.sendStatus(500);
        }
    }
);


// ======================================================
// TALLY / INTAKE WEBHOOK
// ======================================================

app.post(
    "/intake-webhook",
    async (req, res) => {

        console.log(
            "📥 Intake webhook received:"
        );

        console.log(
            JSON.stringify(
                req.body,
                null,
                2
            )
        );


        try {

            const fields =
                getFormFields(req.body);


            if (!fields.length) {

                console.error(
                    "❌ No form fields found."
                );

                return res
                    .status(400)
                    .send(
                        "No form fields found"
                    );
            }


            const name =
                getFieldValue(
                    fields,
                    [
                        "^Full Name$",
                        "^Name$",
                        "Patient Name"
                    ]
                );


            const email =
                getFieldValue(
                    fields,
                    [
                        "Email Address",
                        "^Email$"
                    ]
                );


            const phoneRaw =
                getFieldValue(
                    fields,
                    [
                        "Phone Number",
                        "Mobile",
                        "WhatsApp"
                    ]
                );


            const address =
                getFieldValue(
                    fields,
                    [
                        "Home Address",
                        "Residential Address",
                        "^Address$"
                    ]
                );


            const dobRaw =
                getFieldValue(
                    fields,
                    [
                        "Date of Birth",
                        "^DOB$"
                    ]
                );


            const phone =
                normalizePhone(
                    phoneRaw
                );


            if (!phone) {

                console.error(
                    "❌ Intake submission has no phone number."
                );

                return res
                    .status(400)
                    .send(
                        "Phone number missing"
                    );
            }


            // If the booking automation worked,
            // this patient already exists.
            //
            // If not, we still create them so
            // intake data isn't lost.

            const patient =
                await findOrCreatePatient({

                    phone,

                    name:
                        readableValue(name),

                    fallbackStage:
                        "Booked"
                });


            const updates = {};


            if (name) {

                updates.name =
                    readableValue(name);
            }


            if (email) {

                updates.email =
                    readableValue(email);
            }


            if (address) {

                updates.address =
                    readableValue(address);
            }


            const dob =
                toDateOnly(dobRaw);


            if (dob) {

                updates.dateOfBirth =
                    dob;
            }


            // IMPORTANT:
            //
            // We deliberately DO NOT set
            // Patient Stage here.
            //
            // A patient who is already Booked
            // must remain Booked.

            await updatePatient(
                patient.id,
                updates
            );


            console.log(
                `✅ Intake saved for ${phone}`
            );


            await sendWhatsAppMessage(
                phone,
                {

                    type: "text",

                    text: {

                        body:
`Thank you! ✅

Your intake form has been received successfully.

The clinic now has the information required for your consultation.`
                    }
                }
            );


            return res
                .status(200)
                .send(
                    "Intake processed"
                );


        } catch (error) {

            console.error(
                "❌ Intake automation failed:"
            );

            console.error(
                error.body ||
                error.message
            );


            return res.sendStatus(500);
        }
    }
);


// ======================================================
// CHECK-IN WEBHOOK
// ======================================================

app.post(
    "/checkin-webhook",
    async (req, res) => {

        console.log(
            "📈 Check-in webhook received:"
        );

        console.log(
            JSON.stringify(
                req.body,
                null,
                2
            )
        );


        try {

            const fields =
                getFormFields(req.body);


            if (!fields.length) {

                return res
                    .status(400)
                    .send(
                        "No check-in fields found"
                    );
            }


            const phoneRaw =
                getFieldValue(
                    fields,
                    [
                        "Phone Number",
                        "Mobile",
                        "WhatsApp"
                    ]
                );


            const phone =
                normalizePhone(
                    phoneRaw
                );


            const name =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "^Full Name$",
                            "^Name$",
                            "Patient Name"
                        ]
                    )
                );


            if (!phone) {

                return res
                    .status(400)
                    .send(
                        "Phone number missing"
                    );
            }


            const patient =
                await findPatientByPhone(
                    phone
                );


            if (!patient) {

                console.error(
                    `❌ No patient found for ${phone}`
                );

                return res
                    .status(404)
                    .send(
                        "Patient not found"
                    );
            }


            const now =
                new Date().toISOString();


            // -----------------------------------------
            // AUTOMATION:
            //
            // Update patient's last check-in.
            // -----------------------------------------

            await updatePatient(
                patient.id,
                {
                    lastCheckin: now
                }
            );


            // -----------------------------------------
            // OPTIONAL:
            //
            // Also create a full Check-in record
            // in your Check-ins database.
            // -----------------------------------------

            if (
                NOTION_CHECKINS_DATA_SOURCE_ID
            ) {

                let summary =
                    fields
                        .map(field => {

                            const label =
                                field.label ||
                                field.name ||
                                field.key ||
                                "Field";

                            const value =
                                readableValue(
                                    field.value ??
                                    field.answer ??
                                    field.response
                                );

                            return `${label}: ${value}`;
                        })
                        .join("\n");


                // Keep within a comfortable
                // Notion rich-text size.
                summary =
                    summary.slice(
                        0,
                        1800
                    );


                await notion.pages.create({

                    parent: {

                        data_source_id:
                            NOTION_CHECKINS_DATA_SOURCE_ID
                    },

                    properties: {

                        [CHECKIN.title]:
                            titleProperty(
                                `${name || "Patient"} - ${new Date().toLocaleDateString("en-IN")}`
                            ),

                        [CHECKIN.patient]: {

                            relation: [
                                {
                                    id:
                                        patient.id
                                }
                            ]
                        },

                        [CHECKIN.submittedAt]:
                            dateProperty(now),

                        [CHECKIN.summary]:
                            textProperty(
                                summary
                            )
                    }
                });


                console.log(
                    "✅ Check-in record created"
                );
            }


            await sendWhatsAppMessage(
                phone,
                {

                    type: "text",

                    text: {

                        body:
`Thank you! ✅

Your check-in has been received and your practitioner will be able to review your latest update.`
                    }
                }
            );


            return res
                .status(200)
                .send(
                    "Check-in processed"
                );


        } catch (error) {

            console.error(
                "❌ Check-in automation failed:"
            );

            console.error(
                error.body ||
                error.message
            );


            return res.sendStatus(500);
        }
    }
);


// ======================================================
// Google authorization route
// ======================================================

app.get("/google/auth", (req, res) => {

    const authUrl =
        googleOAuthClient.generateAuthUrl({

            access_type: "offline",

            prompt: "consent",

            scope: [
                "https://www.googleapis.com/auth/calendar.readonly"
            ]
        });


    res.redirect(authUrl);
});

app.get(
    "/google/oauth/callback",
    async (req, res) => {

        try {

            const code =
                req.query.code;


            const {
                tokens
            } =
                await googleOAuthClient
                    .getToken(code);


            console.log(
                "GOOGLE TOKENS:",
                tokens
            );


            res.send(
                "Google Calendar connected. Check Render logs for refresh token."
            );


        } catch (error) {

            console.error(
                "Google OAuth failed:",
                error
            );

            res.status(500)
                .send(
                    "Google OAuth failed"
                );
        }
    }
);


// ======================================================
// NOTION CONNECTION TEST
// ======================================================

app.get(
    "/notion-health",
    async (req, res) => {

        try {

            const response =
                await notion.dataSources.retrieve({

                    data_source_id:
                        NOTION_PATIENTS_DATA_SOURCE_ID
                });


            return res.json({

                ok: true,

                message:
                    "Notion connection working",

                dataSourceId:
                    response.id
            });


        } catch (error) {

            console.error(
                "❌ Notion test failed:",
                error.body ||
                error.message
            );


            return res.status(500).json({

                ok: false,

                error:
                    error.body ||
                    error.message
            });
        }
    }
);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {

    res
        .status(200)
        .send(
            "WhatsApp Clinic Automation is running ✅"
        );
});


app.get(
    "/google-calendar-health",
    async (req, res) => {

        try {

            const result =
                await calendar.events.list({

                    calendarId:
                        process.env
                            .GOOGLE_CALENDAR_ID ||
                        "primary",

                    timeMin:
                        new Date()
                            .toISOString(),

                    maxResults: 5,

                    singleEvents: true,

                    orderBy: "startTime"
                });


            res.json({

                ok: true,

                events:
                    result.data.items
                        ?.map(event => ({

                            id:
                                event.id,

                            title:
                                event.summary,

                            start:
                                event.start,

                            attendees:
                                event.attendees
                        }))
            });


        } catch (error) {

            console.error(
                error.response?.data ||
                error.message
            );


            res.status(500)
                .json({

                    ok: false,

                    error:
                        error.response?.data ||
                        error.message
                });
        }
    }
);


// ======================================================
// SERVER START
// ======================================================

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `✅ Clinic automation running on port ${PORT}`
        );
    }
);