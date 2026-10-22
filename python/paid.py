"""A paid call over x402 from Python, with the x402 package's httpx client.

    DISTILL_KEY_FILE=~/.config/distill-examples/buyer.key python paid.py [zip]

The client registers one network only: Base Sepolia (testnet) unless DISTILL_MAINNET=1, and it
refuses any payment above DISTILL_MAX_USD (default 0.05) for one call. data.spencermcw.com accepts
Base mainnet only, so against it this needs DISTILL_MAINNET=1 and spends real USDC ($0.005 here);
point DISTILL_URL at a testnet gateway to try it without real money.
"""

import asyncio
import os
import stat
import sys
from decimal import Decimal

from eth_account import Account
from x402 import max_amount, x402Client
from x402.http.clients import wrapHttpxWithPayment
from x402.mechanisms.evm.exact import ExactEvmScheme

BASE_URL = os.environ.get("DISTILL_URL", "https://data.spencermcw.com").rstrip("/")
USER_AGENT = "distill-examples/0.1 (+https://data.spencermcw.com)"
NETWORK = "eip155:8453" if os.environ.get("DISTILL_MAINNET") == "1" else "eip155:84532"
MAX_ATOMIC = int(Decimal(os.environ.get("DISTILL_MAX_USD", "0.05")) * 1_000_000)


def load_account():
    path = os.environ.get("DISTILL_KEY_FILE")
    if not path:
        sys.exit("Set DISTILL_KEY_FILE to a chmod-600 file holding a buyer key (see README).")
    if os.stat(path).st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        sys.exit(f"{path} must be chmod 600")
    with open(path) as f:
        return Account.from_key(f.read().strip())


async def main() -> None:
    account = load_account()
    if NETWORK == "eip155:8453":
        print(f"[distill-examples] paying on Base MAINNET with {account.address}", file=sys.stderr)
    client = x402Client()
    client.register(NETWORK, ExactEvmScheme(account))
    client.register_policy(max_amount(MAX_ATOMIC))
    client.register_policy(lambda _v, reqs: [r for r in reqs if r.network == NETWORK])
    zip_code = sys.argv[1] if len(sys.argv) > 1 else "98101-3143"
    async with wrapHttpxWithPayment(client, headers={"User-Agent": USER_AGENT}, timeout=60) as http:
        response = await http.get(f"{BASE_URL}/v1/tax/sales-rate", params={"zip": zip_code})
    if response.status_code != 200:
        sys.exit(f"HTTP {response.status_code}: {response.text[:300]}")
    answer = response.json()
    print(f"Combined rate at {zip_code}: {answer['data']['rate']}")
    print(f"{answer['method_version']} · paid {answer['price_paid']['amount']} USDC · tx {answer['price_paid']['tx']}")


if __name__ == "__main__":
    asyncio.run(main())
