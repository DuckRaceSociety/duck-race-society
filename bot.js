// api/bot.js - Telegram Bot Webhook Handler
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, query, where } from "firebase/firestore";

const TREASURY = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const ENTRY_SOL = 0.025;
const LAMPORTS = Math.floor(ENTRY_SOL * 1_000_000_000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const firebaseConfig = {
  apiKey: "AIzaSyDjdM2QAPbNwQXlnFbS9pf9Yi9eH1aK42c",
  authDomain: "duck-race-society.firebaseapp.com",
  projectId: "duck-race-society",
  storageBucket: "duck-race-society.appspot.com",
  messagingSenderId: "249037009909",
  appId: "1:249037009909:web:d00e0ff240218fb8aaa6bc"
};

let db;
function getDB() {
  if (!db) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

async function sendMessage(chatId, text, extra = {}) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...extra })
  });
}

async function sendPhoto(chatId, photo, caption, extra = {}) {
  await fetch(`${API}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra })
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const update = req.body;
  const msg = update.message || update.callback_query?.message;
  const callbackData = update.callback_query?.data;
  const chatId = msg?.chat?.id;
  const userId = (update.message?.from || update.callback_query?.from)?.id;
  const userName = (update.message?.from || update.callback_query?.from)?.first_name || "Player";
  const text = update.message?.text || "";

  if (!chatId) return res.status(200).json({ ok: true });

  try {
    // /start
    if (text === "/start" || text.startsWith("/start")) {
      await sendMessage(chatId,
        `🦆 <b>Welcome to DUCK RACE SOCIETY!</b>\n\n` +
        `◎ Bet SOL, race ducks, win rewards!\n` +
        `🪙 500 $TRC token bonus every race!\n` +
        `⚡ Power-Ups available!\n\n` +
        `<b>Commands:</b>\n` +
        `/join — Join a race (0.025 SOL)\n` +
        `/lobby — See current lobby\n` +
        `/race — Open race viewer\n` +
        `/help — How to play`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: "🦆 JOIN RACE", callback_data: "join" },
              { text: "🎮 OPEN GAME", web_app: { url: "https://duck-race-society.vercel.app" } }
            ]]
          }
        }
      );
    }

    // /join or callback join
    else if (text === "/join" || callbackData === "join") {
      if (callbackData) {
        await fetch(`${API}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callback_query_id: update.callback_query.id })
        });
      }

      await sendMessage(chatId,
        `🦆 <b>JOIN DUCK RACE</b>\n\n` +
        `Entry fee: <b>◎ ${ENTRY_SOL} SOL</b>\n` +
        `Prize: <b>80% of pool + 500 $TRC</b>\n\n` +
        `<b>Step 1:</b> Send exactly <code>${ENTRY_SOL} SOL</code> to:\n` +
        `<code>${TREASURY}</code>\n\n` +
        `<b>Step 2:</b> Tap the button below with your wallet address\n\n` +
        `⚠️ Send from YOUR wallet — we need your address to verify!`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ I SENT THE SOL — VERIFY ME", callback_data: `verify_${userId}` }],
              [{ text: "📋 COPY TREASURY ADDRESS", callback_data: "copy_treasury" }],
              [{ text: "🎮 OPEN GAME", web_app: { url: "https://duck-race-society.vercel.app" } }]
            ]
          }
        }
      );
    }

    // Copy treasury
    else if (callbackData === "copy_treasury") {
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: update.callback_query.id,
          text: TREASURY,
          show_alert: true
        })
      });
    }

    // Verify payment
    else if (callbackData?.startsWith("verify_")) {
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: update.callback_query.id })
      });

      await sendMessage(chatId,
        `🔍 <b>ENTER YOUR WALLET ADDRESS</b>\n\n` +
        `Please reply with your Solana wallet address so we can verify your payment!\n\n` +
        `Example: <code>5sDfMWBNF...</code>`
      );

      // Store pending verification in Firestore
      const db = getDB();
      await setDoc(doc(db, "pending_verify", String(userId)), {
        userId: String(userId),
        userName,
        chatId: String(chatId),
        waitingForWallet: true,
        timestamp: Date.now()
      });
    }

    // Handle wallet address reply for verification
    else if (text && text.length > 30 && !text.startsWith("/")) {
      const db = getDB();
      const pendingDoc = await getDocs(
        query(collection(db, "pending_verify"), where("userId", "==", String(userId)), where("waitingForWallet", "==", true))
      );

      if (!pendingDoc.empty) {
        const walletAddress = text.trim();

        await sendMessage(chatId, `⏳ <b>Verifying payment...</b>\n\nChecking transactions for:\n<code>${walletAddress}</code>`);

        // Verify on-chain
        const verified = await verifyPayment(walletAddress);

        if (verified) {
          // Add to lobby
          await addDoc(collection(db, "lobby"), {
            id: `tg_${userId}`,
            name: userName,
            uid: String(userId),
            walletAddress,
            joinedAt: Date.now(),
            isHost: false,
            fromBot: true
          });

          // Remove pending
          await deleteDoc(doc(db, "pending_verify", String(userId)));

          await sendMessage(chatId,
            `✅ <b>PAYMENT VERIFIED!</b>\n\n` +
            `🦆 ${userName} joined the lobby!\n` +
            `💰 Wallet: <code>${walletAddress.slice(0,8)}...${walletAddress.slice(-6)}</code>\n\n` +
            `Open the game to watch the race!`,
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: "🎮 WATCH RACE", web_app: { url: "https://duck-race-society.vercel.app" } }
                ]]
              }
            }
          );
        } else {
          await sendMessage(chatId,
            `❌ <b>Payment not found!</b>\n\n` +
            `Make sure you:\n` +
            `1. Sent exactly <b>${ENTRY_SOL} SOL</b>\n` +
            `2. Sent from wallet: <code>${walletAddress.slice(0,8)}...</code>\n` +
            `3. Sent to: <code>${TREASURY.slice(0,8)}...</code>\n\n` +
            `Transaction may take 30s. Try again in a moment!`,
            {
              reply_markup: {
                inline_keyboard: [[
                  { text: "🔄 TRY AGAIN", callback_data: `verify_${userId}` }
                ]]
              }
            }
          );
        }
      }
    }

    // /lobby
    else if (text === "/lobby" || callbackData === "lobby") {
      const db = getDB();
      const snap = await getDocs(collection(db, "lobby"));
      const players = [];
      snap.forEach(d => { if (!d.data().isBot) players.push(d.data()); });

      if (players.length === 0) {
        await sendMessage(chatId,
          `🦆 <b>LOBBY IS EMPTY</b>\n\nBe the first to join!\n\n/join to enter`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🦆 JOIN RACE", callback_data: "join" }]]
            }
          }
        );
      } else {
        const ducks = ["🦆","🐥","🐤","🐣"];
        const playerList = players.map((p, i) => `${ducks[i % 4]} ${p.name}`).join("\n");
        await sendMessage(chatId,
          `🏟️ <b>CURRENT LOBBY</b>\n\n${playerList}\n\n<b>${players.length} player(s)</b> waiting\nPool: ◎ ${(players.length * ENTRY_SOL).toFixed(3)} SOL`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🦆 JOIN RACE", callback_data: "join" }],
                [{ text: "🎮 WATCH GAME", web_app: { url: "https://duck-race-society.vercel.app" } }]
              ]
            }
          }
        );
      }
    }

    // /help
    else if (text === "/help") {
      await sendMessage(chatId,
        `🦆 <b>HOW TO PLAY</b>\n\n` +
        `1️⃣ Use /join to enter a race\n` +
        `2️⃣ Send <b>0.025 SOL</b> to the treasury\n` +
        `3️⃣ Verify your payment\n` +
        `4️⃣ Open the game to watch!\n` +
        `5️⃣ Winner gets <b>80% SOL + 500 $TRC</b>\n\n` +
        `⚡ Buy Power-Ups in the game!\n` +
        `📊 Live odds updated in real-time!\n\n` +
        `<b>Treasury:</b> <code>${TREASURY}</code>`
      );
    }

  } catch(e) {
    console.error("Bot error:", e);
  }

  res.status(200).json({ ok: true });
}

// Verify SOL payment on-chain
async function verifyPayment(fromWallet) {
  try {
    const resp = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [TREASURY, { limit: 20 }]
      })
    });
    const data = await resp.json();
    const sigs = data.result || [];

    for (const sig of sigs) {
      // Check recent (last 5 min)
      if (sig.blockTime && (Date.now() / 1000 - sig.blockTime) > 300) continue;

      // Get transaction details
      const txResp = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]
        })
      });
      const tx = await txResp.json();
      const accounts = tx.result?.transaction?.message?.accountKeys || [];
      const fromAccount = accounts[0]?.pubkey;

      if (fromAccount === fromWallet) {
        // Check amount
        const preBalances = tx.result?.meta?.preBalances || [];
        const postBalances = tx.result?.meta?.postBalances || [];
        const sent = (preBalances[0] - postBalances[0]);
        if (sent >= LAMPORTS * 0.95) return true; // 5% tolerance for fees
      }
    }
    return false;
  } catch(e) {
    console.error("Verify error:", e);
    return false;
  }
}
