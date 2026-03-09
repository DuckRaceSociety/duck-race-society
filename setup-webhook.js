// api/setup-webhook.js
module.exports = async function handler(req, res) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const WEBHOOK_URL = "https://duck-race-society.vercel.app/api/bot";

  const resp = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        allowed_updates: ["message", "callback_query"]
      })
    }
  );
  const data = await resp.json();
  res.status(200).json(data);
}


