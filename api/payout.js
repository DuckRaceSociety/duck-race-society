const TELEGRAM_API = "https://api.telegram.org";

async function sendMessage(botToken, chatId, text, parseMode = "HTML") {
  const resp = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    })
  });
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_GROUP_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(500).json({ error: "Telegram not configured" });
  }

  const { type, data } = req.body;

  let message = "";

  switch(type) {

    case "race_starting":
      message = `
🦆 <b>DUCK RACE STARTING!</b>

⏳ Race begins in <b>30 seconds!</b>

🏊 Players:
${data.players.map((p, i) => `${["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣"][i] || "🦆"} ${p.name}`).join("\n")}

💰 Prize Pool: <b>${data.poolSOL} SOL + 500 TRC</b>

🎮 <a href="https://t.me/duck_race_society_bot">JOIN NOW!</a>
      `.trim();
      break;

    case "countdown":
      message = `
⏰ <b>RACE STARTS IN ${data.seconds} SECONDS!</b>

🦆 ${data.playerCount} ducks on the starting line
💰 Pool: <b>${data.poolSOL} SOL</b>

Last chance to join! 👇
🎮 <a href="https://t.me/duck_race_society_bot">PLAY NOW</a>
      `.trim();
      break;

    case "race_live":
      message = `
🏁 <b>RACE IS LIVE!</b>

🦆 ${data.playerCount} ducks racing for:
◎ <b>${data.poolSOL} SOL</b>
🪙 <b>500 TRC tokens</b>

Watch live 👇
🎮 <a href="https://t.me/duck_race_society_bot">OPEN GAME</a>
      `.trim();
      break;

    case "winner":
      message = `
🏆 <b>WE HAVE A WINNER!</b>

🦆 <b>${data.winner}</b> wins the race!

💰 Prize:
◎ <b>${data.solPayout} SOL</b>
🪙 <b>500 TRC tokens</b>

🎉 Congratulations ${data.winner}!

🎮 <a href="https://t.me/duck_race_society_bot">PLAY NEXT RACE</a>
      `.trim();
      break;

    default:
      return res.status(400).json({ error: "Unknown notification type" });
  }

  try {
    const result = await sendMessage(BOT_TOKEN, CHAT_ID, message);
    if (result.ok) {
      return res.status(200).json({ success: true, messageId: result.result.message_id });
    } else {
      return res.status(500).json({ error: result.description });
    }
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
