// Recipe: compare posted prices for one procedure at hospitals near a ZIP code.
//
//   node recipes/mri-prices-near-zip.ts [code] [zip]
//
// Default: CPT 70551 (a brain MRI code) near Denver's 80218, outpatient. Hospitals in Colorado for
// now. These are the standard charges hospitals must post under 45 CFR 180: posted rates, not a
// quote; what a patient pays depends on the plan and the care. Distill serves CPT codes without the
// AMA's descriptors.
import { ask, provenance, run } from '../lib.ts'

type Prices = {
  hospitals_with_prices: number
  hospitals: {
    name: string
    city: string
    distance_miles: number
    items: {
      setting: string
      gross: string | null
      discounted_cash: string | null
      rates: { payer: string; plan_type: string; negotiated_dollar: string | null }[]
    }[]
  }[]
}

const money = (v: string | null | undefined) => (v ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'n/a')

run(async () => {
  const code = process.argv[2] ?? '70551'
  const zip = process.argv[3] ?? '80218'
  const answer = await ask<Prices>('/v1/hospital/prices', { code, zip, radius_miles: 25, setting: 'outpatient' })
  console.log(`${code} near ${zip}: ${answer.data.hospitals_with_prices} hospitals post a price; nearest first`)
  for (const h of answer.data.hospitals) {
    for (const item of h.items) {
      const negotiated = item.rates.map((r) => Number(r.negotiated_dollar)).filter((n) => n > 0).sort((a, b) => a - b)
      const range = negotiated.length
        ? `${money(String(negotiated[0]))} to ${money(String(negotiated.at(-1)))} across ${negotiated.length} payer rates`
        : 'no dollar rates'
      console.log(`- ${h.name} (${h.city}, ${h.distance_miles} mi, ${item.setting}): cash ${money(item.discounted_cash)}, gross ${money(item.gross)}; negotiated ${range}`)
    }
  }
  for (const n of answer.notices) console.log(`  note: ${n}`)
  console.log(provenance(answer))
})
