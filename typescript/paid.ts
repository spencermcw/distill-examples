// A paid call over x402 with @x402/fetch. The client signs a USDC payment only for the network you
// allow (Base Sepolia by default; Base mainnet with DISTILL_MAINNET=1) and never above
// DISTILL_MAX_USD (default $0.05) per call. The server settles only after the answer is computed.
//
//   DISTILL_KEY_FILE=~/.config/distill-examples/buyer.key node paid.ts [zip]
//
// data.spencermcw.com accepts Base mainnet only. To pay real USDC there:
//   DISTILL_MAINNET=1 DISTILL_KEY_FILE=... node paid.ts      ($0.005 for this call)
import { ask, payingFetch, provenance, run } from './lib.ts'

run(async () => {
  if (!payingFetch()) {
    console.error('Set DISTILL_KEY_FILE to a chmod-600 file holding a buyer key (see README).')
    process.exitCode = 2
    return
  }
  const zip = process.argv[2] ?? '98101-3143'
  const answer = await ask<{ rate: string; components: { type_name: string; general: { intrastate: string } }[] }>(
    '/v1/tax/sales-rate',
    { zip },
  )
  console.log(`Combined rate at ${zip}: ${answer.data.rate}`)
  for (const c of answer.data.components) console.log(`  ${c.type_name.padEnd(28)} ${c.general.intrastate}`)
  console.log(provenance(answer))
})
