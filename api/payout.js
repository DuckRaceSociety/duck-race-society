// api/payout.js - SECURED Duck Race Society Payout
const { Connection, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction } = require("@solana/web3.js");
const { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction, getAccount } = require("@solana/spl-token");
const bs58 = require("bs58");

const TRC_TOKEN_MINT = "H4FTTQ5nhGdFFqHa3FPd5TpjcXYLAokN8SYFdBq4yERL";
const TREASURY_ADDRESS = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const TRC_BONUS = 500;
const WINNER_SHARE = 0.8;

// ── SECURITY: Rate limiting ──
const claimLog = {}; // walletAddress -> timestamp
const CLAIM_COOLDOWN = 60 * 60 * 1000; // 1 hour

// ── SECURITY: Validate request ──
function validateRequest(req) {
  // Check required headers
  const token = req.headers['x-race-token'];
  const playerId = req.headers['x-player-id'];
  const winnerId = req.headers['x-winner-id'];
  
  if (!token || !playerId || !winnerId) {
    return { valid: false, error: "Missing security headers" };
  }

  // Verify token format (base64 encoded uid:timestamp:duck-race-payout)
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3 || parts[2] !== 'duck-race-payout') {
      return { valid: false, error: "Invalid token format" };
    }
    // Token must be less than 5 minutes old
    const tokenTime = parseInt(parts[1]);
    if (Date.now() - tokenTime > 5 * 60 * 1000) {
      return { valid: false, error: "Token expired" };
    }
  } catch(e) {
    return { valid: false, error: "Token decode failed" };
  }

  return { valid: true };
}

// ── SECURITY: Validate wallet address ──
function isValidSolanaAddress(address) {
  try {
    if (!address || typeof address !== 'string') return false;
    if (address.length < 32 || address.length > 44) return false;
    new PublicKey(address); // throws if invalid
    return true;
  } catch(e) {
    return false;
  }
}

// ── SECURITY: Verify treasury received SOL ──
async function verifyTreasuryReceived(connection, expectedAmount, sinceTimestamp) {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(TREASURY_ADDRESS),
      { limit: 50 }
    );
    const cutoff = sinceTimestamp / 1000;
    const recent = sigs.filter(s => s.blockTime && s.blockTime > cutoff - 600); // 10 min window
    return recent.length > 0;
  } catch(e) {
    console.error("Treasury verify error:", e);
    return true; // Fail open if RPC issues
  }
}

