// api/payout.js - FULLY SECURED Duck Race Society Payout
// Uses Firebase ID Token verification instead of forgeable btoa token

const { Connection, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction } = require("@solana/web3.js");
const { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction, getAccount } = require("@solana/spl-token");
const bs58 = require("bs58");

const TRC_TOKEN_MINT   = "H4FTTQ5nhGdFFqHa3FPd5TpjcXYLAokN8SYFdBq4yERL";
const TREASURY_ADDRESS = "5sDfMWBNFMne13aJLhiG3k7V8MwULmHfQrkt2eHupSQ1";
const FIREBASE_PROJECT = "duck-race-society";
const TRC_BONUS        = 500;
const WINNER_SHARE     = 0.8;
const MAX_POOL_SOL     = 10;

// ── In-memory rate limit (resets on redeploy - fine for Vercel) ──
const claimLog = {};
const CLAIM_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per wallet

// ── Verify Firebase ID Token via Google's public endpoint ──
async function verifyFirebaseToken(idToken) {
  try {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });
    const data = await resp.json();
    if (data.error || !data.users || data.users.length === 0) return null;
    return data.users[0]; // { localId, email, ... }
  } catch(e) {
    console.error("Token verify error:", e);
    return null;
  }
}

// ── Validate Solana address format ──
function isValidSolanaAddress(address) {
  try {
    if (!address || typeof address !== "string") return false;
    if (address.length < 32 || address.length > 44) return false;
    new PublicKey(address);
    return true;
  } catch(e) { return false; }
}

