// Recipe: which Medicare Part D plans sold in a county cover a drug, at what tier and cost.
//
//   node recipes/partd-coverage.ts [rxcui] [state] [county] [plan_year]
//
// Default: RxCUI 617311 (atorvastatin 40 mg oral tablet) in Denver County, CO, plan year 2027 (the
// one on sale in open enrollment, Oct 15 to Dec 7). From CMS's monthly Part D formulary files.
// The free tier and the summary view show the first few plans; a paid call returns every one.
// Facts from CMS's files, not advice on which plan to choose.
import { ask, provenance, run } from '../lib.ts'

type Cost = { type: 'copay' | 'coinsurance' | 'not_offered'; amount: string | null }
type Coverage = {
  plan_year: number
  location: { state: string; county: string }
  plans_in_area: number
  plans_covering: number
  plans: {
    plan: string
    plan_name: string
    kind: string
    premium: string | null
    deductible: string | null
    drug: { tier: number; prior_authorization: boolean; step_therapy: boolean; quantity_limit: { amount: string; days: string } | null }
    cost_30_day: { preferred_retail: Cost; standard_retail: Cost } | null
  }[]
}

const offered = (c: Cost | undefined) => c !== undefined && c.type !== 'not_offered'
const cost = (c: Cost) => (c.type === 'copay' ? `$${c.amount} copay` : `${c.amount}% coinsurance`)
/** The 30-day retail cost at a preferred pharmacy, else a standard one. */
function retail(c: Coverage['plans'][number]['cost_30_day']): string {
  if (c && offered(c.preferred_retail)) return `${cost(c.preferred_retail)} for 30 days (preferred pharmacy)`
  if (c && offered(c.standard_retail)) return `${cost(c.standard_retail)} for 30 days (standard pharmacy)`
  return 'no 30-day retail cost in the file'
}

run(async () => {
  const [rxcui = '617311', state = 'CO', county = 'Denver', plan_year = '2027'] = process.argv.slice(2)
  const answer = await ask<Coverage>('/v1/medicare/partd/coverage', { rxcui, state, county, plan_year })
  const d = answer.data
  console.log(answer.headline)
  console.log(`${d.plans_covering} of ${d.plans_in_area} plans in ${d.location.county}, ${d.location.state} cover RxCUI ${rxcui} in ${d.plan_year}; ${d.plans.length} shown:`)
  for (const p of d.plans) {
    const limits = [p.drug.prior_authorization && 'prior auth', p.drug.step_therapy && 'step therapy', p.drug.quantity_limit && `qty limit ${p.drug.quantity_limit.amount}/${p.drug.quantity_limit.days} days`]
      .filter(Boolean).join(', ') || 'no PA, ST or QL'
    console.log(`- ${p.plan} ${p.plan_name} (${p.kind}): premium $${p.premium ?? 'n/a'}/mo, tier ${p.drug.tier}, ${limits}; ${retail(p.cost_30_day)}`)
  }
  console.log(provenance(answer))
})
