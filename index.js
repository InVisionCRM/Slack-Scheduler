import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { google } from "googleapis";
import { WebClient } from "@slack/web-api";

dotenv.config();

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Google Calendar setup
const calendar = google.calendar({ version: "v3" });
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/calendar"]
);

// Handle Slack command
app.post("/slack/schedule", async (req, res) => {
  res.send("📅 Working on it…"); // quick response to Slack
  const { text, user_name } = req.body;

  try {
    // Parse command: "/schedule john-doe inspection tomorrow 2pm"
    const [leadName, jobType, date, time] = text.split(" ");
    const crmUrl = `${process.env.CRM_API_BASE}/leads?name=${leadName}`;

    // 1️⃣ Lookup lead in CRM
    const lead = await fetch(crmUrl).then((r) => r.json());
    if (!lead || lead.length === 0) {
      await slack.chat.postMessage({
        channel: req.body.channel_id,
        text: `❌ Lead *${leadName}* not found in CRM.`,
      });
      return;
    }

    const client = lead[0];
    const startTime = new Date(`${date} ${time}`);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour

    // 2️⃣ Check calendar & create event
    const event = {
      summary: `${jobType.toUpperCase()} - ${client.name}`,
      description: `Lead ID: ${client.id}\nAddress: ${client.address}\nScheduled by ${user_name}`,
      start: { dateTime: startTime.toISOString(), timeZone: "America/Chicago" },
      end: { dateTime: endTime.toISOString(), timeZone: "America/Chicago" },
    };

    await calendar.events.insert({
      auth,
      calendarId: "primary",
      requestBody: event,
    });

    // 3️⃣ Update CRM with appointment info
    await fetch(`${process.env.CRM_API_BASE}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: client.id,
        type: jobType,
        date: startTime,
        created_by: user_name,
      }),
    });

    // 4️⃣ Post confirmation
    await slack.chat.postMessage({
      channel: req.body.channel_id,
      text: `✅ *${jobType.toUpperCase()}* scheduled for *${client.name}* on ${date} at ${time}\n📍 ${client.address}`,
    });
  } catch (err) {
    console.error(err);
    await slack.chat.postMessage({
      channel: req.body.channel_id,
      text: `⚠️ Scheduling failed: ${err.message}`,
    });
  }
});

// Health check
app.get("/", (req, res) => res.send("RoofSched Bot Running"));

app.listen(process.env.PORT, () =>
  console.log(`✅ RoofSched Bot on port ${process.env.PORT}`)
);
