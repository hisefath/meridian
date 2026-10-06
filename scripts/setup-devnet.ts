// One-time cluster setup after `solana program deploy`: test-USDC mint + global config.
// Idempotent: re-running skips whatever already exists.
import { SystemProgram } from '@solana/web3.js';
import { MINT_SIZE, TOKEN_PROGRAM_ID, createInitializeMint2Instruction } from '@solana/spl-token';
import { admin, client, connection, env, loadKeypair, send, usdcMint } from '../automation/src/chain';

const mint = loadKeypair(env('USDC_MINT_KEYPAIR', 'keys/usdc-mint.json'));
if (!mint.publicKey.equals(usdcMint)) throw new Error('USDC_MINT does not match USDC_MINT_KEYPAIR');

if (!(await connection.getAccountInfo(client.programId))) throw new Error(`program ${client.programId.toBase58()} is not deployed on ${connection.rpcEndpoint}`);

if (await connection.getAccountInfo(usdcMint)) console.log(`test USDC mint exists: ${usdcMint.toBase58()}`);
else {
  const sig = await send(
    [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: usdcMint,
        lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(usdcMint, 6, admin.publicKey, null),
    ],
    [admin, mint],
  );
  console.log(`created test USDC mint ${usdcMint.toBase58()} (${sig})`);
}

if (await connection.getAccountInfo(client.config)) console.log(`config exists: ${client.config.toBase58()}`);
else {
  const params = {
    maxStalenessSecs: Number(env('MAX_STALENESS_SECS', '300')),
    maxConfBps: Number(env('MAX_CONF_BPS', '200')),
    overrideDelaySecs: Number(env('OVERRIDE_DELAY_SECS', '3600')),
  };
  const sig = await send([await client.initializeConfig(admin.publicKey, params)]);
  console.log(`initialized config ${client.config.toBase58()} ${JSON.stringify(params)} (${sig})`);
}
console.log({ program: client.programId.toBase58(), admin: admin.publicKey.toBase58(), usdcMint: usdcMint.toBase58() });
