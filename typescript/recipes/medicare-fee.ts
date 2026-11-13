// Recipe: what Medicare's Physician Fee Schedule allows for a code at a ZIP.
//
//   node recipes/medicare-fee.ts [code] [zip]
//
// Computed by Distill from CMS's quarterly relative value, GPCI and conversion-factor files; every
// amount agrees with CMS's carrier payment files to the cent. A reference price, not what any one
// patient or plan pays. CPT codes come without the AMA's descriptors.
import { ask, provenance, run } from '../lib.ts'

type Amount = { amount: string; limiting_charge: string; opps_capped: boolean } | null

type Rate = {
  code: string
  status_meaning: string
  priced: boolean
  release: { id: string; effective_from: string }
  locality: { name: string; state: string; mac: string; locality: string }
  location: { matched: string }
  nonfacility: Amount
  facility: Amount
}

const show = (a: Amount) => (a ? `$${a.amount} (limiting charge $${a.limiting_charge}${a.opps_capped ? ', OPPS-capped' : ''})` : 'n/a')

run(async () => {
  const code = process.argv[2] ?? '99213'
  const zip = process.argv[3] ?? '80218'
  const answer = await ask<Rate>('/v1/medicare/pfs/rate', { code, zip })
  const r = answer.data
  console.log(answer.headline)
  console.log(`${r.code} at ${zip}: locality ${r.locality.name}, ${r.locality.state} (MAC ${r.locality.mac}, locality ${r.locality.locality}), release ${r.release.id} from ${r.release.effective_from}`)
  if (!r.priced) console.log(`  not priced: ${r.status_meaning}`)
  console.log(`  non-facility (office): ${show(r.nonfacility)}`)
  console.log(`  facility:              ${show(r.facility)}`)
  console.log(provenance(answer))
})