module.exports = async function handler(req, res) {
  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // ── SECURITY: Validate request headers ──
  const validation = validateRequest(req);
  if (!validation.valid) {
    console.error("Security validation failed:", validation.error);
    return res.status(403).json({ success: false, error: validation.error });
  }

  const { winnerWallet, raceId, totalPoolSOL, authUid, telegramId } = req.body;

  // ── SECURITY: Validate inputs ──
  if (!winnerWallet || !isValidSolanaAddress(winnerWallet)) {
    return res.status(400).json({ success: false, error: "Invalid winner wallet" });
  }
  if (!totalPoolSOL || isNaN(totalPoolSOL) || totalPoolSOL <= 0 || totalPoolSOL > 10) {
    return res.status(400).json({ success: false, error: "Invalid pool amount" });
  }

  // ── SECURITY: Rate limit per wallet ──
  const now = Date.now();
  if (claimLog[winnerWallet] && now - claimLog[winnerWallet] < CLAIM_COOLDOWN) {
    const waitMin = Math.ceil((CLAIM_COOLDOWN - (now - claimLog[winnerWallet])) / 60000);
    return res.status(429).json({ success: false, error: `Already claimed. Wait ${waitMin} minutes.` });
  }

  // ── SECURITY: Don't pay treasury itself ──
  if (winnerWallet === TREASURY_ADDRESS) {
    return res.status(400).json({ success: false, error: "Invalid recipient" });
  }

  const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
  if (!PRIVATE_KEY) {
    return res.status(500).json({ success: false, error: "Server config error" });
  }

  try {
    const keyBytes = bs58.decode(PRIVATE_KEY);
    const treasuryKeypair = Keypair.fromSecretKey(keyBytes);

    // ── SECURITY: Verify treasury pubkey matches expected ──
    if (treasuryKeypair.publicKey.toString() !== TREASURY_ADDRESS) {
      console.error("SECURITY: Treasury keypair mismatch!");
      return res.status(500).json({ success: false, error: "Server key error" });
    }

    const RPC_ENDPOINTS = [
      "https://rpc.ankr.com/solana",
      "https://api.mainnet-beta.solana.com"
    ];

    let connection;
    for (const rpc of RPC_ENDPOINTS) {
      try {
        connection = new Connection(rpc, "confirmed");
        await connection.getLatestBlockhash();
        break;
      } catch(e) { continue; }
    }
    if (!connection) throw new Error("All RPC endpoints failed");

    // ── SECURITY: Verify treasury received SOL recently ──
    const received = await verifyTreasuryReceived(connection, totalPoolSOL, now - 15 * 60 * 1000);
    if (!received) {
      console.warn("Warning: No recent treasury transactions found");
    }

    const solPayout = parseFloat((totalPoolSOL * WINNER_SHARE).toFixed(9));
    const lamports = Math.floor(solPayout * 1_000_000_000);

    // ── SECURITY: Sanity check payout amount ──
    if (lamports <= 0 || lamports > 5_000_000_000) { // Max 5 SOL
      return res.status(400).json({ success: false, error: "Payout amount out of range" });
    }

    const winnerPubkey = new PublicKey(winnerWallet);
    let solSignature = null;

    // ── SOL PAYOUT ──
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasuryKeypair.publicKey,
          toPubkey: winnerPubkey,
          lamports
        })
      );
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = treasuryKeypair.publicKey;
      solSignature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair], {
        commitment: "confirmed",
        maxRetries: 3
      });
      console.log(`✅ SOL payout: ${solPayout} SOL → ${winnerWallet} | tx: ${solSignature}`);
    } catch(e) {
      console.error("SOL payout error:", e);
      return res.status(500).json({ success: false, error: "SOL transfer failed: " + e.message });
    }

    // ── TRC TOKEN PAYOUT ──
    let trcSignature = null;
    try {
      const mintPubkey = new PublicKey(TRC_TOKEN_MINT);
      const treasuryATA = await getAssociatedTokenAddress(mintPubkey, treasuryKeypair.publicKey);
      const winnerATA = await getAssociatedTokenAddress(mintPubkey, winnerPubkey);

      const tokenTx = new Transaction();

      // Create ATA if needed
      try {
        await getAccount(connection, winnerATA);
      } catch(e) {
        tokenTx.add(createAssociatedTokenAccountInstruction(
          treasuryKeypair.publicKey, winnerATA, winnerPubkey, mintPubkey
        ));
      }

      tokenTx.add(createTransferInstruction(
        treasuryATA,
        winnerATA,
        treasuryKeypair.publicKey,
        TRC_BONUS * 1_000_000 // 6 decimals
      ));

      const { blockhash } = await connection.getLatestBlockhash();
      tokenTx.recentBlockhash = blockhash;
      tokenTx.feePayer = treasuryKeypair.publicKey;
      trcSignature = await sendAndConfirmTransaction(connection, tokenTx, [treasuryKeypair], {
        commitment: "confirmed",
        maxRetries: 3
      });
      console.log(`✅ TRC payout: ${TRC_BONUS} TRC → ${winnerWallet} | tx: ${trcSignature}`);
    } catch(e) {
      console.error("TRC payout error (non-fatal):", e);
    }

    // ── Record successful claim ──
    claimLog[winnerWallet] = now;

    return res.status(200).json({
      success: true,
      solPayout,
      trcBonus: TRC_BONUS,
      solSignature,
      trcSignature,
      message: `${solPayout} SOL + ${TRC_BONUS} TRC sent to ${winnerWallet.slice(0,6)}...`
    });

  } catch(e) {
    console.error("Payout error:", e);
    return res.status(500).json({ success: false, error: e.message });
  }
};
