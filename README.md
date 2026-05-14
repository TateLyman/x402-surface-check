# x402 Surface Check

No-payment CLI for checking x402 launch surfaces before a real agent spends.

It accepts an x402 manifest or OpenAPI URL, derives public endpoints, sends no-payment probes, checks browser preflight behavior, and returns a Markdown patch queue. It never sends `X-PAYMENT`, never signs, and never attempts a paid call.

npm: https://www.npmjs.com/package/x402-surface-check

```bash
npx --yes x402-surface-check https://api.example.com/.well-known/x402
npx --yes x402-surface-check https://api.example.com/openapi.json report.md
npx --yes x402-surface-check --endpoint --method POST https://x402.rpc.ankr.com/eth
```

## What It Checks

- Manifest endpoint discovery from `items[]`, `endpoints[]`, `x402Endpoints`, category arrays, resource strings, and OpenAPI paths
- No-payment HTTP 402 challenge shape
- x402 v1 and v2 price fields
- MPP `WWW-Authenticate: Payment` and x402 V2 `WWW-Authenticate: X402 requirements=...` challenges
- `amount` / `maxAmountRequired`, `asset`, `network`, and `payTo`
- Placeholder recipients such as zero addresses and Solana system-program values
- Testnet or staging rails such as Base Sepolia and Solana devnet
- HTTPS resource URLs and stable resource metadata
- Browser CORS allowance for `X-PAYMENT`
- Over-broad public method surfaces

## Options

```bash
x402-surface-check <manifest-or-openapi-url> [output.md]
x402-surface-check --endpoint --method POST <paid-endpoint-url> [output.md]

--endpoint       Treat the URL as one paid endpoint instead of a discovery document
--method <verb>  HTTP method for direct endpoint mode, default POST
--origin <url>   Origin to use for browser-style CORS preflight
--limit <n>      Maximum endpoints to probe, default 6
--json           Print JSON instead of Markdown
--help           Show usage
--version        Show package version
```

Environment variables are also supported:

```bash
X402_CHECK_ORIGIN=https://example.com x402-surface-check https://api.example.com/openapi.json
X402_CHECK_LIMIT=12 x402-surface-check https://api.example.com/.well-known/x402
```

## Scope

The checker is intentionally external and conservative:

- no wallet access
- no payment headers
- no paid calls
- no exploit attempts
- no private endpoint guessing

It is meant for launch-readiness review, spend-policy evidence, and pre-demo patch order.

## Web Version

Browser tool: https://tateprograms.com/x402-surface-check.html
