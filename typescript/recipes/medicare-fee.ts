// Recipe: what Medicare's Physician Fee Schedule allows for a code at a ZIP.
//
//   node recipes/medicare-fee.ts [code] [zip]
//
// Computed by Distill from CMS's quarterly relative value, GPCI and conversion-factor files. A
// reference price, not what any one patient or plan pays.
import { ask, DistillError, provenance, run } from '../lib.ts'

type Rate = {
  code: string
  release: { id: string; effective_from: string }
  locality: { name: string; state: string }
  nonfacility: { amount: string | null }
  facility: { amount: string | null }
}

run(async () => {
  const code = process.argv[2] ?? '99213'
  const zip = process.argv[3] ?? '80218'
  try {
    const answer = await ask<Rate>('/v1/medicare/pfs/rate', { code, zip })
    const r = answer.data
    console.log(`${r.code} at ${zip} (${r.locality.name}, ${r.locality.state}), release ${r.release.id} from ${r.release.effective_from}:`)
    console.log(`  non-facility (office) $${r.nonfacility.amount ?? 'n/a'}, facility $${r.facility.amount ?? 'n/a'}`)
    console.log(provenance(answer))
  } catch (error) {
    if (error instanceof DistillError && error.status === 404 && error.code === 'not_found') {
      console.error('The Medicare fee-schedule route is not live on this gateway yet; see /llms.txt for what is.')
      process.exitCode = 1
      return
    }
    throw error
  }
})
