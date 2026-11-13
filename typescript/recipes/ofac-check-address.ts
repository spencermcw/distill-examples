// Recipe: check one crypto address against OFAC's SDN list before you pay it or accept its funds.
//
//   node recipes/ofac-check-address.ts [address]
//
// Exact match against the "Digital Currency Address" identifiers on OFAC's Specially Designated
// Nationals list (Bitcoin, Ethereum and every EVM chain, Tron, Solana, Monero, ...), read daily from
// OFAC's SDN.XML. A fact about the list on its publication date, not a compliance determination.
// Distill does not store the address you send. Up to 100 at once: POST /v1/sanctions/address/batch.
// To screen the seller an x402 client is about to pay, see screen-payto.ts.
import { ask, provenance, run } from '../lib.ts'

type Screen = {
  address: string
  listed: boolean
  publication_date: string
  statement: string
  matches: { asset: string; chain: string; entry: { uid: number; name: string; programs: string[] } }[]
}

run(async () => {
  // An address OFAC lists (LAZARUS GROUP, program DPRK3).
  const address = process.argv[2] ?? '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'
  const answer = await ask<Screen>('/v1/sanctions/address', { address })
  console.log(answer.data.statement)
  for (const m of answer.data.matches) {
    console.log(`  ${m.asset} (${m.chain}): SDN entry ${m.entry.uid} ${m.entry.name}, programs ${m.entry.programs.join(', ')}`)
  }
  console.log(provenance(answer))
  if (answer.data.listed) process.exitCode = 3
})
