const express = require("express");
const axios = require("axios");
const { Client } = require("@notionhq/client");
const { google } = require("googleapis");
const crypto = require("crypto");

const app = express();
app.use(express.json());


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

const NOTION_APPOINTMENTS_DATA_SOURCE_ID =
    process.env.NOTION_APPOINTMENTS_DATA_SOURCE_ID;

const NOTION_PATIENT_HISTORY_DATA_SOURCE_ID =
    process.env.NOTION_PATIENT_HISTORY_DATA_SOURCE_ID;

const NOTION_CHECKINS_DATA_SOURCE_ID =
    process.env.NOTION_CHECKINS_DATA_SOURCE_ID;


// GOOGLE
const GOOGLE_BOOKING_URL =
    process.env.GOOGLE_BOOKING_URL;

const GOOGLE_APPOINTMENT_SUMMARY =
    process.env.GOOGLE_APPOINTMENT_SUMMARY;


// FORMS
const INTAKE_FORM_URL =
    process.env.INTAKE_FORM_URL;

const CHECKIN_FORM_URL =
    process.env.CHECKIN_FORM_URL;

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
// GOOGLE CALENDAR CLIENT
// ======================================================

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


const calendar =
    google.calendar({
        version: "v3",
        auth: googleOAuthClient
    });


// ======================================================
// GOOGLE EVENT LOCK
// ======================================================

const processingGoogleEvents =
    new Set();


// ======================================================
// NOTION PROPERTY NAMES
//
// CHANGE THESE ONLY IF YOUR NOTION PROPERTY NAMES DIFFER
// ======================================================

const PATIENT = {

    name: "Patient Name",

    patientId: "Patient ID",

    phone: "Phone Number",

    email: "Patient Email",

    stage: "Patient Stage",

    programStatus: "Program Status",

    program: "Program Type",

    lastCheckin: "Last Check-in Date",

    dateOfBirth: "Date of Birth",

    address: "Home Address",

    source: "Source"
};


const APPOINTMENT = {

    title: "Patient Name",

    patientRelation: "Patient",

    date: "Date of Appointment",

    reason: "Reason for Appointment",

    status: "Status",

    googleEventId: "Google Event ID"
};


const HISTORY = {

    title: "Name",

    patientRelation: "Client",

    medicalHistory: "Medical History",

    diagnoses: "Diagnoses",

    medications: "Medications",

    allergies: "Allergies",

    goals: "Goals",

    specialNotes: "Special Notes"
};


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


    if (typeof value === "object") {

        if (
            value.countryCode &&
            value.phoneNumber
        ) {

            return (
                `${value.countryCode}${value.phoneNumber}`
            ).replace(/\D/g, "");
        }


        if (value.phoneNumber) {

            return String(
                value.phoneNumber
            ).replace(/\D/g, "");
        }
    }


    return String(value)
        .replace(/\D/g, "");
}


function normalizeIndiaPhone(phone) {

    let normalized =
        normalizePhone(phone);

    if (!normalized) {
        return null;
    }


    // Temporary India-specific handling
    if (normalized.length === 10) {

        normalized =
            `91${normalized}`;
    }


    return normalized;
}


function toDateOnly(value) {

    if (!value) return null;

    const date =
        new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return null;
    }


    return date
        .toISOString()
        .split("T")[0];
}


function readableValue(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";
    }


    if (typeof value === "object") {

        if (
            value.countryCode &&
            value.phoneNumber
        ) {

            return (
                `${value.countryCode}${value.phoneNumber}`
            );
        }


        try {

            return JSON.stringify(value);

        } catch {

            return String(value);
        }
    }


    return String(value);
}


