// api/bot.js - Telegram Bot Webhook Handler
const TREASURY = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const ENTRY_SOL = 0.025;
const LAMPORTS = Math.floor(ENTRY_SOL * 1_000_000_000);

const FIREBASE_PROJECT = "duck-race-society";
const FIREBASE_KEY = "AIzaSyDjdM2QAPbNwQXlnFbS9pf9Yi9eH1aK42c";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function firestoreSet(col, docId, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  await fetch(`${FIRESTORE_URL}/${col}/${docId}?key=${FIREBASE_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
}

async function firestoreGet(col, docId) {
  const resp = await fetch(`${FIRESTORE_URL}/${col}/${docId}?key=${FIREBASE_KEY}`);
  if (!resp.ok) return null;
  const data = await resp.json();
  if (data.error) return null;
  return data;
}

async function firestoreDelete(col, docId) {
  await fetch(`${FIRESTORE_URL}/${col}/${docId}?key=${FIREBASE_KEY}`, { method: "DELETE" });
}

async function firestoreAdd(col, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  await fetch(`${FIRESTORE_URL}/${col}?key=${FIREBASE_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
}

async function firestoreList(col) {
  const resp = await fetch(`${FIRESTORE_URL}/${col}?key=${FIREBASE_KEY}`);
  const data = await resp.json();
  return data.documents || [];
}

async function sendMessage(token, chatId, text, extra = {}) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra })
  });
  return resp.json();
}

async function answerCallback(token, id) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id })
  });
}

module.exports = async function handler(req, res) {
  // Always respond 200 immediately to Telegram
  res.status(200).json({ ok: true });

  if (req.method !== "POST") return;

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!BOT_TOKEN) return;

  const update = req.body;
  if (!update) return;

  const msg = update.message;
  const cb = update.callback_query;
  const chatId = msg?.chat?.id || cb?.message?.chat?.id;
  const from = msg?.from || cb?.from;
  const userId = String(from?.id || "");
  const userName = from?.first_name || "Player";
  const text = msg?.text || "";
  const cbData = cb?.data || "";

  if (!chatId) return;

  const GAME_URL = "https://duck-race-society.vercel.app";

  try {
    if (cb) await answerCallback(BOT_TOKEN, cb.id);

    // /start
    if (text.startsWith("/start") || cbData === "start") {
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>DUCK RACE SOCIETY</b>\n\nHey ${userName}! Welcome!\n\n` +
        `◎ Bet SOL · Race ducks · Win rewards!\n` +
        `🪙 500 $TRC bonus every race!\n` +
        `⚡ Power-Ups available!\n\n` +
        `Use /join to enter a race!`,
        { reply_markup: { inline_keyboard: [[
          { text: "🦆 JOIN RACE", callback_data: "join" },
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    }

    else if (text === "/join" || cbData === "join") {
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>HOW TO JOIN</b>\n\n` +
        `<b>1️⃣</b> Send <code>${ENTRY_SOL} SOL</code> to:\n\n` +
        `<code>${TREASURY}</code>\n\n` +
        `<b>2️⃣</b> Open the game\n` +
        `<b>3️⃣</b> Join lobby + place bet + race! 🏁\n\n` +
        `🏆 Winner gets <b>80% SOL + 500 $TRC</b>`,
        { reply_markup: { inline_keyboard: [[
          { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
        ]]}}
      );
    }

    else if (text === "/help") {
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>HOW TO PLAY</b>\n\n` +
        `1️⃣ /join → send SOL to treasury\n` +
        `2️⃣ Open game\n` +
        `3️⃣ Join lobby\n` +
        `4️⃣ Place bet\n` +
        `5️⃣ Watch your duck race!\n\n` +
        `🏆 80% SOL + 500 $TRC to winner\n\n` +
        `Treasury:\n<code>${TREASURY}</code>`
      );
    }

    else if (text === "/lobby") {
      const docs = await firestoreList("lobby");
      const players = docs.filter(d => !d.fields?.isBot?.booleanValue);
      if (players.length === 0) {
        await sendMessage(BOT_TOKEN, chatId,
          `🦆 <b>LOBBY IS EMPTY</b>\n\nBe the first to join!`,
          { reply_markup: { inline_keyboard: [[
            { text: "🦆 JOIN RACE", callback_data: "join" }
          ]]}}
        );
      } else {
        const ducks = ["🦆","🐥","🐤","🐣"];
        const list = players.map((p, i) =>
          `${ducks[i % 4]} ${p.fields?.name?.stringValue || "Player"}`
        ).join("\n");
        await sendMessage(BOT_TOKEN, chatId,
          `🏟️ <b>LOBBY (${players.length} players)</b>\n\n${list}\n\n` +
          `💰 Pool: ◎ ${(players.length * ENTRY_SOL).toFixed(3)} SOL`,
          { reply_markup: { inline_keyboard: [[
            { text: "🎮 OPEN GAME", web_app: { url: GAME_URL } }
          ]]}}
        );
      }
    }

  } catch(e) {
    console.error("Bot error:", e);
  }
};