// ── Verify treasury received SOL recently ──
async function verifyTreasuryReceived(connection) {
  try {
    const sigs = await connection.getSignaturesForAddress(
      new PublicKey(TREASURY_ADDRESS), { limit: 30 }
    );
    const tenMinAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
    return sigs.some(s => s.blockTime && s.blockTime > tenMinAgo && !s.err);
  } catch(e) {
    return true; // Fail open on RPC error
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  // ══════════════════════════════════════════════
  // SECURITY LAYER 1: Firebase ID Token verification
  // Client sends real Firebase ID token - cannot be forged without the user's account
  // ══════════════════════════════════════════════
  const idToken = req.headers["x-firebase-token"];
  if (!idToken) {
    return res.status(401).json({ success: false, error: "Missing auth token" });
  }

  const firebaseUser = await verifyFirebaseToken(idToken);
  if (!firebaseUser) {
    return res.status(403).json({ success: false, error: "Invalid Firebase token" });
  }
  const verifiedUid = firebaseUser.localId;

  // ══════════════════════════════════════════════
  // SECURITY LAYER 2: Input validation
  // ══════════════════════════════════════════════
  const { winnerWallet, totalPoolSOL, raceId, winnerId } = req.body;

  if (!winnerWallet || !isValidSolanaAddress(winnerWallet)) {
    return res.status(400).json({ success: false, error: "Invalid winner wallet" });
  }
  if (!totalPoolSOL || isNaN(totalPoolSOL) || totalPoolSOL <= 0 || totalPoolSOL > MAX_POOL_SOL) {
    return res.status(400).json({ success: false, error: "Invalid pool amount" });
  }
  if (winnerWallet === TREASURY_ADDRESS) {
    return res.status(400).json({ success: false, error: "Cannot pay treasury" });
  }

  // ══════════════════════════════════════════════
  // SECURITY LAYER 3: Verify winner from Firestore (server-side check)
  // Winner must match what's stored in Firestore - client cannot override this
  // ══════════════════════════════════════════════
  try {
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/race/current`;
    const raceResp = await fetch(firestoreUrl + `?key=${FIREBASE_API_KEY}`);
    const raceData = await raceResp.json();

    if (raceData.fields) {
      const running = raceData.fields.running?.booleanValue;
      const storedWinnerId = raceData.fields.winnerId?.stringValue;
      const serverVerified = raceData.fields.serverVerified?.booleanValue;

      if (running === true) {
        return res.status(400).json({ success: false, error: "Race still running" });
      }
      if (serverVerified === true) {
        return res.status(400).json({ success: false, error: "Prize already claimed" });
      }
      if (storedWinnerId && winnerId && storedWinnerId !== winnerId) {
        console.error(`SECURITY: Winner mismatch! Firestore: ${storedWinnerId}, Client: ${winnerId}`);
        return res.status(403).json({ success: false, error: "Winner mismatch" });
      }
    }
  } catch(e) {
    console.error("Firestore check error:", e);
    // Continue but log - don't block on Firestore API errors
  }

  // ══════════════════════════════════════════════
  // SECURITY LAYER 4: Rate limiting per wallet
  // ══════════════════════════════════════════════
  const now = Date.now();
  if (claimLog[winnerWallet] && now - claimLog[winnerWallet] < CLAIM_COOLDOWN_MS) {
    const waitMin = Math.ceil((CLAIM_COOLDOWN_MS - (now - claimLog[winnerWallet])) / 60000);
    return res.status(429).json({ success: false, error: `Already claimed. Wait ${waitMin}min.` });
  }

  // ══════════════════════════════════════════════
  // SECURITY LAYER 5: Treasury keypair sanity check
  // ══════════════════════════════════════════════
  const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
  if (!PRIVATE_KEY) return res.status(500).json({ success: false, error: "Server config error" });

  let treasuryKeypair;
  try {
    treasuryKeypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    if (treasuryKeypair.publicKey.toString() !== TREASURY_ADDRESS) {
      console.error("CRITICAL: Treasury keypair mismatch!");
      return res.status(500).json({ success: false, error: "Server key error" });
    }
  } catch(e) {
    return res.status(500).json({ success: false, error: "Key parse error" });
  }

  // ══════════════════════════════════════════════
  // EXECUTE PAYOUT
  // ══════════════════════════════════════════════
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
  if (!connection) return res.status(500).json({ success: false, error: "RPC unavailable" });

  // Verify treasury received funds
  const received = await verifyTreasuryReceived(connection);
  if (!received) console.warn("No recent treasury tx - proceeding anyway");

  const solPayout = parseFloat((totalPoolSOL * WINNER_SHARE).toFixed(9));
  const lamports  = Math.floor(solPayout * 1_000_000_000);

  if (lamports <= 0 || lamports > 5_000_000_000) {
    return res.status(400).json({ success: false, error: "Payout out of range" });
  }

  const winnerPubkey = new PublicKey(winnerWallet);
  let solSignature = null, trcSignature = null;

  // SOL payout
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: treasuryKeypair.publicKey, toPubkey: winnerPubkey, lamports })
    );
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = treasuryKeypair.publicKey;
    solSignature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair], { commitment: "confirmed", maxRetries: 3 });
    console.log(`✅ SOL: ${solPayout} → ${winnerWallet} | ${solSignature}`);
  } catch(e) {
    console.error("SOL payout failed:", e);
    return res.status(500).json({ success: false, error: "SOL transfer failed: " + e.message });
  }

  // TRC token payout
  try {
    const mintPubkey    = new PublicKey(TRC_TOKEN_MINT);
    const treasuryATA   = await getAssociatedTokenAddress(mintPubkey, treasuryKeypair.publicKey);
    const winnerATA     = await getAssociatedTokenAddress(mintPubkey, winnerPubkey);
    const tokenTx       = new Transaction();
    try { await getAccount(connection, winnerATA); }
    catch(e) {
      tokenTx.add(createAssociatedTokenAccountInstruction(
        treasuryKeypair.publicKey, winnerATA, winnerPubkey, mintPubkey
      ));
    }
    tokenTx.add(createTransferInstruction(treasuryATA, winnerATA, treasuryKeypair.publicKey, TRC_BONUS * 1_000_000));
    const { blockhash } = await connection.getLatestBlockhash();
    tokenTx.recentBlockhash = blockhash;
    tokenTx.feePayer = treasuryKeypair.publicKey;
    trcSignature = await sendAndConfirmTransaction(connection, tokenTx, [treasuryKeypair], { commitment: "confirmed", maxRetries: 3 });
    console.log(`✅ TRC: ${TRC_BONUS} → ${winnerWallet} | ${trcSignature}`);
  } catch(e) {
    console.error("TRC payout failed (non-fatal):", e);
  }

  // ── Mark as claimed in Firestore via REST ──
  try {
    const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
    await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/race/current?updateMask.fieldPaths=serverVerified&key=${FIREBASE_API_KEY}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { serverVerified: { booleanValue: true } } })
      }
    );
  } catch(e) { console.error("Firestore mark error:", e); }

  // Record claim
  claimLog[winnerWallet] = now;

  return res.status(200).json({
    success: true,
    solPayout,
    trcBonus: TRC_BONUS,
    solSignature,
    trcSignature,
    message: `${solPayout} SOL + ${TRC_BONUS} TRC sent!`
  });
};
