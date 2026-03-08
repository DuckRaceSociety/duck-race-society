import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";

const TOKEN_MINT = "H4FTTQ5nhGdFFqHa3FPd5TpjcXYLAokN8SYFdBq4yERL";
const RPC = "https://api.mainnet-beta.solana.com";

export default async function handler(req, res) {
  // Only POST
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { winnerWallet, raceId, playerCount } = req.body;

  if (!winnerWallet || !raceId) {
    return res.status(400).json({ error: "Missing winnerWallet or raceId" });
  }

  // Validate Solana address
  let winnerPubkey;
  try {
    winnerPubkey = new PublicKey(winnerWallet);
  } catch (e) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  try {
    const connection = new Connection(RPC, "confirmed");

    // Load treasury wallet from env
    const privateKeyRaw = process.env.TREASURY_PRIVATE_KEY;
    if (!privateKeyRaw) throw new Error("Treasury key not configured");

    let secretKey;
    try {
      // Try base58 format first
      secretKey = bs58.decode(privateKeyRaw);
    } catch {
      // Try JSON array format
      secretKey = Uint8Array.from(JSON.parse(privateKeyRaw));
    }
    const treasuryKeypair = Keypair.fromSecretKey(secretKey);

    // Get token mint info for decimals
    const mintInfo = await getMint(connection, new PublicKey(TOKEN_MINT));
    const decimals = mintInfo.decimals;

    // Calculate payout: 0.025 SOL per player, convert to token amount
    // 1 SOL = 1000 tokens (adjust ratio as needed)
    const TOKEN_PER_SOL = 1000;
    const ENTRY_FEE_SOL = 0.025;
    const PLATFORM_FEE = 0.05; // 5% platform fee
    const totalPool = playerCount * ENTRY_FEE_SOL * TOKEN_PER_SOL;
    const payoutAmount = Math.floor(totalPool * (1 - PLATFORM_FEE) * Math.pow(10, decimals));

    // Get or create treasury token account
    const treasuryTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      treasuryKeypair,
      new PublicKey(TOKEN_MINT),
      treasuryKeypair.publicKey
    );

    // Get or create winner token account
    const winnerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      treasuryKeypair, // treasury pays for account creation
      new PublicKey(TOKEN_MINT),
      winnerPubkey
    );

    // Build transfer transaction
    const tx = new Transaction().add(
      createTransferInstruction(
        treasuryTokenAccount.address,
        winnerTokenAccount.address,
        treasuryKeypair.publicKey,
        payoutAmount
      )
    );

    tx.feePayer = treasuryKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.sign(treasuryKeypair);

    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(sig, "confirmed");

    console.log(`✅ Payout sent: ${sig} → ${winnerWallet}`);

    return res.status(200).json({
      success: true,
      signature: sig,
      amount: payoutAmount / Math.pow(10, decimals),
      explorerUrl: `https://solscan.io/tx/${sig}`
    });

  } catch (err) {
    console.error("Payout error:", err);
    return res.status(500).json({ error: err.message });
  }
}
