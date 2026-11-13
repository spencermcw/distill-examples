// Recipe: what US pharmacies pay for a drug (CMS's National Average Drug Acquisition Cost).
//
//   node recipes/nadac-drug-cost.ts ["drug name and strength"]   search by name
//   node recipes/nadac-drug-cost.ts 00378410591                   one NDC (11 digits): cost and history
//
// From CMS's weekly NADAC files on data.medicaid.gov. A survey average of what retail pharmacies
// pay to acquire the drug, per unit (tablet, mL, ...), not the price a patient pays at the counter.
import { ask, provenance, run } from '../lib.ts'

type Search = {
  query: string
  matches: { description: string; pricing_unit: string; classification: string; ndcs: number; nadac_per_unit: { min: string; max: string }; effective_date: string; sample_ndcs: string[] }[]
}
type Ndc = {
  ndc: string
  description: string
  pricing_unit: string
  classification: string
  listed: boolean
  current: { nadac_per_unit: string; effective_date: string } | null
  corresponding_generic: { nadac_per_unit: string } | null
  history: { nadac_per_unit: string; effective_date: string }[]
}

run(async () => {
  const query = process.argv[2] ?? 'atorvastatin 40'
  if (/^\d{11}$/.test(query.replace(/-/g, ''))) {
    const answer = await ask<Ndc>('/v1/drug/nadac', { ndc: query.replace(/-/g, '') })
    const d = answer.data
    console.log(answer.headline)
    console.log(`${d.ndc} ${d.description} (${d.classification}): ${d.current ? `$${d.current.nadac_per_unit} per ${d.pricing_unit} from ${d.current.effective_date}` : 'not in the current file'}`)
    if (d.corresponding_generic) console.log(`  the generic's NADAC: $${d.corresponding_generic.nadac_per_unit} per ${d.pricing_unit}`)
    for (const h of d.history) console.log(`  $${h.nadac_per_unit} from ${h.effective_date}`)
    console.log(provenance(answer))
    return
  }
  const answer = await ask<Search>('/v1/drug/nadac/search', { name: query })
  console.log(answer.headline)
  for (const m of answer.data.matches) {
    const range = m.nadac_per_unit.min === m.nadac_per_unit.max ? `$${m.nadac_per_unit.min}` : `$${m.nadac_per_unit.min} to $${m.nadac_per_unit.max}`
    console.log(`- ${m.description} (${m.classification}): ${range} per ${m.pricing_unit}, ${m.ndcs} NDCs, e.g. ${m.sample_ndcs.slice(0, 2).join(', ')}`)
  }
  console.log(provenance(answer))
})
