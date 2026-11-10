APPOINTMENT WEBSITE SETUP

This project keeps the original pink/white design and adds a multi-date calendar,
shared server-side availability, one booking per date, and email/SMS integration.

1. Install Node.js LTS from https://nodejs.org/
2. Open this folder in VS Code.
3. In the VS Code terminal run: npm install
4. Copy .env.example to a file named .env.
5. Configure SMTP email settings and Twilio SMS settings in .env.
   Email requires SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM and BUSINESS_EMAIL.
   SMS requires a Twilio account, credentials, and an SMS-enabled sender number.
   Twilio SMS is paid and destination-country rules apply.
6. Change ADMIN_CODE in .env before publishing.
7. Start: npm start
8. Visit: http://localhost:3000

Do not use VS Code Live Server (127.0.0.1:5500) for this project.
The Node server serves both the webpage and its API.

The server creates data.json automatically. For production hosting, use a host with
persistent storage or replace this simple JSON data store with a managed database.
Configure all .env values in the hosting provider's environment settings.
Email/SMS notifications will not send until valid provider credentials are supplied.
