// api/bot.js - Telegram Bot Webhook Handler
const TREASURY = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const ENTRY_SOL = 0.025;
const LAMPORTS = Math.floor(ENTRY_SOL * 1_000_000_000);

// Firebase REST API (no SDK needed)
const FIREBASE_PROJECT = "duck-race-society";
const FIREBASE_KEY = "AIzaSyDjdM2QAPbNwQXlnFbS9pf9Yi9eH1aK42c";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function firestoreGet(collection, docId) {
  const resp = await fetch(`${FIRESTORE_URL}/${collection}/${docId}?key=${FIREBASE_KEY}`);
  return resp.json();
}

async function firestoreSet(collection, docId, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  const resp = await fetch(
    `${FIRESTORE_URL}/${collection}/${docId}?key=${FIREBASE_KEY}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    }
  );
  return resp.json();
}

async function firestoreAdd(collection, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
  }
  const resp = await fetch(
    `${FIRESTORE_URL}/${collection}?key=${FIREBASE_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    }
  );
  return resp.json();
}

async function firestoreDelete(collection, docId) {
  await fetch(`${FIRESTORE_URL}/${collection}/${docId}?key=${FIREBASE_KEY}`, { method: "DELETE" });
}

async function firestoreList(col) {
  const resp = await fetch(`${FIRESTORE_URL}/${col}?key=${FIREBASE_KEY}`);
  const data = await resp.json();
  return data.documents || [];
}

async function sendMessage(BOT_TOKEN, chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra })
  });
}

async function answerCallback(BOT_TOKEN, id, text = "") {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text })
  });
}

