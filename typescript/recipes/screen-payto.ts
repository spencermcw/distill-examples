// Recipe: check an x402 seller's payTo address against OFAC's SDN list before your client pays it.
//
//   node recipes/screen-payto.ts [x402-url]                     dry run: read the 402, screen, pay nothing
//   node recipes/screen-payto.ts [x402-url] --payto 0xABC...    dry run, as if the seller asked to be paid at 0xABC...
//   DISTILL_KEY_FILE=... node recipes/screen-payto.ts [x402-url] --pay    pay, but only a payTo that passes
//
// The part to copy into your own agent is `screenPayTo`: one onBeforePaymentCreation hook on the
// x402Client you already use with @x402/fetch. It looks up the exact payTo the client is about to
// sign for and aborts the payment when that address is on OFAC's SDN list, when the list Distill
// answered from is stale (confidence below `minConfidence`) or when the check itself fails (fail
// closed). Each address is checked once an hour at most.
//
// The check is GET /v1/sanctions/address: $0.005 over x402, or one of 3 free calls a day per IP.
// A fact about OFAC's list on its publication date, not a compliance determination: no 50% rule,
// no indirect exposure, no other list. Distill does not store the address you send.
import { wrapFetchWithPayment, type x402Client } from '@x402/fetch'
import { ask, type Envelope, payingClient, run, USER_AGENT } from '../lib.ts'

type Screen = {
  address: string
  listed: boolean
  publication_date: string
  statement: string
  matches: { asset: string; entry: { name: string; programs: string[] } }[]
}

/** Why a payment to `payTo` must not go ahead, or null when it may. */
export type PayToCheck = (payTo: string) => Promise<string | null>

/**
 * Builds a payTo check backed by Distill. `free: true` uses the free tier (3 a day); otherwise
 * each new address costs $0.005, paid with the key in DISTILL_KEY_FILE (via a client without this
 * hook, so the check never screens itself).
 */
export function distillPayToCheck(options: { free?: boolean; minConfidence?: number; ttlMs?: number } = {}): PayToCheck {
  const minConfidence = options.minConfidence ?? 0.5
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000
  const cache = new Map<string, { at: number; verdict: Promise<string | null> }>()
  const check = async (payTo: string): Promise<string | null> => {
    let answer: Envelope<Screen>
    try {
      answer = await ask<Screen>('/v1/sanctions/address', { address: payTo }, { free: options.free })
    } catch (error) {
      return `could not screen payTo ${payTo} (${(error as Error).message}); not paying`
    }
    const d = answer.data
    if (d.listed) {
      const who = d.matches.map((m) => `${m.entry.name} (${m.entry.programs.join(', ')})`).join('; ')
      return `payTo ${payTo} is on OFAC's SDN list as of ${d.publication_date}: ${who}`
    }
    if (answer.confidence < minConfidence) {
      return `the SDN list Distill answered from is stale (as of ${answer.as_of}, confidence ${answer.confidence}); not paying`
    }
    return null
  }
  return (payTo) => {
    const key = /^0x[0-9a-fA-F]{40}$/.test(payTo) ? payTo.toLowerCase() : payTo
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.verdict
    const verdict = check(payTo)
    cache.set(key, { at: Date.now(), verdict })
    verdict.then((v) => v?.startsWith('could not screen') && cache.delete(key)) // retry failed checks
    return verdict
  }
}

/** Adds the payTo screen to an x402 client. This is the whole integration. */
export function screenPayTo(client: x402Client, check: PayToCheck): x402Client {
  return client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const reason = await check(selectedRequirements.payTo)
    return reason ? { abort: true, reason } : undefined
  })
}

/** Reads the x402 payment requirements from a 402 (v2 header, or the v1 body). */
async function paymentRequired(res: Response) {
  const header = res.headers.get('payment-required')
  const json = header ? Buffer.from(header, 'base64').toString('utf8') : await res.text()
  return JSON.parse(json) as { accepts: { scheme: string; network: string; amount?: string; maxAmountRequired?: string; payTo: string }[] }
}

// Runs only as a script, so other code can import screenPayTo and distillPayToCheck.
if (import.meta.main) run(async () => {
  const args = process.argv.slice(2)
  const pay = args.includes('--pay')
  const i = args.indexOf('--payto')
  const pretend = i >= 0 ? args[i + 1] : undefined
  const url = args.find((a, j) => !a.startsWith('--') && args[j - 1] !== '--payto') ??
    'https://data.spencermcw.com/v1/tax/sales-rate?zip=98101-3143'

  if (pay) {
    if (pretend) throw new Error('--payto is for dry runs only')
    const client = payingClient()
    if (!client) throw new Error('--pay needs DISTILL_KEY_FILE (see README); without it this is a dry run')
    const fetchWithScreen = wrapFetchWithPayment(fetch, screenPayTo(client, distillPayToCheck()))
    const res = await fetchWithScreen(url, { headers: { 'user-agent': USER_AGENT } })
    console.log(`HTTP ${res.status}`)
    console.log((await res.text()).slice(0, 600))
    return
  }

  // Dry run: look at the 402 and screen every payTo it offers, without signing anything.
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })
  if (res.status !== 402) {
    console.log(`${url} answered HTTP ${res.status}, not 402: nothing to pay, nothing to screen.`)
    return
  }
  const { accepts } = await paymentRequired(res)
  const check = distillPayToCheck({ free: true })
  let blocked = false
  for (const a of accepts) {
    const payTo = pretend ?? a.payTo
    const reason = await check(payTo)
    const amount = a.amount ?? a.maxAmountRequired
    console.log(`${a.scheme} ${a.network} ${amount} atomic units to ${payTo}${pretend ? ' (pretend)' : ''}`)
    console.log(reason ? `  REFUSE: ${reason}` : '  clear: not on the SDN list; OK to pay')
    blocked ||= reason !== null
  }
  console.log('Dry run: nothing was signed or paid.')
  if (blocked) process.exitCode = 3
})
