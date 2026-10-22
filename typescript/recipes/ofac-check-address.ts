// Recipe: check a crypto address against OFAC's SDN list before you pay or accept funds.
//
//   node recipes/ofac-check-address.ts [address]
//
// Exact match against the "Digital Currency Address" identifiers on OFAC's Specially Designated
// Nationals list. A fact about the list, not a compliance determination. Distill does not store the
// address you send.
import { ask, DistillError, provenance, run } from '../lib.ts'

type Screen = {
  address: string
  listed: boolean
  statement: string
  matches: { asset: string; entry: { name: string; programs: string[] } }[]
}

run(async () => {
  // An address OFAC lists (LAZARUS GROUP, program DPRK3).
  const address = process.argv[2] ?? '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'
  try {
    const answer = await ask<Screen>('/v1/sanctions/address', { address })
    console.log(answer.data.statement)
    for (const m of answer.data.matches) console.log(`  ${m.asset}: ${m.entry.name} (${m.entry.programs.join(', ')})`)
    console.log(provenance(answer))
  } catch (error) {
    if (error instanceof DistillError && error.status === 404 && error.code === 'not_found') {
      console.error('The sanctions route is not live on this gateway yet; see /llms.txt for what is.')
      process.exitCode = 1
      return
    }
    throw error
  }
})
