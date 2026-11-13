# Distill examples

Copy-paste ways to call [Distill](https://data.spencermcw.com) from an agent or a script.

Distill answers narrow US public-data questions for AI agents. Every answer cites its sources.
Five data families are live:

| Family | Routes | Price per call |
|---|---|---|
| **OFAC sanctions**: is a crypto address on the SDN list? | `GET /v1/sanctions/address`, `POST /v1/sanctions/address/batch` (100), `GET /v1/sanctions/changes` | $0.005 / $0.05 / $0.02 |
| **Sales tax**: the rate at an address, ZIP+4 or ZIP (24 Streamlined Sales Tax states) | `GET /v1/tax/sales-rate`, `POST /v1/tax/sales-rate/batch` (100), `GET /v1/tax/changes` | $0.005 / $0.10 / $0.05 |
| **Medicare**: Physician Fee Schedule amounts by code and ZIP; Part D plans that cover a drug | `GET /v1/medicare/pfs/rate`, `/pfs/localities`, `/pfs/changes`, `/partd/coverage`, `/partd/plan`, `/partd/changes` | $0.01 to $0.05 |
| **Drug acquisition cost (NADAC)**: what pharmacies pay, per unit | `GET /v1/drug/nadac`, `/nadac/search`, `/nadac/changes` | $0.01 / $0.01 / $0.05 |
| **Hospital prices** (Colorado): posted cash, gross and negotiated rates near a ZIP | `GET /v1/hospital/prices`, `/compare`, `/payers`, `/changes` | $0.02 to $0.05 |

Each answer is one JSON envelope: `headline` (one plain line), `data`, `sources` (URL, fetch time
and sha256 of every file used), `as_of`, a computed `confidence`, `method_version`, `price_paid`
(null when free), `notices`, `view` and `request_id`. These are facts, not advice: posted rates are
not a quote, and a sanctions match is not a compliance determination.

- **HTTP API:** `https://data.spencermcw.com` (OpenAPI 3.1 at
  [`/openapi.json`](https://data.spencermcw.com/openapi.json), every route and price in
  [`/llms.txt`](https://data.spencermcw.com/llms.txt))
- **MCP:** `https://data.spencermcw.com/mcp` (streamable HTTP, stateless, no auth)
- **Freshness:** [`/status`](https://data.spencermcw.com/status) shows each dataset's as-of date

## Three ways in

**1. Free, no wallet: add `?free=1`** (or send the header `Distill-Free-Tier: use`). Every paid
route answers 3 free calls a day per IP per family, in the short summary view:

```sh
curl 'https://data.spencermcw.com/v1/sanctions/address?address=0x098B716B8Aaf21512996dC57EB0615e2383E2f96&free=1'
curl 'https://data.spencermcw.com/v1/tax/sales-rate?zip=98101-3143&free=1'
curl 'https://data.spencermcw.com/v1/medicare/pfs/rate?code=99213&zip=80218&free=1'
curl 'https://data.spencermcw.com/v1/medicare/partd/coverage?rxcui=617311&state=CO&county=Denver&plan_year=2027&free=1'
curl 'https://data.spencermcw.com/v1/drug/nadac/search?name=atorvastatin+40&free=1'
curl 'https://data.spencermcw.com/v1/hospital/prices?code=70551&zip=80218&radius_miles=25&free=1'
curl -X POST 'https://data.spencermcw.com/v1/sanctions/address/batch?free=1' \
  -H 'content-type: application/json' -d '{"addresses":["0x098B716B8Aaf21512996dC57EB0615e2383E2f96"]}'
```

In a browser, put `/try` in front of the path for the same answer as a page:
<https://data.spencermcw.com/try/v1/tax/sales-rate?zip=98101-3143>. Once the day's free calls for
a family are used (UTC days), the route answers 402 like an unpaid call.

**2. MCP, free while the free tier lasts.** An unpaid tool call takes the free tier first, then
returns the x402 payment requirements:

```json
{ "mcpServers": { "distill": { "type": "http", "url": "https://data.spencermcw.com/mcp" } } }
```

The default tool list has 8 tools (`tax_sales_rate`, `tax_sales_rate_batch`, `hospital_prices`,
`medicare_pfs_rate`, `medicare_partd_coverage`, `drug_nadac`, `drug_nadac_search`,
`sanctions_address`) plus `distill_status`, which is always free. `/mcp?profile=full` lists one
tool per route.

**3. Paid over [x402](https://x402.org).** Without `?free=1`, a paid route answers HTTP 402 with a
`PAYMENT-REQUIRED` header (base64 JSON): USDC on Base mainnet (`eip155:8453`), the exact amount and
the `payTo` address. Any x402 client signs a payment and retries, with no account or API key. The
answer is computed before the payment settles, so a failed answer is never charged. See the
payment requirements without paying:

```sh
curl -s -D - -o /dev/null 'https://data.spencermcw.com/v1/sanctions/address?address=0x098B716B8Aaf21512996dC57EB0615e2383E2f96' \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d
```

## Recipe: check an x402 payTo against OFAC before paying

An agent that pays x402 sellers can check each seller's `payTo` address against OFAC's SDN list
before it signs. [`typescript/recipes/screen-payto.ts`](typescript/recipes/screen-payto.ts) adds
one hook to the `x402Client` you already use with `@x402/fetch`:

```ts
import { wrapFetchWithPayment } from '@x402/fetch'
import { distillPayToCheck, screenPayTo } from './recipes/screen-payto.ts'

// `client` is your configured x402Client (schemes, policies).
const payingFetch = wrapFetchWithPayment(fetch, screenPayTo(client, distillPayToCheck()))
```

Before the client signs, the hook looks up the exact `payTo` it is about to pay with
`GET /v1/sanctions/address` and aborts the payment when:

- the address is on the SDN list;
- the list Distill answered from is stale (`confidence` below 0.5); or
- the check itself fails, because the hook fails closed.

The hook checks each address at most once an hour. Each check costs $0.005 over x402 (paid with
the same key, through a client without the hook) or uses the free tier (`distillPayToCheck({ free:
true })`, 3 a day).

Run it as a dry run first. It fetches the 402, checks every `payTo` it offers and signs nothing:

```sh
cd typescript && npm ci
node recipes/screen-payto.ts                                   # Distill's own 402
node recipes/screen-payto.ts 'https://seller.example/paid-route'   # any x402 URL
node recipes/screen-payto.ts --payto 0x098B716B8Aaf21512996dC57EB0615e2383E2f96   # as if the seller asked for a listed address
```

Live output from 2026-11-13:

```text
$ node recipes/screen-payto.ts
exact eip155:8453 5000 atomic units to 0xE6900aE625875b748f56Fb45C3e06a59Be8870DF
  clear: not on the SDN list; OK to pay
Dry run: nothing was signed or paid.

$ node recipes/screen-payto.ts --payto 0x098B716B8Aaf21512996dC57EB0615e2383E2f96
exact eip155:8453 5000 atomic units to 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 (pretend)
  REFUSE: payTo 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 is on OFAC's SDN list as of 2026-11-09: LAZARUS GROUP (DPRK3)
Dry run: nothing was signed or paid.
```

A dry run exits 3 when it would refuse a payment. With `--pay` and `DISTILL_KEY_FILE` it pays, but
only to a `payTo` that passes (see "Paying"). An aborted payment throws
`Payment creation aborted: payTo ... is on OFAC's SDN list ...` from the wrapped fetch. The check is
an exact match on the list as published. It does not apply the 50% rule, trace indirect exposure or
check other lists.

## What's here

| Path | What it does |
|---|---|
| `typescript/recipes/screen-payto.ts` | Checks an x402 seller's `payTo` against OFAC before paying (above) |
| `typescript/recipes/ofac-check-address.ts` | Checks one crypto address against OFAC's SDN list |
| `typescript/recipes/sales-tax-for-order.ts` | Estimates the sales tax on an order from its ship-to address |
| `typescript/recipes/medicare-fee.ts` | The Medicare Physician Fee Schedule amount for a code at a ZIP |
| `typescript/recipes/partd-coverage.ts` | Which Medicare Part D plans in a county cover a drug, at what tier and cost |
| `typescript/recipes/nadac-drug-cost.ts` | What pharmacies pay for a drug (NADAC), by name or NDC |
| `typescript/recipes/mri-prices-near-zip.ts` | Posted prices for one procedure code at hospitals near a ZIP |
| `typescript/free.ts`, `typescript/paid.ts` | A sales-tax rate on the free tier, and paid over x402 |
| `typescript/lib.ts` | `ask()`: a free or paid call returning the envelope; the guarded x402 client |
| `python/free.py` | The free tier from Python, standard library only |
| `python/paid.py` | A paid call with the `x402` Python package (httpx) |
| `mcp/claude-desktop.json`, `mcp/cursor.json`, `mcp/claude-code.sh` | MCP client configs |
| `mcp/check.ts` | Connects to the MCP endpoint with plain `fetch`, lists the tools and calls one |

## Running the examples

There is no build step: each file runs as it is, with Node 24+ (which runs `.ts` directly) or
Python 3.10+. Nothing here spends money unless you point `DISTILL_KEY_FILE` at a key and also
allow mainnet (see "Paying"). Without a key, every example uses the free tier.

```sh
cd typescript && npm ci
node recipes/screen-payto.ts                              # sanctions: payTo check, dry run
node recipes/ofac-check-address.ts [address]              # sanctions: exits 3 when listed
node free.ts [zip]                                        # sales tax: one rate
node recipes/sales-tax-for-order.ts                       # sales tax: tax on a sample order
node recipes/medicare-fee.ts [code] [zip]                 # Medicare PFS
node recipes/partd-coverage.ts [rxcui] [state] [county] [plan_year]   # Medicare Part D
node recipes/nadac-drug-cost.ts ["name strength" | ndc]   # NADAC
node recipes/mri-prices-near-zip.ts [code] [zip]          # hospital prices (Colorado)
node ../mcp/check.ts                                      # MCP: list tools, call distill_status (free)
node ../mcp/check.ts sanctions_address '{"address":"0x098B716B8Aaf21512996dC57EB0615e2383E2f96"}'
```

```sh
python3 python/free.py 43215                              # from the repo root; standard library only
```

Live output from 2026-11-13, free tier (trimmed):

```text
$ node recipes/ofac-check-address.ts
Listed on OFAC's SDN list as of 2026-11-09.
  ETH (Ethereum (EVM)): SDN entry 27307 LAZARUS GROUP, programs DPRK3
sanctions.address@1.0.0 · as of 2026-11-09T00:00:00.000Z · confidence 1 · free tier · sources: US Department of the Treasury, Office of Foreign Assets Control (OFAC) · request 8bee28ad-…

$ node free.ts
Combined sales tax rate at 98101-3143 (WA, matched by zip4): 0.1055
tax.sales_rate@1.0.0 · as of 2026-10-21T03:09:20.973Z · confidence 1 · free tier · sources: Washington State Department of Revenue (posted by the Streamlined Sales Tax Governing Board) · request de1e1b00-…

$ node recipes/medicare-fee.ts
Medicare (2026D) pays $98.18 non-facility and $58.02 facility for CPT 99213 in COLORADO (locality 04112-01, ZIP 80218).
99213 at 80218: locality COLORADO, CO (MAC 04112, locality 01), release 2026D from 2026-10-01
  non-facility (office): $98.18 (limiting charge $107.26)
  facility:              $58.02 (limiting charge $63.39)

$ node recipes/partd-coverage.ts
67 of 67 Part D plans in Denver, CO cover RxCUI 617311 in 2027 (tiers 1 among those listed); 0 of the 3 listed require prior authorization.
- H0028-063-000 Humana Essentials Plus Giveback (HMO) (MA): premium $0.00/mo, tier 1, no PA, ST or QL; …

$ node recipes/nadac-drug-cost.ts
1 NADAC products match "atorvastatin 40" (file of 2026-11-04); ATORVASTATIN 40 MG TABLET: $0.03688 per EA.
- ATORVASTATIN 40 MG TABLET (G): $0.03688 per EA, 69 NDCs, e.g. 00093505810, 00093505898

$ node recipes/nadac-drug-cost.ts 00378410591
00378410591 ABACAVIR 300 MG TABLET (G): $0.55226 per EA from 2026-10-21
  $0.55226 from 2026-10-21
  $0.54555 from 2026-09-23
  $0.53801 from 2026-08-19

$ node recipes/mri-prices-near-zip.ts
70551 within 25 miles of 80218: 27 of 48 hospitals post a price; 3 nearest shown
- INTERMOUNTAIN HEALTH SAINT JOSEPH HOSPITAL (DENVER, 1 mi): cash n/a, gross $3,207.80; negotiated $240.49 to $3,111.57 (median $1,279.91, 92 rates, 14 payers)
- HCA HEALTHONE PRESBYTERIAN ST. LUKE'S (DENVER, 1.1 mi): cash $13,494.25, gross $13,494.25; negotiated $163.96 to $12,144.83 (median $4,048.28, 38 rates, 11 payers)
- DENVER HEALTH MEDICAL CENTER (DENVER, 1.1 mi): cash $1,487.61, gross $4,250.29; negotiated $251.70 to $2,429.00 (median $836.00, 9 rates, 6 payers)

$ node ../mcp/check.ts
connected: distill 1.0.0
9 tools:
  tax_sales_rate             What is the sales tax rate at this US address, ZIP+4 or ZIP? …
  …
distill_status answered (distill.status@1.0.0, free): All 6 datasets are within their refresh cadence.
```

The free tier and the summary view return at most 3 rows, so Part D shows 3 of 67 plans and the
hospital recipe shows the 3 nearest hospitals. A paid call returns every row (`view=full`).

## MCP clients

```sh
sh mcp/claude-code.sh        # Claude Code: claude mcp add --transport http distill <url>
```

For Cursor, merge `mcp/cursor.json` into its MCP config. For Claude Desktop, add the URL as a
custom connector, or merge `mcp/claude-desktop.json`, which reaches the server through
`mcp-remote`. Over MCP, a paid tool call takes the free tier first. After that, it returns
`isError` with the x402 `PaymentRequired` object as `structuredContent`. An x402-aware MCP
client pays by retrying with the payment in `_meta["x402/payment"]` (the `@x402/mcp` convention).
Send `_meta["distill/free-tier"]: "skip"` to skip the free tier.

## Paying

The examples refuse to spend real money unless you ask them to.

- **Testnet by default.** The paying client registers Base Sepolia (`eip155:84532`) only. It
  refuses any payment above `DISTILL_MAX_USD` (default `0.05`) for a single call.
- **Mainnet is opt-in.** `data.spencermcw.com` accepts Base mainnet only. Pointed at it, the
  default client stops with a clear message before signing anything. To pay real USDC, set
  `DISTILL_MAINNET=1`. Use a wallet that holds only a few dollars.
- **Keys live in a file outside this repo, never in it.** Point `DISTILL_KEY_FILE` at a file that
  holds one `0x…` private key and is `chmod 600`. `.gitignore` ignores `*.key` and `.env*` anyway.

  ```sh
  mkdir -p ~/.config/distill-examples && chmod 700 ~/.config/distill-examples
  (cd typescript && node --input-type=module -e "import { generatePrivateKey } from 'viem/accounts'; console.log(generatePrivateKey())") > ~/.config/distill-examples/buyer.key
  chmod 600 ~/.config/distill-examples/buyer.key
  ```

  Then fund that address with a little USDC on Base: from <https://faucet.circle.com> for testnet,
  or from your own wallet for mainnet.

- **Testnet against a testnet gateway:** set `DISTILL_URL` to a Distill gateway running on Base
  Sepolia, then run `DISTILL_KEY_FILE=… node paid.ts`.
- **Mainnet:** `DISTILL_MAINNET=1 DISTILL_KEY_FILE=… node paid.ts` costs $0.005.
  `DISTILL_MAINNET=1 DISTILL_KEY_FILE=… node recipes/screen-payto.ts <url> --pay` pays the
  route's price plus $0.005 for each new `payTo` check.

| Variable | Default | Meaning |
|---|---|---|
| `DISTILL_URL` | `https://data.spencermcw.com` | The gateway |
| `DISTILL_KEY_FILE` | unset (free tier) | The buyer key file (`chmod 600`) |
| `DISTILL_MAINNET` | unset (Base Sepolia only) | `1` lets the client pay on Base mainnet |
| `DISTILL_MAX_USD` | `0.05` | The most one call may cost |
| `BASE_RPC_URL` | the scheme's default | An RPC for the paying network (TypeScript) |
| `DISTILL_MCP_URL` | `https://data.spencermcw.com/mcp?via=examples` | The endpoint `mcp/check.ts` talks to |

## Privacy

- The examples send the User-Agent `distill-examples/0.2`. The MCP configs use `?via=examples`.
  Distill reduces both to coarse counters of where its traffic comes from. It stores no raw IPs or
  payer addresses (only salted hashes) and logs no request bodies.
- The sanctions recipes send the address you check. Distill does not store it.

## Links

- Landing page: <https://data.spencermcw.com>
- `llms.txt`: <https://data.spencermcw.com/llms.txt> (and `llms-full.txt` with every schema)
- OpenAPI 3.1: <https://data.spencermcw.com/openapi.json>
- Freshness: <https://data.spencermcw.com/status>
- MCP: `https://data.spencermcw.com/mcp` (streamable HTTP), listed as `com.spencermcw.data/distill`
  in the official MCP registry
- Terms: <https://data.spencermcw.com/terms>

MIT licensed. See `LICENSE`.
