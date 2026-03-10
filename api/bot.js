// api/bot.js - Telegram Bot Webhook Handler
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
        `🦆 <b>DUCK RACE SOCIETY</b>\n\nHey ${userName}! Welcome to the fastest duck races on Solana! 🏁\n\n` +
        `<b>HOW TO JOIN:</b>\n` +
        `1️⃣ Open the game\n` +
        `2️⃣ Join the lobby\n` +
        `3️⃣ Follow the instructions inside the game\n` +
        `4️⃣ Race your duck! 🦆⚡`,
        { reply_markup: { inline_keyboard: [
          [{ text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }]
        ]}}
      );
    } else if (text === "/join") {
      await sendMessage(
        `🦆 <b>READY TO RACE?</b>\n\n` +
        `Open the game, join the lobby and follow the instructions!\n\n` +
        `See you on the track! 🏁`,
        { reply_markup: { inline_keyboard: [[
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    } else if (text === "/help") {
      await sendMessage(
        `🦆 <b>HOW TO PLAY</b>\n\n` +
        `1️⃣ Open the game\n` +
        `2️⃣ Join the lobby\n` +
        `3️⃣ Follow the in-game instructions\n` +
        `4️⃣ Race & win! 🏆\n\n` +
        `/start - Main menu\n` +
        `/join - Join a race`,
        { reply_markup: { inline_keyboard: [[
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    }
  } catch(e) {
    console.error("Bot error:", e);
  }

  return res.status(200).json({ ok: true });
};