function generatePatientId() {

    return (
        `PAT-${crypto.randomUUID()}`
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
                    content:
                        String(value)
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
                    content:
                        String(value)
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
// WHATSAPP HELPER
// ======================================================

async function sendWhatsAppMessage(
    to,
    payload
) {

    return axios.post(

        `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,

        {
            messaging_product:
                "whatsapp",

            to,

            ...payload
        },

        {
            headers: {

                Authorization:
                    `Bearer ${WHATSAPP_TOKEN}`,

                "Content-Type":
                    "application/json"
            }
        }
    );
}


// ======================================================
// FORM HELPERS
// ======================================================

function getFormFields(body) {

    if (
        Array.isArray(
            body?.data?.fields
        )
    ) {

        return body.data.fields;
    }


    if (
        Array.isArray(
            body?.data
        )
    ) {

        return body.data;
    }


    if (
        Array.isArray(
            body?.fields
        )
    ) {

        return body.fields;
    }


    return [];
}


function findField(
    fields,
    patterns
) {

    const regexes =
        patterns.map(
            pattern =>
                new RegExp(
                    pattern,
                    "i"
                )
        );


    return fields.find(
        field => {

            const label =
                field.label ||
                field.name ||
                field.key ||
                "";


            return regexes.some(
                regex =>
                    regex.test(label)
            );
        }
    );
}


function getFieldValue(
    fields,
    patterns
) {

    const field =
        findField(
            fields,
            patterns
        );


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
// PATIENT LOOKUP
//
// IMPORTANT:
// PHONE IS NOT A UNIQUE PATIENT IDENTIFIER.
// ======================================================

async function findPatientsByName(
    name
) {

    if (!name) {
        return [];
    }


    const response =
        await notion.dataSources.query({

            data_source_id:
                NOTION_PATIENTS_DATA_SOURCE_ID,

            filter: {

                property:
                    PATIENT.name,

                title: {
                    equals: name
                }
            }
        });


    return response.results
        .filter(
            item =>
                item.object === "page"
        );
}


function getPatientEmailFromPage(
    page
) {

    return (
        page.properties[
            PATIENT.email
        ]?.email ||
        null
    );
}


function getPatientPhoneFromPage(
    page
) {

    return (
        page.properties[
            PATIENT.phone
        ]
            ?.rich_text?.[0]
            ?.plain_text ||
        null
    );
}


// ======================================================
// FIND LIKELY EXISTING PATIENT
//
// MATCH:
// name + email
// OR
// name + phone
//
// PHONE ALONE IS NEVER ENOUGH.
// ======================================================

async function findMatchingPatient({
    name,
    email,
    phone
}) {

    const candidates =
        await findPatientsByName(
            name
        );


    if (!candidates.length) {
        return null;
    }


    const normalizedEmail =
        email
            ?.trim()
            ?.toLowerCase() ||
        null;


    const normalizedPhone =
        normalizeIndiaPhone(
            phone
        );


    for (
        const patient
        of candidates
    ) {

        const patientEmail =
            getPatientEmailFromPage(
                patient
            )
                ?.trim()
                ?.toLowerCase();


        const patientPhone =
            normalizeIndiaPhone(
                getPatientPhoneFromPage(
                    patient
                )
            );


        if (
            normalizedEmail &&
            patientEmail &&
            normalizedEmail ===
                patientEmail
        ) {

            return patient;
        }


        if (
            normalizedPhone &&
            patientPhone &&
            normalizedPhone ===
                patientPhone
        ) {

            return patient;
        }
    }


    return null;
}


// ======================================================
// CREATE PATIENT
// ======================================================

async function createPatient({
    phone,
    name,
    email,
    stage = "Booked"
}) {

    const patientId =
        generatePatientId();


    const properties = {

        [PATIENT.name]:
            titleProperty(
                name ||
                "Unknown Patient"
            ),

        [PATIENT.patientId]:
            textProperty(
                patientId
            ),

        [PATIENT.stage]:
            selectProperty(
                stage
            ),

        [PATIENT.source]:
            selectProperty(
                "WhatsApp"
            )
    };


    if (phone) {

        properties[
            PATIENT.phone
        ] =
            textProperty(
                normalizeIndiaPhone(
                    phone
                )
            );
    }


    if (email) {

        properties[
            PATIENT.email
        ] = {

            email:
                email
                    .trim()
                    .toLowerCase()
        };
    }


    const patient =
        await notion.pages.create({

            parent: {

                data_source_id:
                    NOTION_PATIENTS_DATA_SOURCE_ID
            },

            properties
        });


    console.log(
        `✅ Patient created: ${name} (${patientId})`
    );


    return patient;
}


// ======================================================
// UPDATE PATIENT
// ======================================================

async function updatePatient(
    pageId,
    updates
) {

    const properties = {};


    if (updates.name) {

        properties[
            PATIENT.name
        ] =
            titleProperty(
                updates.name
            );
    }


    if (updates.phone) {

        properties[
            PATIENT.phone
        ] =
            textProperty(
                normalizeIndiaPhone(
                    updates.phone
                )
            );
    }


    if (updates.email) {

        properties[
            PATIENT.email
        ] = {

            email:
                updates.email
                    .trim()
                    .toLowerCase()
        };
    }


    if (updates.stage) {

        properties[
            PATIENT.stage
        ] =
            selectProperty(
                updates.stage
            );
    }


    if (updates.programStatus) {

        properties[
            PATIENT.programStatus
        ] =
            selectProperty(
                updates.programStatus
            );
    }


    if (updates.program) {

        properties[
            PATIENT.program
        ] =
            selectProperty(
                updates.program
            );
    }


    if (updates.lastCheckin) {

        properties[
            PATIENT.lastCheckin
        ] =
            dateProperty(
                updates.lastCheckin
            );
    }


    if (updates.dateOfBirth) {

        properties[
            PATIENT.dateOfBirth
        ] =
            dateProperty(
                updates.dateOfBirth
            );
    }


    if (updates.address) {

        properties[
            PATIENT.address
        ] =
            textProperty(
                updates.address
            );
    }


    if (
        Object.keys(
            properties
        ).length === 0
    ) {

        return null;
    }


    const result =
        await notion.pages.update({

            page_id:
                pageId,

            properties
        });


    console.log(
        `✅ Patient updated: ${pageId}`
    );


    return result;
}


// ======================================================
// APPOINTMENT LOOKUP BY GOOGLE EVENT ID
//
// THIS IS OUR PERSISTENT DUPLICATE CHECK.
// ======================================================

async function findAppointmentByGoogleEventId(
    eventId
) {

    if (!eventId) {
        return null;
    }


    const response =
        await notion.dataSources.query({

            data_source_id:
                NOTION_APPOINTMENTS_DATA_SOURCE_ID,

            filter: {

                property:
                    APPOINTMENT.googleEventId,

                rich_text: {
                    equals: eventId
                }
            }
        });


    return (
        response.results.find(
            item =>
                item.object === "page"
        ) ||
        null
    );
}


// ======================================================
// CREATE APPOINTMENT
// ======================================================

async function createAppointment({
    patient,
    patientName,
    event
}) {

    const appointmentDate =
        event.start?.dateTime ||
        event.start?.date;


    const appointment =
        await notion.pages.create({

            parent: {

                data_source_id:
                    NOTION_APPOINTMENTS_DATA_SOURCE_ID
            },

            properties: {

                [APPOINTMENT.title]:
                    titleProperty(
                        patientName
                    ),

                [APPOINTMENT.patientRelation]:
                {
                    relation: [
                        {
                            id:
                                patient.id
                        }
                    ]
                },

                [APPOINTMENT.date]:
                    dateProperty(
                        appointmentDate
                    ),

                [APPOINTMENT.status]:
                    selectProperty(
                        "Confirmed"
                    ),

                [APPOINTMENT.googleEventId]:
                    textProperty(
                        event.id
                    )
            }
        });


    console.log(
        `✅ Appointment created: ${event.id}`
    );


    return appointment;
}


// ======================================================
// GET PATIENT FROM APPOINTMENT RELATION
// ======================================================

function getPatientIdFromAppointment(
    appointment
) {

    const relation =
        appointment.properties[
            APPOINTMENT.patientRelation
        ]?.relation;


    return (
        relation?.[0]?.id ||
        null
    );
}


// ======================================================
// FIND PATIENT HISTORY BY PATIENT RELATION
// ======================================================

async function findPatientHistoryByPatientId(
    patientId
) {

    if (!patientId) {
        return null;
    }


    const response =
        await notion.dataSources.query({

            data_source_id:
                NOTION_PATIENT_HISTORY_DATA_SOURCE_ID,

            filter: {

                property:
                    HISTORY.patientRelation,

                relation: {
                    contains:
                        patientId
                }
            }
        });


    return (
        response.results.find(
            item =>
                item.object === "page"
        ) ||
        null
    );
}


// ======================================================
// CREATE OR UPDATE PATIENT HISTORY
// ======================================================

async function upsertPatientHistory({
    patientId,
    name,
    medicalHistory,
    diagnoses,
    medications,
    allergies,
    goals,
    specialNotes
}) {

    if (
        !NOTION_PATIENT_HISTORY_DATA_SOURCE_ID
    ) {

        console.log(
            "ℹ️ Patient History data source not configured"
        );

        return;
    }


    const existing =
        await findPatientHistoryByPatientId(
            patientId
        );


    const properties = {};


    if (name) {

        properties[
            HISTORY.title
        ] =
            titleProperty(
                name
            );
    }


    properties[
        HISTORY.patientRelation
    ] = {

        relation: [
            {
                id:
                    patientId
            }
        ]
    };


    if (medicalHistory) {

        properties[
            HISTORY.medicalHistory
        ] =
            textProperty(
                medicalHistory
            );
    }


    if (diagnoses) {

        properties[
            HISTORY.diagnoses
        ] =
            textProperty(
                diagnoses
            );
    }


    if (medications) {

        properties[
            HISTORY.medications
        ] =
            textProperty(
                medications
            );
    }


    if (allergies) {

        properties[
            HISTORY.allergies
        ] =
            textProperty(
                allergies
            );
    }


    if (goals) {

        properties[
            HISTORY.goals
        ] =
            textProperty(
                goals
            );
    }


    if (specialNotes) {

        properties[
            HISTORY.specialNotes
        ] =
            textProperty(
                specialNotes
            );
    }


    if (existing) {

        await notion.pages.update({

            page_id:
                existing.id,

            properties
        });


        console.log(
            `✅ Patient History updated for ${patientId}`
        );

        return;
    }


    await notion.pages.create({

        parent: {

            data_source_id:
                NOTION_PATIENT_HISTORY_DATA_SOURCE_ID
        },

        properties
    });


    console.log(
        `✅ Patient History created for ${patientId}`
    );
}


// ======================================================
// GOOGLE BOOKING FIELD EXTRACTION
// ======================================================

function looksLikeName(value) {

    if (!value) {
        return false;
    }


    if (value.includes("@")) {
        return false;
    }


    if (
        /^\+?[\d\s()-]+$/
            .test(value)
    ) {

        return false;
    }


    return true;
}


function parseGoogleBooking(
    event
) {

    const description =
        event.description || "";


    const cleanDescription =
        description
            .replace(
                /<[^>]*>/g,
                ""
            )
            .split("\n")
            .map(
                line =>
                    line.trim()
            )
            .filter(Boolean);


    let name = null;


    const bookedByIndex =
        cleanDescription
            .findIndex(
                line =>
                    line
                        .toLowerCase() ===
                    "booked by"
            );


    if (
        bookedByIndex !== -1
    ) {

        const possibleName =
            cleanDescription[
                bookedByIndex + 1
            ];


        if (
            looksLikeName(
                possibleName
            )
        ) {

            name =
                possibleName;
        }
    }


    if (
        !name &&
        event.summary
    ) {

        const summaryMatch =
            event.summary.match(
                /\(([^()]+)\)\s*$/
            );


        if (
            summaryMatch?.[1] &&
            looksLikeName(
                summaryMatch[1]
            )
        ) {

            name =
                summaryMatch[1]
                    .trim();
        }
    }


    if (!name) {

        name =
            "Unknown Patient";
    }


    const emailMatch =
        description.match(
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
        );


    const email =
        emailMatch
            ? emailMatch[0]
                .toLowerCase()
            : null;


    const phoneMatch =
        description.match(
            /(?:\+?\d[\d\s()-]{8,}\d)/
        );


    const phone =
        phoneMatch
            ? normalizeIndiaPhone(
                phoneMatch[0]
            )
            : null;


    return {
        name,
        email,
        phone,
        description
    };
}


// ======================================================
// GOOGLE BOOKING SYNC
// ======================================================

async function syncRecentGoogleBookings() {

    console.log(
        "🔎 Checking recently changed Google Calendar events..."
    );


    const tenMinutesAgo =
        new Date(
            Date.now() -
            10 * 60 * 1000
        ).toISOString();


    const response =
        await calendar.events.list({

            calendarId:
                process.env
                    .GOOGLE_CALENDAR_ID ||
                "primary",

            updatedMin:
                tenMinutesAgo,

            singleEvents:
                true,

            showDeleted:
                false,

            maxResults:
                50
        });


    const events =
        response.data.items ||
        [];


    console.log(
        `📅 Found ${events.length} recently changed events`
    );


    for (
        const event
        of events
    ) {

        console.log(
            "Changed event:",
            event.id,
            event.summary
        );


        await processGoogleBooking(
            event
        );
    }
}


// ======================================================
// PROCESS GOOGLE BOOKING
// ======================================================

async function processGoogleBooking(
    event
) {

    // -------------------------------
    // IN-MEMORY DUPLICATE LOCK
    // -------------------------------

    if (
        processingGoogleEvents
            .has(event.id)
    ) {

        console.log(
            "⏭️ Event already being processed:",
            event.id
        );

        return;
    }


    processingGoogleEvents
        .add(event.id);


    try {

        console.log(
            "📌 Processing Google booking"
        );

        console.log(
            "Event ID:",
            event.id
        );

        console.log(
            "Summary:",
            event.summary
        );


        const description =
            event.description ||
            "";


        const isAppointmentSchedule =
            event.summary
                ?.includes(
                    GOOGLE_APPOINTMENT_SUMMARY
                );


        const isBookedEvent =
            description.includes(
                "Booked by"
            );


        // -------------------------------
        // IGNORE NORMAL CALENDAR EVENTS
        // -------------------------------

        if (
            !isAppointmentSchedule ||
            !isBookedEvent
        ) {

            console.log(
                "⏭️ Event is not a patient booking"
            );

            return;
        }


        // -------------------------------
        // PERSISTENT DUPLICATE CHECK
        // -------------------------------

        const existingAppointment =
            await findAppointmentByGoogleEventId(
                event.id
            );


        if (
            existingAppointment
        ) {

            console.log(
                "⏭️ Appointment already exists:",
                event.id
            );

            return;
        }


        const booking =
            parseGoogleBooking(
                event
            );


        const {
            name,
            email,
            phone
        } = booking;


        console.log(
            "Patient name:",
            name
        );

        console.log(
            "Patient email:",
            email
        );

        console.log(
            "Patient phone:",
            phone
        );


        if (!phone) {

            console.log(
                "⚠️ Booking has no phone number"
            );

            return;
        }


        // -------------------------------
        // FIND EXISTING PATIENT
        // OR CREATE NEW ONE
        //
        // PHONE ALONE IS NEVER USED
        // -------------------------------

        let patient =
            await findMatchingPatient({
                name,
                email,
                phone
            });


        if (!patient) {

            patient =
                await createPatient({

                    phone,

                    name,

                    email,

                    stage:
                        "Booked"
                });

        } else {

            await updatePatient(
                patient.id,
                {
                    name,
                    phone,
                    email,
                    stage:
                        "Booked"
                }
            );
        }


        // -------------------------------
        // CREATE APPOINTMENT
        // -------------------------------

        const appointment =
            await createAppointment({

                patient,

                patientName:
                    name,

                event
            });


        console.log(
            "✅ Appointment linked to patient:",
            patient.id
        );


        // -------------------------------
        // FORMAT APPOINTMENT DATE
        // -------------------------------

        const appointmentDate =
            event.start?.dateTime ||
            event.start?.date;


        let formattedDate =
            appointmentDate;


        if (appointmentDate) {

            formattedDate =
                new Date(
                    appointmentDate
                )
                    .toLocaleString(
                        "en-IN",
                        {
                            timeZone:
                                "Asia/Kolkata",

                            dateStyle:
                                "medium",

                            timeStyle:
                                "short"
                        }
                    );
        }


        // -------------------------------
        // BUILD INTAKE LINK
        //
        // IMPORTANT:
        // appointment_id = Google Event ID
        // -------------------------------

        const separator =
            INTAKE_FORM_URL
                .includes("?")
                ? "&"
                : "?";


        const intakeUrl =
            `${INTAKE_FORM_URL}${separator}appointment_id=${encodeURIComponent(event.id)}`;


        // -------------------------------
        // SEND WHATSAPP
        // -------------------------------

        await sendWhatsAppMessage(

            phone,

            {
                type: "text",

                text: {

                    body:
`Your appointment is confirmed ✅

📅 Date & Time:
${formattedDate}

Before your consultation, please complete this short intake form:

👉 ${intakeUrl}

This helps the practitioner prepare for your consultation.`
                }
            }
        );


        console.log(
            `✅ WhatsApp confirmation sent to ${phone}`
        );


    } catch (error) {

        console.error(
            "❌ processGoogleBooking failed:"
        );


        console.error(
            error.response?.data ||
            error.body ||
            error.message ||
            error
        );


    } finally {

        processingGoogleEvents
            .delete(event.id);


        console.log(
            "🔓 Released event lock:",
            event.id
        );
    }
}


// ======================================================
// WHATSAPP MAIN MENU
// ======================================================

async function sendMainMenu(to) {

    await sendWhatsAppMessage(
        to,
        {

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
                            type:
                                "reply",

                            reply: {

                                id:
                                    "book_appointment",

                                title:
                                    "Book Appointment"
                            }
                        },

                        {
                            type:
                                "reply",

                            reply: {

                                id:
                                    "existing_patient",

                                title:
                                    "Existing Patient"
                            }
                        }
                    ]
                }
            }
        }
    );
}


app.get("/notion-appointments-info", async (req, res) => {
    try {
        const response = await notion.databases.retrieve({
            database_id:
                process.env.NOTION_APPOINTMENTS_DATABASE_ID
        });

        res.json({
            database_id: response.id,
            data_sources: response.data_sources
        });

    } catch (error) {
        res.status(500).json({
            ok: false,
            error: error.body || error.message
        });
    }
});

// ======================================================
// META WEBHOOK VERIFICATION
// ======================================================

app.get(
    "/webhook",
    (req, res) => {

        const mode =
            req.query[
                "hub.mode"
            ];


        const verify =
            req.query[
                "hub.verify_token"
            ];


        const challenge =
            req.query[
                "hub.challenge"
            ];


        if (
            mode ===
                "subscribe" &&
            verify ===
                VERIFY_TOKEN
        ) {

            return res
                .status(200)
                .send(
                    challenge
                );
        }


        return res
            .sendStatus(403);
    }
);


// ======================================================
// WHATSAPP WEBHOOK
// ======================================================

app.post(
    "/webhook",
    async (req, res) => {

        try {

            const change =
                req.body.entry?.[0]
                    ?.changes?.[0]
                    ?.value;


            if (
                !change?.messages
            ) {

                return res
                    .sendStatus(200);
            }


            const message =
                change.messages[0];


            const from =
                normalizeIndiaPhone(
                    message.from
                );


            // -------------------------------
            // TEXT
            // -------------------------------

            if (
                message.type ===
                "text"
            ) {

                const text =
                    message.text?.body
                        ?.trim()
                        ?.toLowerCase();


                if (
                    text === "hi" ||
                    text === "hello" ||
                    text === "hey" ||
                    text === "start" ||
                    text === "menu"
                ) {

                    await sendMainMenu(
                        from
                    );


                    return res
                        .sendStatus(200);
                }


                await sendWhatsAppMessage(
                    from,
                    {

                        type:
                            "text",

                        text: {

                            body:
`Thanks for reaching out. 😊

Please send *Hi* to open the clinic menu.`
                        }
                    }
                );


                return res
                    .sendStatus(200);
            }


            // -------------------------------
            // BUTTON
            // -------------------------------

            if (
                message.type ===
                    "interactive" &&
                message.interactive
                    ?.type ===
                    "button_reply"
            ) {

                const buttonId =
                    message
                        .interactive
                        .button_reply
                        .id;


                // -------------------------------
                // BOOK APPOINTMENT
                //
                // IMPORTANT:
                // DO NOT CREATE PATIENT HERE.
                // -------------------------------

                if (
                    buttonId ===
                    "book_appointment"
                ) {

                    await sendWhatsAppMessage(

                        from,

                        {

                            type:
                                "text",

                            text: {

                                body:
`Great! 📅

Choose a convenient consultation slot here:

👉 ${GOOGLE_BOOKING_URL}

You'll only see the practitioner's available times.

Please enter the patient's correct name, email and WhatsApp number while booking.`
                            }
                        }
                    );


                    return res
                        .sendStatus(200);
                }


                // -------------------------------
                // EXISTING PATIENT
                // -------------------------------

                if (
                    buttonId ===
                    "existing_patient"
                ) {

                    await sendWhatsAppMessage(

                        from,

                        {

                            type:
                                "interactive",

                            interactive: {

                                type:
                                    "button",

                                body: {

                                    text:
`Welcome back 👋

What would you like to do?`
                                },

                                action: {

                                    buttons: [

                                        {
                                            type:
                                                "reply",

                                            reply: {

                                                id:
                                                    "existing_followup",

                                                title:
                                                    "Follow-up"
                                            }
                                        },

                                        {
                                            type:
                                                "reply",

                                            reply: {

                                                id:
                                                    "existing_checkin",

                                                title:
                                                    "Check-in"
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    );


                    return res
                        .sendStatus(200);
                }


                // -------------------------------
                // FOLLOW-UP
                // -------------------------------

                if (
                    buttonId ===
                    "existing_followup"
                ) {

                    if (
                        FOLLOWUP_FORM_URL
                    ) {

                        await sendWhatsAppMessage(
                            from,
                            {

                                type:
                                    "text",

                                text: {

                                    body:
`You can request your follow-up here:

👉 ${FOLLOWUP_FORM_URL}`
                                }
                            }
                        );

                    } else {

                        await sendWhatsAppMessage(
                            from,
                            {

                                type:
                                    "text",

                                text: {

                                    body:
`Your follow-up request has been received.

The clinic team will contact you shortly.`
                                }
                            }
                        );
                    }


                    return res
                        .sendStatus(200);
                }


                // -------------------------------
                // CHECK-IN
                // -------------------------------

                if (
                    buttonId ===
                    "existing_checkin"
                ) {

                    await sendWhatsAppMessage(
                        from,
                        {

                            type:
                                "text",

                            text: {

                                body:
`Please complete your latest check-in here:

👉 ${CHECKIN_FORM_URL}

Your update will be shared with the clinic team.`
                            }
                        }
                    );


                    return res
                        .sendStatus(200);
                }
            }


            return res
                .sendStatus(200);


        } catch (error) {

            console.error(
                "❌ WhatsApp webhook error:"
            );


            console.error(
                error.response?.data ||
                error.body ||
                error.message ||
                error
            );


            return res
                .sendStatus(500);
        }
    }
);


// ======================================================
// INTAKE WEBHOOK
//
// NEW FLOW:
//
// intake appointment_id
// → find Appointment
// → Appointment relation gives Patient
// → update that Patient
// → update/create Patient History
//
// INTAKE NEVER CREATES A PATIENT.
// ======================================================

app.post(
    "/intake-webhook",
    async (req, res) => {

        console.log(
            "📥 Intake webhook received"
        );


        try {

            const fields =
                getFormFields(
                    req.body
                );


            if (
                !fields.length
            ) {

                return res
                    .status(400)
                    .send(
                        "No form fields found"
                    );
            }


            // -------------------------------
            // HIDDEN APPOINTMENT ID
            // -------------------------------

            const appointmentIdRaw =
                getFieldValue(
                    fields,
                    [
                        "^appointment_id$",
                        "^Appointment ID$",
                        "appointment"
                    ]
                );


            const appointmentId =
                readableValue(
                    appointmentIdRaw
                )
                    ?.trim();


            if (
                !appointmentId
            ) {

                console.error(
                    "❌ appointment_id missing from intake"
                );


                return res
                    .status(400)
                    .send(
                        "appointment_id missing"
                    );
            }


            const appointment =
                await findAppointmentByGoogleEventId(
                    appointmentId
                );


            if (
                !appointment
            ) {

                console.error(
                    "❌ Appointment not found:",
                    appointmentId
                );


                return res
                    .status(404)
                    .send(
                        "Appointment not found"
                    );
            }


            const patientId =
                getPatientIdFromAppointment(
                    appointment
                );


            if (!patientId) {

                console.error(
                    "❌ Appointment has no Patient relation"
                );


                return res
                    .status(400)
                    .send(
                        "Appointment has no patient"
                    );
            }


            // -------------------------------
            // NORMAL INTAKE FIELDS
            // -------------------------------

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


            const email =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Patient Email",
                            "Email Address",
                            "^Email$"
                        ]
                    )
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


            const phone =
                normalizeIndiaPhone(
                    phoneRaw
                );


            const address =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Home Address",
                            "Residential Address",
                            "^Address$"
                        ]
                    )
                );


            const dobRaw =
                getFieldValue(
                    fields,
                    [
                        "Date of Birth",
                        "^DOB$"
                    ]
                );


            const dob =
                toDateOnly(
                    dobRaw
                );


            // -------------------------------
            // PATIENT HISTORY FIELDS
            // -------------------------------

            const medicalHistory =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Medical History"
                        ]
                    )
                );


            const diagnoses =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Diagnoses",
                            "Diagnosis"
                        ]
                    )
                );


            const medications =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Medications",
                            "Medication"
                        ]
                    )
                );


            const allergies =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Allergies"
                        ]
                    )
                );


            const goals =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Goals"
                        ]
                    )
                );


            const specialNotes =
                readableValue(
                    getFieldValue(
                        fields,
                        [
                            "Special Notes",
                            "Notes"
                        ]
                    )
                );


            // -------------------------------
            // UPDATE EXACT PATIENT
            // -------------------------------

            await updatePatient(
                patientId,
                {
                    name:
                        name || undefined,

                    phone:
                        phone || undefined,

                    email:
                        email || undefined,

                    dateOfBirth:
                        dob || undefined,

                    address:
                        address || undefined

                    // DO NOT CHANGE Patient Stage here.
                    // It stays Booked.
                }
            );


            // -------------------------------
            // PATIENT HISTORY
            // -------------------------------

            await upsertPatientHistory({

                patientId,

                name,

                medicalHistory,

                diagnoses,

                medications,

                allergies,

                goals,

                specialNotes
            });


            console.log(
                `✅ Intake saved for patient ${patientId}`
            );


            if (phone) {

                try {

                    await sendWhatsAppMessage(
                        phone,
                        {

                            type:
                                "text",

                            text: {

                                body:
`Thank you! ✅

Your intake form has been received successfully.

The clinic now has the information required for your consultation.`
                            }
                        }
                    );

                } catch (error) {

                    console.error(
                        "⚠️ Intake saved, but WhatsApp confirmation failed:",
                        error.response?.data ||
                        error.message
                    );
                }
            }


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
                error.response?.data ||
                error.message ||
                error
            );


            return res
                .sendStatus(500);
        }
    }
);


