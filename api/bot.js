// api/bot.js - Telegram Bot Webhook Handler
const TREASURY = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const ENTRY_SOL = 0.025;
const GAME_URL = "https://duck-race-society.vercel.app";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const update = req.body;
  const msg = update.message || update.callback_query?.message;
  const callbackData = update.callback_query?.data;
  const chatId = msg?.chat?.id;
  const from = update.message?.from || update.callback_query?.from;
  const userName = from?.first_name || "Player";
  const text = update.message?.text || "";

  if (!chatId) return res.status(200).json({ ok: true });

  async function sendMessage(txt, extra = {}) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: txt, parse_mode: "HTML", ...extra })
    });
  }

  if (update.callback_query) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: update.callback_query.id })
    });
  }

  try {
    if (text.startsWith("/start") || callbackData === "join") {
      await sendMessage(
        `🦆 <b>DUCK RACE SOCIETY</b>\n\nHey ${userName}!\n\n` +
        `<b>HOW TO JOIN:</b>\n` +
        `1️⃣ Send <code>${ENTRY_SOL} SOL</code> to:\n<code>${TREASURY}</code>\n\n` +
        `2️⃣ Open the game\n` +
        `3️⃣ Join lobby + place bet + race! 🏁\n\n` +
        `🏆 Winner: <b>80% SOL + 500 $TRC</b>`,
        { reply_markup: { inline_keyboard: [
          [{ text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }],
          [{ text: "🦆 JOIN RACE", callback_data: "join" }]
        ]}}
      );
    } else if (text === "/join") {
      await sendMessage(
        `🦆 <b>JOIN A RACE</b>\n\n` +
        `Send <code>${ENTRY_SOL} SOL</code> to:\n<code>${TREASURY}</code>\n\n` +
        `Then open the game and join the lobby!`,
        { reply_markup: { inline_keyboard: [[
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    } else if (text === "/help") {
      await sendMessage(
        `🦆 <b>HOW TO PLAY</b>\n\n` +
        `/start - Main menu\n/join - Join a race\n\n` +
        `Treasury:\n<code>${TREASURY}</code>`
      );
    }
  } catch(e) {
    console.error("Bot error:", e);
  }

  return res.status(200).json({ ok: true });
};





