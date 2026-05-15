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

- Manifest endpoint discovery from `items[]`, `endpoints[]`, `resources[]`, `x402Endpoints`, category arrays, resource strings, and OpenAPI paths
- Linked discovery documents via `discovery_url`, `discoveryUrl`, `resources_url`, `resourcesUrl`, or manifest-level OpenAPI links
- OpenAPI `servers[]` base-path preservation, so `/paths` are probed through the documented gateway rather than the domain root
- OpenAPI query/path examples and JSON request-body examples for safer no-payment probes
- No-payment HTTP 402 challenge shape
- x402 v1 and v2 price fields, including `accepts[]` and `schemes[]` challenge arrays
- MPP `WWW-Authenticate: Payment` and x402 V2 `WWW-Authenticate: X402 requirements=...` challenges
- Atomic-unit `amount` / `maxAmountRequired` fields, plus legacy decimal `amount` + `token` x402 v1 challenges
- `asset` or token metadata, `network`, and `payTo`
- OpenAPI-declared `x-payment-info.price.amount` drift versus the live 402 challenge price
- Placeholder recipients such as zero addresses and Solana system-program values
- Testnet or staging rails such as Base Sepolia and Solana devnet
- HTTPS resource URLs and stable resource metadata
- Browser CORS allowance for the requesting origin and `X-PAYMENT`, including the actual 402 challenge response
- Over-broad public method surfaces
- Auth, validation, and free/trial responses that appear before a payment challenge, without piling on missing-field findings when no challenge was actually returned
- Operational health/status endpoints, without treating expected free health checks as paid-route failures
- Object-valued document metadata such as facilitator or network objects, without `[object Object]` report artifacts

## Public Proof

Recent public no-payment checks have found and verified real launch fixes:

- TensorFeed: parameter-required premium routes moved behind canonical x402 V2 challenges, then verified clean. https://github.com/solana-foundation/pay-skills/pull/68#issuecomment-4455360068
- x402jp: weather routes that returned 500 now return structured Base x402 challenges. https://github.com/solana-foundation/pay-skills/pull/58#issuecomment-4455401355
- Spraay: resource echo and browser payment-header behavior verified clean. https://github.com/solana-foundation/pay-skills/pull/60#issuecomment-4455519760
- UZPROOF: schemes-style Solana x402 challenge and browser payment-header behavior verified clean. https://github.com/solana-foundation/pay-skills/pull/28#issuecomment-4455613892
- HYRE Agent: OpenAPI-declared prices found 10x below live 402 challenge prices. https://github.com/solana-foundation/pay-skills/pull/19#issuecomment-4455641258
- anchor-x402: multi-rail x402 challenges verified, with browser preflight blockers isolated before merge. https://github.com/solana-foundation/pay-skills/pull/47#issuecomment-4455678163
- Agent Trust Bench: linked discovery URL and browser-compatibility notes verified clean for adversarial agent-payment resources. https://github.com/solana-foundation/pay-skills/pull/23#issuecomment-4455722170
- Solrouter: private LLM inference route verified with HTTPS resource-binding and price-alignment notes. https://github.com/solana-foundation/pay-skills/pull/39#issuecomment-4455800060
- Tetrac: Solana market-data payment gates verified, with browser payment-header preflight blocker isolated. https://github.com/solana-foundation/pay-skills/pull/32#issuecomment-4455923744

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