// ======================================================
// CHECK-IN WEBHOOK
//
// FOR NOW THIS STILL MATCHES BY PHONE.
// WE CAN UPGRADE THIS NEXT USING Patient ID,
// JUST LIKE WE DID FOR INTAKE.
// ======================================================

app.post(
    "/checkin-webhook",
    async (req, res) => {

        try {

            const fields =
                getFormFields(
                    req.body
                );


            if (
                !fields.length
            ) {

                return res
                    .status(400)
                    .send(
                        "No check-in fields found"
                    );
            }


            console.log(
                "📈 Check-in received"
            );


            return res
                .status(200)
                .send(
                    "Check-in received"
                );


        } catch (error) {

            console.error(
                "❌ Check-in error:",
                error
            );


            return res
                .sendStatus(500);
        }
    }
);


// ======================================================
// GOOGLE AUTH
// ======================================================

app.get(
    "/google/auth",
    (req, res) => {

        const authUrl =
            googleOAuthClient
                .generateAuthUrl({

                    access_type:
                        "offline",

                    prompt:
                        "consent",

                    scope: [

                        "https://www.googleapis.com/auth/calendar.readonly"
                    ]
                });


        res.redirect(
            authUrl
        );
    }
);


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
                    .getToken(
                        code
                    );


            console.log(
                "Google OAuth complete."
            );


            // TEMPORARY ONLY:
            console.log(
                "Refresh token:",
                tokens.refresh_token
            );


            res.send(
                "Google Calendar connected."
            );


        } catch (error) {

            console.error(
                "Google OAuth failed:",
                error
            );


            res
                .status(500)
                .send(
                    "Google OAuth failed"
                );
        }
    }
);


