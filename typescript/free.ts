// The free tier: no wallet, no key, no signup. A few answers a day per IP, with fewer rows.
//   node free.ts [zip]
import { ask, provenance, run } from './lib.ts'

run(async () => {
  const zip = process.argv[2] ?? '98101-3143'
  const answer = await ask<{ rate: string; state: string; matched: string }>('/v1/tax/sales-rate', { zip })
  console.log(`Combined sales tax rate at ${zip} (${answer.data.state}, matched by ${answer.data.matched}): ${answer.data.rate}`)
  console.log(provenance(answer))
})
