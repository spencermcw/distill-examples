// Shared helpers for the Distill examples: one function, `ask`, that calls a Distill route on the
// free tier (no wallet) or, when you point DISTILL_KEY_FILE at a buyer key, pays for it over x402.
//
// Environment (all optional):
//   DISTILL_URL        the gateway (default https://data.spencermcw.com)
//   DISTILL_KEY_FILE   a file holding a 0x-prefixed private key (chmod 600). Unset: free tier only.
//   DISTILL_MAINNET    "1" to allow paying on Base mainnet (real USDC). Unset: Base Sepolia only.
//   DISTILL_MAX_USD    the most one call may cost (default 0.05)
//   BASE_RPC_URL       an RPC for the paying network (optional)
import { readFileSync, statSync } from 'node:fs'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { UptoEvmScheme } from '@x402/evm/upto/client'
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from '@x402/fetch'
import { privateKeyToAccount } from 'viem/accounts'

export const BASE_URL = (process.env.DISTILL_URL ?? 'https://data.spencermcw.com').replace(/\/+$/, '')
/** Identifies these examples to Distill's coarse traffic classes; never anything about you. */
export const USER_AGENT = 'distill-examples/0.1 (+https://data.spencermcw.com)'

export const BASE_SEPOLIA = 'eip155:84532'
export const BASE_MAINNET = 'eip155:8453'

/** The answer envelope every Distill route returns, free or paid. */
export type Envelope<T = Record<string, unknown>> = {
  data: T
  sources: { url: string; fetched_at: string; sha256: string; publisher: string; license: string }[]
  as_of: string
  confidence: number
  method_version: string
  price_paid: { amount: string; asset: string; network: string; tx: string } | null
  notices: string[]
  request_id: string
}

export class DistillError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function usdToAtomic(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim())
  if (!m) throw new Error(`DISTILL_MAX_USD must be a USD amount such as 0.05, not ${text}`)
  return BigInt(m[1] as string) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'))
}

/** Reads the buyer key from DISTILL_KEY_FILE, refusing a file other users can read. */
function loadAccount() {
  const path = process.env.DISTILL_KEY_FILE?.trim()
  if (!path) return null
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${path} must be chmod 600`)
  const key = readFileSync(path, 'utf8').trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${path} must hold one 0x-prefixed key`)
  return privateKeyToAccount(key as `0x${string}`)
}

/** The paying network: Base Sepolia unless DISTILL_MAINNET=1. */
export function payingNetwork(): string {
  return process.env.DISTILL_MAINNET === '1' ? BASE_MAINNET : BASE_SEPOLIA
}

/**
 * fetch that pays a 402 on one network only, and never more than DISTILL_MAX_USD for one call.
 * Null without DISTILL_KEY_FILE.
 */
export function payingFetch(): typeof fetch | null {
  const account = loadAccount()
  if (!account) return null
  const network = payingNetwork()
  const max = usdToAtomic(process.env.DISTILL_MAX_USD ?? '0.05')
  const rpc = process.env.BASE_RPC_URL?.trim()
  const options = rpc ? { rpcUrl: rpc } : undefined
  const client = new x402Client()
    .register(network as `${string}:${string}`, new ExactEvmScheme(account, options))
    .register(network as `${string}:${string}`, new UptoEvmScheme(account, options))
    .registerPolicy((_v, reqs) => reqs.filter((r) => r.network === network && BigInt(r.amount) <= max))
  if (network === BASE_MAINNET) {
    console.error(`[distill-examples] paying on Base MAINNET with ${account.address}, at most $${process.env.DISTILL_MAX_USD ?? '0.05'} a call`)
  }
  return wrapFetchWithPayment(fetch, client) as typeof fetch
}

/**
 * Calls a Distill route and returns its envelope. Free tier (header `Distill-Free-Tier: use`) when
 * no key is configured; paid over x402 otherwise.
 */
export async function ask<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  options: { body?: unknown } = {},
): Promise<Envelope<T>> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v))
  const pay = payingFetch()
  const headers: Record<string, string> = { 'user-agent': USER_AGENT, accept: 'application/json' }
  if (!pay) headers['Distill-Free-Tier'] = 'use'
  const init: RequestInit = options.body
    ? { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(options.body) }
    : { headers }
  let res: Response
  try {
    res = await (pay ?? fetch)(url, init)
  } catch (error) {
    const message = (error as Error).message
    if (/no.*(requirement|scheme)|not supported|match/i.test(message)) {
      throw new DistillError(402, 'no_matching_payment',
        `${url.origin} does not accept a payment this client may make (network ${payingNetwork()}, at most $${process.env.DISTILL_MAX_USD ?? '0.05'}). data.spencermcw.com accepts Base mainnet only: set DISTILL_MAINNET=1 to pay real USDC, point DISTILL_URL at a testnet gateway, or unset DISTILL_KEY_FILE to use the free tier. (${message})`)
    }
    throw error
  }
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new DistillError(res.status, 'not_json', text.slice(0, 200))
  }
  if (res.status === 402) {
    throw new DistillError(402, 'payment_required', pay
      ? 'payment was not accepted (see the PAYMENT-REQUIRED header)'
      : 'the free calls for today are used up; pay with an x402 client (set DISTILL_KEY_FILE) or come back tomorrow (UTC)')
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } }).error
    throw new DistillError(res.status, e?.code ?? 'error', e?.message ?? `HTTP ${res.status}`)
  }
  const receipt = res.headers.get('payment-response')
  if (receipt) {
    const settled = decodePaymentResponseHeader(receipt)
    console.error(`[distill-examples] paid, settlement tx ${settled.transaction} on ${settled.network}`)
  }
  return body as Envelope<T>
}

/** One line about where an answer came from. */
export function provenance(e: Envelope<unknown>): string {
  const paid = e.price_paid ? `paid $${e.price_paid.amount}` : 'free tier'
  const publishers = [...new Set(e.sources.map((s) => s.publisher))].join(', ')
  return `${e.method_version} · as of ${e.as_of} · confidence ${e.confidence} · ${paid} · sources: ${publishers || 'n/a'} · request ${e.request_id}`
}

/** Runs a recipe's main, printing a DistillError plainly. */
export function run(main: () => Promise<void>): void {
  main().catch((error) => {
    if (error instanceof DistillError) {
      console.error(`Distill answered ${error.status} ${error.code}: ${error.message}`)
    } else {
      console.error(error)
    }
    process.exitCode = 1
  })
}