// ======================================================
// GOOGLE CALENDAR WATCH
// ======================================================

app.get(
    "/google-calendar/start-watch",
    async (req, res) => {

        try {

            const channelId =
                crypto.randomUUID();


            const response =
                await calendar.events.watch({

                    calendarId:
                        process.env
                            .GOOGLE_CALENDAR_ID ||
                        "primary",

                    requestBody: {

                        id:
                            channelId,

                        type:
                            "web_hook",

                        address:
                            `${process.env.PUBLIC_BASE_URL}/google-calendar-webhook`,

                        token:
                            process.env
                                .GOOGLE_WEBHOOK_TOKEN
                    }
                });


            console.log(
                "✅ Google watch created:",
                response.data
            );


            return res.json({

                ok:
                    true,

                channel:
                    response.data
            });


        } catch (error) {

            console.error(
                "Google watch failed:",
                error.response?.data ||
                error.message
            );


            return res
                .status(500)
                .json({

                    ok:
                        false,

                    error:
                        error.response?.data ||
                        error.message
                });
        }
    }
);


app.post(
    "/google-calendar-webhook",
    async (req, res) => {

        res.sendStatus(200);


        try {

            const resourceState =
                req.headers[
                    "x-goog-resource-state"
                ];


            const channelToken =
                req.headers[
                    "x-goog-channel-token"
                ];


            if (
                channelToken !==
                process.env
                    .GOOGLE_WEBHOOK_TOKEN
            ) {

                console.error(
                    "❌ Invalid Google webhook token"
                );

                return;
            }


            if (
                resourceState ===
                "sync"
            ) {

                console.log(
                    "✅ Google Calendar watch initialized"
                );

                return;
            }


            console.log(
                "📅 Google Calendar changed"
            );


            await syncRecentGoogleBookings();


        } catch (error) {

            console.error(
                "Calendar webhook processing failed:",
                error
            );
        }
    }
);


// ======================================================
// HEALTH CHECKS
// ======================================================

app.get(
    "/",
    (req, res) => {

        res
            .status(200)
            .send(
                "WhatsApp Clinic Automation is running ✅"
            );
    }
);


app.get(
    "/notion-health",
    async (req, res) => {

        try {

            const [
                patients,
                appointments
            ] =
                await Promise.all([

                    notion.dataSources
                        .retrieve({

                            data_source_id:
                                NOTION_PATIENTS_DATA_SOURCE_ID
                        }),

                    notion.dataSources
                        .retrieve({

                            data_source_id:
                                NOTION_APPOINTMENTS_DATA_SOURCE_ID
                        })
                ]);


            return res.json({

                ok:
                    true,

                patients:
                    patients.id,

                appointments:
                    appointments.id
            });


        } catch (error) {

            return res
                .status(500)
                .json({

                    ok:
                        false,

                    error:
                        error.body ||
                        error.message
                });
        }
    }
);


// ======================================================
// SERVER START
// ======================================================

const PORT =
    process.env.PORT ||
    3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `✅ Clinic automation running on port ${PORT}`
        );
    }
);