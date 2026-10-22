// Recipe: estimate the sales tax on an order from the ship-to address.
//
//   node recipes/sales-tax-for-order.ts
//
// Distill answers the rate the state publishes for the location and date (Streamlined Sales Tax
// states only); the arithmetic is yours. Facts, not tax advice: taxability of each product,
// exemptions and sourcing rules are outside this lookup.
import { ask, provenance, run } from '../lib.ts'

type Rate = {
  rate: string
  state: string
  matched: 'address' | 'zip4' | 'zip5'
  components: { jurisdiction: string; type_name: string; general: { intrastate: string } }[]
  effective: { from: string; to: string | null }
}

const order = {
  ship_to: { zip: '98101-3143', address: '1301 2nd Ave' },
  lines: [
    { sku: 'desk-lamp', amount: '49.99' },
    { sku: 'bulb-4pack', amount: '12.50' },
  ],
}

/** "49.99" → 4999 cents. */
const cents = (usd: string) => {
  const [whole, frac = ''] = usd.split('.')
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2))
}
/** "0.1035" → 103500 parts per million (exact for the rates states publish). */
const ppm = (rate: string) => {
  const [whole, frac = ''] = rate.split('.')
  return Number(whole) * 1_000_000 + Number(frac.padEnd(6, '0').slice(0, 6))
}
/** Tax in cents, rounded half up. */
const tax = (amountCents: number, ratePpm: number) => Math.floor((amountCents * ratePpm + 500_000) / 1_000_000)
const usd = (c: number) => `$${(c / 100).toFixed(2)}`

run(async () => {
  const answer = await ask<Rate>('/v1/tax/sales-rate', order.ship_to)
  const r = answer.data
  const subtotal = order.lines.reduce((sum, l) => sum + cents(l.amount), 0)
  console.log(`Ship to ${order.ship_to.address}, ${order.ship_to.zip} (${r.state}, matched by ${r.matched})`)
  console.log(`Subtotal ${usd(subtotal)} × combined rate ${r.rate} = sales tax ${usd(tax(subtotal, ppm(r.rate)))}`)
  for (const c of r.components) {
    console.log(`  ${c.jurisdiction.padEnd(8)} ${c.type_name.padEnd(28)} ${c.general.intrastate.padEnd(8)} ${usd(tax(subtotal, ppm(c.general.intrastate)))}`)
  }
  console.log(`Rate in effect ${r.effective.from} to ${r.effective.to ?? 'further notice'}. Many orders? POST /v1/tax/sales-rate/batch takes 100.`)
  console.log(provenance(answer))
})
