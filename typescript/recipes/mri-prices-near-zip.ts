// Recipe: compare posted prices for one procedure at hospitals near a ZIP code.
//
//   node recipes/mri-prices-near-zip.ts [code] [zip]
//
// Default: CPT 70551 (a brain MRI code) near Denver's 80218, outpatient. Hospitals in Colorado for
// now. These are the standard charges hospitals must post under 45 CFR 180: posted rates, not a
// quote; what a patient pays depends on the plan and the care. Distill serves CPT codes without the
// AMA's descriptors. The free tier and the summary view show the nearest few hospitals; each
// hospital's `totals` cover every rate it posts for the code.
import { ask, provenance, run } from '../lib.ts'

type Stats = { n: number; min: string; median: string; max: string } | null
type Prices = {
  hospitals_in_radius: number
  hospitals_with_prices: number
  hospitals: {
    name: string
    city: string | null
    distance_miles: number
    items: { discounted_cash: string | null; gross: string | null; rates: { payer: string; negotiated_dollar: string | null }[] }[]
    totals?: { payers: number; gross: Stats; discounted_cash: Stats; negotiated_dollar: Stats }
  }[]
}

const money = (v: string | undefined) =>
  v ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'n/a'

/** Min, median and max of a list of decimal strings, or null when empty. */
function stats(values: (string | null)[]): Stats {
  const v = values.filter((x): x is string => x !== null).sort((a, b) => Number(a) - Number(b))
  return v.length ? { n: v.length, min: v[0] as string, median: v[Math.floor(v.length / 2)] as string, max: v.at(-1) as string } : null
}

/** Totals from the rows shown, for an answer without `totals`. */
function fromItems(items: Prices['hospitals'][number]['items']) {
  return {
    payers: new Set(items.flatMap((i) => i.rates.map((r) => r.payer))).size,
    gross: stats(items.map((i) => i.gross)),
    discounted_cash: stats(items.map((i) => i.discounted_cash)),
    negotiated_dollar: stats(items.flatMap((i) => i.rates.map((r) => r.negotiated_dollar))),
  }
}

run(async () => {
  const code = process.argv[2] ?? '70551'
  const zip = process.argv[3] ?? '80218'
  const answer = await ask<Prices>('/v1/hospital/prices', { code, zip, radius_miles: 25, setting: 'outpatient' })
  const d = answer.data
  console.log(answer.headline)
  console.log(`${code} within 25 miles of ${zip}: ${d.hospitals_with_prices} of ${d.hospitals_in_radius} hospitals post a price; ${d.hospitals.length} nearest shown`)
  for (const h of d.hospitals) {
    const t = h.totals ?? fromItems(h.items)
    const negotiated = t.negotiated_dollar
      ? `negotiated ${money(t.negotiated_dollar.min)} to ${money(t.negotiated_dollar.max)} (median ${money(t.negotiated_dollar.median)}, ${t.negotiated_dollar.n} rates, ${t.payers} payers)`
      : 'no dollar rates'
    console.log(`- ${h.name} (${h.city ?? '?'}, ${h.distance_miles} mi): cash ${money(t.discounted_cash?.median)}, gross ${money(t.gross?.median)}; ${negotiated}`)
  }
  console.log(provenance(answer))
})
