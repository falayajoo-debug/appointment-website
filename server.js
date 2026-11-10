
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 3000;
const DB = path.join(__dirname, "data.json");

// ==========================================
// CORS CONFIGURATION
// ==========================================

const allowedOrigins = [
  ...(process.env.FRONTEND_URL || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean),
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  const isAllowed =
    !origin ||
    allowedOrigins.includes(origin) ||
    /^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(origin);

  if (origin && isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-code"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  if (origin && !isAllowed) {
    return res.status(403).json({
      error: "This website is not allowed to access the server."
    });
  }

  next();
});

app.use(express.json());

// ==========================================
// DATABASE
// ==========================================

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB, "utf8"));
  } catch {
    return { dates: [], bookings: [] };
  }
}

function write(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

function auth(req) {
  return Boolean(
    process.env.ADMIN_CODE &&
    req.headers["x-admin-code"] === process.env.ADMIN_CODE
  );
}

// ==========================================
// DATE VALIDATION
// ==========================================

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }

  const parsed = new Date(date + "T12:00:00");

  if (isNaN(parsed.getTime())) {
    return false;
  }

  if (parsed.toISOString().slice(0, 10) !== date) {
    return false;
  }

  const today = new Date();
  const todayString =
    today.getFullYear() + "-" +
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0");

  return date >= todayString;
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/", (req, res) => {
  res.send("Appointment booking server is running.");
});

// ==========================================
// CUSTOMER: GET AVAILABLE DATES
// ==========================================

app.get("/api/dates", (req, res) => {
  res.json({ dates: read().dates });
});

// ==========================================
// ADMIN: VERIFY CODE AND GET DATES
// ==========================================

app.get("/api/admin/dates", (req, res) => {
  if (!auth(req)) {
    return res.status(401).json({
      error: "Incorrect admin code."
    });
  }

  res.json({ dates: read().dates });
});

// ==========================================
// ADMIN: SAVE AVAILABLE DATES
// ==========================================

app.post("/api/admin/dates", (req, res) => {
  if (!auth(req)) {
    return res.status(401).json({
      error: "Incorrect admin code."
    });
  }

  const dates = Array.isArray(req.body.dates)
    ? req.body.dates
    : [];

  if (dates.some(date => !validDate(date))) {
    return res.status(400).json({
      error: "Choose valid dates today or later."
    });
  }

  const data = read();

  data.dates = [...new Set(dates)].sort();

  write(data);

  res.json({ dates: data.dates });
});

// ==========================================
// EMAIL NOTIFICATIONS
// ==========================================

async function sendEmail(to, subject, message) {
  if (
    !to ||
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS ||
    !process.env.SMTP_FROM
  ) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: message
  });

  return true;
}

// ==========================================
// SMS NOTIFICATIONS
// ==========================================

async function sendSMS(to, message) {
  if (
    !to ||
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    return false;
  }

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to.startsWith("+")
      ? to
      : "+" + to.replace(/\D/g, "")
  });

  return true;
}

// ==========================================
// CUSTOMER: BOOK APPOINTMENT
// ==========================================

app.post("/api/bookings", async (req, res) => {
  try {
    const {
      name,
      email: customerEmail,
      phone,
      service,
      date
    } = req.body || {};

    if (
      !name ||
      !customerEmail ||
      !phone ||
      !service ||
      !date
    ) {
      return res.status(400).json({
        error: "Please complete every field."
      });
    }

    const data = read();

    if (!data.dates.includes(date)) {
      return res.status(409).json({
        error: "That date is no longer available. Please choose another date."
      });
    }

    data.dates = data.dates.filter(item => item !== date);

    data.bookings.push({
      name,
      email: customerEmail,
      phone,
      service,
      date,
      createdAt: new Date().toISOString()
    });

    write(data);

    const dateText = new Date(
      date + "T12:00:00"
    ).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });

    const customerMessage =
      `Hello ${name}, your appointment for ${service} on ${dateText} has been booked.`;

    const businessMessage =
      `New appointment: ${name}; ${customerEmail}; ${phone}; ${service}; ${dateText}.`;

    const notifications = {};

    const tasks = {
      customerEmail: () =>
        sendEmail(
          customerEmail,
          "Appointment confirmation",
          customerMessage
        ),

      businessEmail: () =>
        sendEmail(
          process.env.BUSINESS_EMAIL,
          "New appointment booking",
          businessMessage
        ),

      customerSMS: () =>
        sendSMS(phone, customerMessage),

      businessSMS: () =>
        sendSMS(
          process.env.BUSINESS_PHONE,
          businessMessage
        )
    };

    for (const [key, task] of Object.entries(tasks)) {
      try {
        notifications[key] = await task();
      } catch (error) {
        notifications[key] = false;
        console.error(key, error.message);
      }
    }

    res.status(201).json({
      message: "Your appointment has been booked.",
      notifications
    });

  } catch (error) {
    console.error("Booking error:", error);

    res.status(500).json({
      error: "Something went wrong while booking your appointment."
    });
  }
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, () => {
  console.log(`Website running on port ${PORT}`);
});
