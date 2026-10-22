# Distill examples

Copy-pasteable ways to call [Distill](https://data.spencermcw.com) from an agent or a script.

Distill answers narrow US public-data questions for AI agents, with the sources on every answer:

- sales-tax rates by address, ZIP+4 or ZIP in the 24 Streamlined Sales Tax states;
- posted hospital prices by billing code near a ZIP (Colorado for now).

More are being added. `/llms.txt` on the server always lists what is live and what each route
costs. Each answer comes in one envelope with `sources` (URL, fetch time and sha256 of every file
used), `as_of`, a computed `confidence` and a `method_version`.

- **HTTP API:** `https://data.spencermcw.com` (OpenAPI 3.1 at `/openapi.json`)
- **MCP:** `https://data.spencermcw.com/mcp` (streamable HTTP, stateless, no auth)

**Prices are per call, paid over [x402](https://x402.org):** the route answers HTTP 402 with a
price, the client signs a USDC payment on Base and retries, with no account and no API key. Calls
cost from $0.005 (a sales-tax rate) to $0.05 (a page of a change feed). Each data family also has
a small free tier per IP (3 calls a day at the time of writing), which needs no wallet. Every
example here uses the free tier unless you give it a key.

These are facts, not advice: posted rates are not a quote, and tax rates are as each state
publishes them.

## In 3 lines

**Free tier, no wallet:**

```sh
curl -H 'Distill-Free-Tier: use' 'https://data.spencermcw.com/v1/tax/sales-rate?zip=98101-3143'
```

**MCP** (Claude, Cursor, any streamable-HTTP client):

```json
{ "mcpServers": { "distill": { "type": "http", "url": "https://data.spencermcw.com/mcp" } } }
```

**Paid, with `@x402/fetch`.** This snippet pays real USDC on Base mainnet; read "Paying" first:

```ts
const account = privateKeyToAccount(process.env.BUYER_KEY)
const pay = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: 'eip155:8453', client: new ExactEvmScheme(account) }] })
console.log((await (await pay('https://data.spencermcw.com/v1/tax/sales-rate?zip=98101-3143')).json()).data)
```

## What's here

| Path | What it does |
|---|---|
| `typescript/free.ts` | A sales-tax rate on the free tier |
| `typescript/paid.ts` | The same call paid over x402 with `@x402/fetch` |
| `typescript/recipes/sales-tax-for-order.ts` | Estimates the sales tax on an order from its ship-to address |
| `typescript/recipes/mri-prices-near-zip.ts` | Compares posted prices for one procedure code at hospitals near a ZIP |
| `typescript/recipes/ofac-check-address.ts` | Checks a crypto address against OFAC's SDN list *(answers once that route is live)* |
| `typescript/recipes/medicare-fee.ts` | Looks up the Medicare Physician Fee Schedule amount for a code at a ZIP *(answers once that route is live)* |
| `python/free.py` | The free tier from Python, standard library only |
| `python/paid.py` | A paid call with the `x402` Python package (httpx) |
| `mcp/claude-desktop.json`, `mcp/cursor.json`, `mcp/claude-code.sh` | MCP client configs |
| `mcp/check.ts` | Connects to the MCP endpoint with plain `fetch`, lists the tools and calls one |

## Running the examples

There is no CI or build step: each file runs as it is. None of these spends money unless you point
`DISTILL_KEY_FILE` at a key (see "Paying").

**TypeScript** (Node 24+ runs `.ts` files directly):

```sh
cd typescript && npm ci
node free.ts 43215                                   # free tier: a sales-tax rate
node recipes/sales-tax-for-order.ts                  # free tier: tax on a sample order
node recipes/mri-prices-near-zip.ts 70551 80218      # free tier: posted prices near a ZIP
node recipes/ofac-check-address.ts                   # free tier, once the route is live
node recipes/medicare-fee.ts 99213 80218             # free tier, once the route is live
DISTILL_KEY_FILE=~/.config/distill-examples/buyer.key node paid.ts   # pays; see "Paying"
```

**Python** (3.10+, from the repo root):

```sh
python3 python/free.py 43215                         # free tier, standard library only
python3 -m venv .venv && .venv/bin/pip install -r python/requirements.txt
DISTILL_KEY_FILE=~/.config/distill-examples/buyer.key .venv/bin/python python/paid.py   # pays
```

**MCP** (from the repo root, after `npm ci` above):

```sh
sh mcp/claude-code.sh                                # adds Distill to Claude Code
node mcp/check.ts                                    # lists the tools, calls one on the free tier
node mcp/check.ts hospital_prices '{"code":"70551","zip":"80218","radius_miles":25}'
```

For Claude Desktop or Cursor, merge `mcp/claude-desktop.json` or `mcp/cursor.json` into that
client's MCP config. Claude Desktop reaches the remote server through `mcp-remote`.

## The free tier

- Each paid route answers a few free calls a day per IP, with fewer rows (3 calls a day per data
  family at the time of writing). The answer's `notices` say how many are left.
- **Over HTTP:** send the header `Distill-Free-Tier: use`. Without it, an unpaid call answers
  `402` with the x402 payment requirements.
- **Over MCP:** an unpaid tool call takes the free tier while it lasts. After that it returns the
  payment requirements.

## Paying

The examples refuse to spend real money unless you ask them to.

- **Testnet by default.** The paying client registers Base Sepolia (`eip155:84532`) only. It
  refuses any payment above `DISTILL_MAX_USD` (default `0.05`) for a single call.
- **Mainnet is opt-in.** `data.spencermcw.com` accepts Base mainnet only. Pointed at it, the
  default client stops with a clear message before signing anything. To pay real USDC, set
  `DISTILL_MAINNET=1`. Use a wallet that holds only a few dollars.
- **Keys live in a file outside this repo, never in it.** Point `DISTILL_KEY_FILE` at a file that
  holds one `0x…` private key and is `chmod 600`. `.gitignore` ignores `*.key` anyway.

  ```sh
  mkdir -p ~/.config/distill-examples && chmod 700 ~/.config/distill-examples
  (cd typescript && node --input-type=module -e "import { generatePrivateKey } from 'viem/accounts'; console.log(generatePrivateKey())") > ~/.config/distill-examples/buyer.key
  chmod 600 ~/.config/distill-examples/buyer.key
  ```

  Then fund that address with a little USDC on Base: from <https://faucet.circle.com> for testnet,
  or from your own wallet for mainnet.

- **Testnet against a testnet gateway.** Set `DISTILL_URL` to a Distill gateway running on Base
  Sepolia, then run `DISTILL_KEY_FILE=… node paid.ts`.
- **Mainnet:** `DISTILL_MAINNET=1 DISTILL_KEY_FILE=… node paid.ts` costs $0.005.

Payment settles only after the answer is computed, so a failed answer is never charged.

| Variable | Default | Meaning |
|---|---|---|
| `DISTILL_URL` | `https://data.spencermcw.com` | The gateway |
| `DISTILL_KEY_FILE` | unset (free tier) | The buyer key file (`chmod 600`) |
| `DISTILL_MAINNET` | unset (Base Sepolia only) | `1` lets the client pay on Base mainnet |
| `DISTILL_MAX_USD` | `0.05` | The most one call may cost |
| `BASE_RPC_URL` | the scheme's default | An RPC for the paying network (TypeScript) |
| `DISTILL_MCP_URL` | `https://data.spencermcw.com/mcp?via=examples` | The endpoint `mcp/check.ts` talks to |

## Privacy

- The examples send the User-Agent `distill-examples/0.1`. The MCP configs use `?via=examples`.
  Distill reduces both to coarse counters of where its traffic comes from. It stores no raw IPs or
  payer addresses (only salted hashes) and logs no request bodies.
- The sanctions recipe sends the address you check, and Distill does not store it.

## Links

- Landing page: <https://data.spencermcw.com>
- `llms.txt`: <https://data.spencermcw.com/llms.txt> (and `llms-full.txt` with every schema)
- OpenAPI 3.1: <https://data.spencermcw.com/openapi.json>
- MCP: `https://data.spencermcw.com/mcp` (streamable HTTP), listed as `com.spencermcw.data/distill`
  in the official MCP registry
- Terms: <https://data.spencermcw.com/terms>

MIT licensed. See `LICENSE`.
