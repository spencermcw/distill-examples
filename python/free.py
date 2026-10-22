"""The free tier from Python, standard library only: no wallet, no key, no signup.

    python3 free.py [zip]
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://data.spencermcw.com"
USER_AGENT = "distill-examples/0.1 (+https://data.spencermcw.com)"


def ask(path: str, params: dict) -> dict:
    url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        url,
        headers={"Distill-Free-Tier": "use", "User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 402:
            sys.exit("Free calls for today are used up (UTC). Pay per call with paid.py, or come back tomorrow.")
        body = json.load(error)
        sys.exit(f"Distill answered {error.code}: {body.get('error', {}).get('message')}")


if __name__ == "__main__":
    zip_code = sys.argv[1] if len(sys.argv) > 1 else "98101-3143"
    answer = ask("/v1/tax/sales-rate", {"zip": zip_code})
    data = answer["data"]
    print(f"Combined sales tax rate at {zip_code} ({data['state']}, matched by {data['matched']}): {data['rate']}")
    for c in data["components"]:
        print(f"  {c['type_name']:<28} {c['general']['intrastate']}")
    publishers = ", ".join(sorted({s["publisher"] for s in answer["sources"]}))
    print(f"{answer['method_version']} · as of {answer['as_of']} · confidence {answer['confidence']} · sources: {publishers}")
