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
- x402 v1 and v2 price fields, including `accepts[]` and `schemes[]` challenge arrays
- MPP `WWW-Authenticate: Payment` and x402 V2 `WWW-Authenticate: X402 requirements=...` challenges
- Atomic-unit `amount` / `maxAmountRequired` fields, plus legacy decimal `amount` + `token` x402 v1 challenges
- `asset` or token metadata, `network`, and `payTo`
- OpenAPI-declared `x-payment-info.price.amount` drift versus the live 402 challenge price
- Placeholder recipients such as zero addresses and Solana system-program values
- Testnet or staging rails such as Base Sepolia and Solana devnet
- HTTPS resource URLs and stable resource metadata
- Browser CORS allowance for `X-PAYMENT`
- Over-broad public method surfaces
- Auth, validation, and free/trial responses that appear before a payment challenge, without piling on missing-field findings when no challenge was actually returned
- Operational health/status endpoints, without treating expected free health checks as paid-route failures
- Object-valued document metadata such as facilitator objects, without `[object Object]` report artifacts

## Public Proof

Recent public no-payment checks have found and verified real launch fixes:

- TensorFeed: parameter-required premium routes moved behind canonical x402 V2 challenges, then verified clean. https://github.com/solana-foundation/pay-skills/pull/68#issuecomment-4455360068
- x402jp: weather routes that returned 500 now return structured Base x402 challenges. https://github.com/solana-foundation/pay-skills/pull/58#issuecomment-4455401355
- Spraay: resource echo and browser payment-header behavior verified clean. https://github.com/solana-foundation/pay-skills/pull/60#issuecomment-4455519760
- UZPROOF: schemes-style Solana x402 challenge and browser payment-header behavior verified clean. https://github.com/solana-foundation/pay-skills/pull/28#issuecomment-4455613892
- HYRE Agent: OpenAPI-declared prices found 10x below live 402 challenge prices. https://github.com/solana-foundation/pay-skills/pull/19#issuecomment-4455641258
- Agent Trust Bench: live discovery URL and browser-compatibility notes for adversarial agent-payment resources. https://github.com/solana-foundation/pay-skills/pull/23#issuecomment-4455484414

Field notes and browser version: https://tateprograms.com/x402-surface-check.html

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
