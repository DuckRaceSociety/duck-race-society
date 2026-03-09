/ api/bot.js
const TREASURY = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const ENTRY_SOL = 0.025;
const GAME_URL = "https://duck-race-society.vercel.app";

async function sendMessage(token, chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra })
  });
}

async function answerCallback(token, id) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id })
  });
}

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

  try {

    // /start
    if (text === "/start" || text.startsWith("/start ")) {
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>Welcome to DUCK RACE SOCIETY!</b>\n\n` +
        `◎ Bet SOL · Race ducks · Win rewards!\n` +
        `🪙 500 $TRC bonus every race!\n` +
        `⚡ Power-Ups change everything!\n\n` +
        `Press <b>JOIN RACE</b> to get started!`,
        { reply_markup: { inline_keyboard: [[
          { text: "🦆 JOIN RACE", callback_data: "join" },
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    }

    // /join or callback join
    else if (text === "/join" || callbackData === "join") {
      if (callbackData) await answerCallback(BOT_TOKEN, update.callback_query.id);
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>HOW TO JOIN A RACE</b>\n\n` +
        `<b>STEP 1:</b> Send <code>${ENTRY_SOL} SOL</code> to:\n\n` +
        `<code>${TREASURY}</code>\n\n` +
        `<b>STEP 2:</b> Open the game and join the lobby\n\n` +
        `<b>STEP 3:</b> Place your bet and race! 🏁\n\n` +
        `🏆 Winner gets <b>80% SOL + 500 $TRC</b>`,
        { reply_markup: { inline_keyboard: [[
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    }

    // /help
    else if (text === "/help") {
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>HOW TO PLAY</b>\n\n` +
        `1️⃣ Type /join\n` +
        `2️⃣ Send <b>${ENTRY_SOL} SOL</b> to treasury\n` +
        `3️⃣ Open the game\n` +
        `4️⃣ Join lobby + place bet\n` +
        `5️⃣ Watch your duck race!\n\n` +
        `🏆 Winner gets 80% SOL + 500 $TRC\n` +
        `⚡ Buy Power-Ups in the game!\n\n` +
        `Treasury:\n<code>${TREASURY}</code>`
      );
    }

    // /lobby
    else if (text === "/lobby") {
      await sendMessage(BOT_TOKEN, chatId,
        `🎮 <b>CHECK THE LOBBY</b>\n\nOpen the game to see who's in the lobby!`,
        { reply_markup: { inline_keyboard: [[
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    }

  } catch(e) {
    console.error("Bot error:", e);
  }

  res.status(200).json({ ok: true });
};

