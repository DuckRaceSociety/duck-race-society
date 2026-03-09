// api/bot.js
module.exports = async function handler(req, res) {
  res.status(200).json({ ok: true });
  if (req.method !== "POST") return;

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const GAME = "https://duck-race-society.vercel.app";
  const TREASURY = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
  const update = req.body;
  if (!update) return;

  const msg = update.message;
  const cb = update.callback_query;
  const chatId = msg?.chat?.id || cb?.message?.chat?.id;
  const text = msg?.text || "";
  const cbData = cb?.data || "";
  const name = msg?.from?.first_name || cb?.from?.first_name || "Player";

  if (!chatId) return;

  const api = `https://api.telegram.org/bot${TOKEN}`;

  async function send(txt, keyboard) {
    const body = { chat_id: chatId, text: txt, parse_mode: "HTML" };
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
    await fetch(`${api}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  if (cb) {
    await fetch(`${api}/answerCallbackQuery`, {
      method: "POST", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cb.id })
    });
  }

  if (text.startsWith("/start") || cbData === "join") {
    await send(
      `🦆 <b>DUCK RACE SOCIETY</b>\n\nHey ${name}!\n\n` +
      `<b>HOW TO PLAY:</b>\n` +
      `1️⃣ Send <code>0.025 SOL</code> to treasury\n` +
      `2️⃣ Open the game\n` +
      `3️⃣ Join lobby + place bet\n` +
      `4️⃣ Race your duck! 🏁\n\n` +
      `💰 Treasury:\n<code>${TREASURY}</code>\n\n` +
      `🏆 Winner: 80% SOL + 500 $TRC`,
      [[{ text: "🎮 OPEN GAME", web_app: { url: GAME } }],
       [{ text: "🦆 HOW TO JOIN", callback_data: "join" }]]
    );
  }

  else if (text === "/join") {
    await send(
      `🦆 <b>JOIN A RACE</b>\n\n` +
      `Send <code>0.025 SOL</code> to:\n<code>${TREASURY}</code>\n\n` +
      `Then open the game and join the lobby!`,
      [[{ text: "🎮 OPEN GAME", web_app: { url: GAME } }]]
    );
  }

  else if (text === "/help") {
    await send(
      `🦆 <b>HELP</b>\n\n` +
      `/start - Main menu\n` +
      `/join - Join a race\n\n` +
      `Treasury: <code>${TREASURY}</code>`
    );
  }
};