async function verifyPayment(fromWallet) {
  try {
    const resp = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getSignaturesForAddress",
        params: [TREASURY, { limit: 20 }]
      })
    });
    const data = await resp.json();
    const sigs = data.result || [];

    for (const sig of sigs) {
      if (sig.blockTime && (Date.now() / 1000 - sig.blockTime) > 300) continue;
      const txResp = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
        })
      });
      const tx = await txResp.json();
      const accounts = tx.result?.transaction?.message?.accountKeys || [];
      const fromAccount = accounts[0]?.pubkey;
      if (fromAccount === fromWallet) {
        const pre = tx.result?.meta?.preBalances || [];
        const post = tx.result?.meta?.postBalances || [];
        const sent = pre[0] - post[0];
        if (sent >= LAMPORTS * 0.95) return true;
      }
    }
    return false;
  } catch(e) {
    console.error("Verify error:", e);
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const update = req.body;
  const msg = update.message || update.callback_query?.message;
  const callbackData = update.callback_query?.data;
  const chatId = msg?.chat?.id;
  const from = update.message?.from || update.callback_query?.from;
  const userId = String(from?.id || "");
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
        `Use /join to enter a race!`,
        { reply_markup: { inline_keyboard: [[
          { text: "🦆 JOIN RACE", callback_data: "join" },
          { text: "🎮 OPEN GAME", web_app: { url: "https://duck-race-society.vercel.app" } }
        ]] }}
      );
    }

    // JOIN
    else if (text === "/join" || callbackData === "join") {
      if (callbackData) await answerCallback(BOT_TOKEN, update.callback_query.id);
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>JOIN DUCK RACE</b>\n\n` +
        `Entry: <b>◎ ${ENTRY_SOL} SOL</b>\n` +
        `Prize: <b>80% pool + 500 $TRC</b>\n\n` +
        `<b>STEP 1:</b> Send exactly <code>${ENTRY_SOL} SOL</code> to:\n\n` +
        `<code>${TREASURY}</code>\n\n` +
        `<b>STEP 2:</b> Press the button below after sending!`,
        { reply_markup: { inline_keyboard: [
          [{ text: "✅ I SENT THE SOL", callback_data: `verify_${userId}` }],
          [{ text: "🎮 OPEN GAME", web_app: { url: "https://duck-race-society.vercel.app" } }]
        ]}}
      );
    }

    // VERIFY
    else if (callbackData?.startsWith("verify_")) {
      await answerCallback(BOT_TOKEN, update.callback_query.id);
      await firestoreSet("pending_verify", userId, {
        userId, userName,
        chatId: String(chatId),
        waitingForWallet: "true",
        timestamp: Date.now()
      });
      await sendMessage(BOT_TOKEN, chatId,
        `🔍 <b>VERIFICATION</b>\n\n` +
        `Reply with your <b>Solana wallet address</b> that you sent from:\n\n` +
        `Example: <code>7xKX...AbC9</code>`
      );
    }

    // Wallet address reply
    else if (text && text.length >= 32 && text.length <= 44 && !text.startsWith("/")) {
      const pending = await firestoreGet("pending_verify", userId);
      if (pending?.fields?.waitingForWallet?.booleanValue ||
          pending?.fields?.waitingForWallet?.stringValue === "true") {

        const walletAddress = text.trim();
        await sendMessage(BOT_TOKEN, chatId, `⏳ <b>Verifying on Solana...</b>\n\nChecking wallet:\n<code>${walletAddress}</code>`);

        const verified = await verifyPayment(walletAddress);

        if (verified) {
          await firestoreAdd("lobby", {
            id: `tg_${userId}`,
            name: userName,
            uid: userId,
            walletAddress,
            joinedAt: Date.now(),
            isBot: false,
            isHost: false,
            fromBot: true
          });
          await firestoreDelete("pending_verify", userId);
          await sendMessage(BOT_TOKEN, chatId,
            `✅ <b>VERIFIED! YOU'RE IN THE LOBBY!</b>\n\n` +
            `🦆 ${userName} is ready to race!\n` +
            `💰 Wallet: <code>${walletAddress.slice(0,6)}...${walletAddress.slice(-4)}</code>\n\n` +
            `Open the game to watch your duck race!`,
            { reply_markup: { inline_keyboard: [[
              { text: "🎮 WATCH RACE", web_app: { url: "https://duck-race-society.vercel.app" } }
            ]]}}
          );
        } else {
          await sendMessage(BOT_TOKEN, chatId,
            `❌ <b>Payment not found!</b>\n\n` +
            `Make sure you sent <b>exactly ${ENTRY_SOL} SOL</b> from:\n` +
            `<code>${walletAddress}</code>\n\n` +
            `Transaction can take up to 30 seconds. Try again!`,
            { reply_markup: { inline_keyboard: [[
              { text: "🔄 TRY AGAIN", callback_data: `verify_${userId}` }
            ]]}}
          );
        }
      }
    }

    // /lobby
    else if (text === "/lobby" || callbackData === "lobby") {
      if (callbackData) await answerCallback(BOT_TOKEN, update.callback_query.id);
      const docs = await firestoreList("lobby");
      const players = docs.filter(d => !d.fields?.isBot?.booleanValue);

      if (players.length === 0) {
        await sendMessage(BOT_TOKEN, chatId,
          `🦆 <b>LOBBY IS EMPTY</b>\n\nBe the first to join!`,
          { reply_markup: { inline_keyboard: [[{ text: "🦆 JOIN RACE", callback_data: "join" }]] }}
        );
      } else {
        const ducks = ["🦆","🐥","🐤","🐣"];
        const list = players.map((p, i) =>
          `${ducks[i % 4]} ${p.fields?.name?.stringValue || "Player"}`
        ).join("\n");
        await sendMessage(BOT_TOKEN, chatId,
          `🏟️ <b>CURRENT LOBBY (${players.length} players)</b>\n\n${list}\n\n` +
          `💰 Pool: ◎ ${(players.length * ENTRY_SOL).toFixed(3)} SOL`,
          { reply_markup: { inline_keyboard: [
            [{ text: "🦆 JOIN RACE", callback_data: "join" }],
            [{ text: "🎮 WATCH GAME", web_app: { url: "https://duck-race-society.vercel.app" } }]
          ]}}
        );
      }
    }

    // /help
    else if (text === "/help") {
      await sendMessage(BOT_TOKEN, chatId,
        `🦆 <b>HOW TO PLAY</b>\n\n` +
        `1️⃣ Type /join\n` +
        `2️⃣ Send <b>0.025 SOL</b> to treasury\n` +
        `3️⃣ Press "I SENT THE SOL"\n` +
        `4️⃣ Send your wallet address\n` +
        `5️⃣ Open game & watch your duck!\n\n` +
        `🏆 Winner gets 80% SOL + 500 $TRC\n` +
        `⚡ Buy Power-Ups in the game!\n\n` +
        `Treasury:\n<code>${TREASURY}</code>`
      );
    }

  } catch(e) {
    console.error("Bot error:", e);
  }

  res.status(200).json({ ok: true });
};
