import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { strict as assert } from 'node:assert'

const execFileAsync = promisify(execFile)

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type,x-payment')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    response.end()
    return
  }

  if (request.url === '/openapi.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Fixture', version: '1.0.0' },
      servers: [{ url: serverUrl }],
      paths: {
        '/health': {
          get: {
            operationId: 'healthCheck',
          },
        },
        '/score/{wallet}': {
          get: {
            operationId: 'getScore',
            'x-payment-info': {
              price: { mode: 'fixed', currency: 'USD', amount: '0.001' },
            },
            parameters: [
              { name: 'wallet', in: 'path', required: true, schema: { type: 'string' } },
            ],
          },
        },
      },
    }))
    return
  }

  if (request.url === '/mismatch-openapi.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Mismatch Fixture', version: '1.0.0' },
      servers: [{ url: serverUrl }],
      paths: {
        '/price-mismatch': {
          get: {
            operationId: 'priceMismatch',
            'x-payment-info': {
              price: { mode: 'fixed', currency: 'USD', amount: '0.002' },
            },
          },
        },
      },
    }))
    return
  }

  if (request.url === '/x402.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      x402Version: 1,
      endpoints: [{
        path: '/api/weather/tokyo',
        method: 'GET',
        description: 'Tokyo weather data',
        accepts: [{
          scheme: 'exact',
          network: 'base-sepolia',
          maxAmountRequired: '1000',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          payTo: '0x9C394847074aF408470e607e062C838a3Cce1240',
        }],
      }],
    }))
    return
  }

  if (request.url === '/items.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      x402Version: 2,
      facilitator: {
        operator: 'Fixture Facilitator',
        url: 'https://facilitator.example',
        jurisdiction: 'US',
      },
      payment: {
        network: 'eip155:8453',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        wallet: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
      },
      items: [{
        resource: '/api/premium/routing',
        type: 'http',
        method: 'GET',
        metadata: { name: 'Premium routing recommendations' },
      }],
    }))
    return
  }

  if (request.url === '/health') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true }))
    return
  }

  if (request.url === '/score/%7Bwallet%7D') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'solana',
        maxAmountRequired: '1000',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
        resource: 'https://fixture.example/score/%7Bwallet%7D',
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/api/weather/tokyo') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'base-sepolia',
        maxAmountRequired: '1000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0x9C394847074aF408470e607e062C838a3Cce1240',
        resource: `${serverUrl}/api/weather/tokyo`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/api/premium/routing') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '20000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}/api/premium/routing`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/price-mismatch') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'solana',
        maxAmountRequired: '1000',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
        resource: `${serverUrl}/price-mismatch`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/mpp/eth') {
    const mppRequest = Buffer.from(JSON.stringify({
      amount: '1000',
      currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      description: 'JSON-RPC for eth chain',
      methodDetails: { decimals: 6, network: 'mainnet' },
      recipient: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
    })).toString('base64url')
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('www-authenticate', `Payment method="solana", request="${mppRequest}", expires="2026-05-13T23:58:44Z"`)
    response.end(JSON.stringify({ error: 'payment_required', payment: { protocol: 'mpp' } }))
    return
  }

  if (request.url === '/x402v2/header') {
    const requirements = Buffer.from(JSON.stringify({
      x402Version: 2,
      error: 'payment_required',
      resource: {
        url: `${serverUrl}/x402v2/header`,
        description: 'Header-only x402 V2 fixture',
        mimeType: 'application/json',
      },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '20000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        maxTimeoutSeconds: 60,
      }],
    })).toString('base64url')
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('www-authenticate', `X402 requirements="${requirements}"`)
    response.end(JSON.stringify({ error: 'payment_required' }))
    return
  }

  if (request.url === '/legacy/v1') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('x-402-version', '1.0')
    response.setHeader('x-payment-amount', '10.0')
    response.setHeader('x-payment-token', 'USDC')
    response.setHeader('x-payment-networks', 'base-mainnet,solana-mainnet')
    response.end(JSON.stringify({
      error: 'Payment Required',
      x402_version: '1.0',
      accepts: [{
        scheme: 'exact',
        network: 'base-mainnet',
        token: 'USDC',
        amount: '10.0',
        payTo: '0x1aabd080c594cfc7aae5c0d8200948353de87ba1',
        description: 'Pay 10.0 USDC on Base mainnet for /legacy/v1',
      }, {
        scheme: 'exact',
        network: 'solana-mainnet',
        token: 'USDC',
        amount: '10.0',
        payTo: 'F1p61Q2EQfy2G4rsK8FQNdStDCS347cBBq8xb4s9E6p3',
        description: 'Pay 10.0 USDC on Solana mainnet for /legacy/v1',
      }],
    }))
    return
  }

  if (request.url === '/schemes/v2') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('x-payment-required', 'true')
    response.end(JSON.stringify({
      x402Version: 2,
      schemes: [{
        scheme: 'exact',
        network: 'solana-mainnet',
        maxAmountRequired: '0.05',
        token: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo: '5iYccm6tcJjvhX8Wdp3hMWnTcBRsN2cfgS3XdGHsehty',
        resource: `${serverUrl}/schemes/v2`,
      }],
    }))
    return
  }

  if (request.url === '/needs-param') {
    response.statusCode = 400
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ error: 'missing date parameter' }))
    return
  }

  if (request.url === '/free-trial') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, tier: 'trial' }))
    return
  }

  response.statusCode = 404
  response.end('not found')
})

let serverUrl = ''

await new Promise(resolve => {
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    serverUrl = `http://127.0.0.1:${port}`
    resolve()
  })
})

try {
  const { stdout } = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/openapi.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(stdout, /OpenAPI/)
  assert.match(stdout, /getScore/)
  assert.match(stdout, /\$0\.001/)
  assert.match(stdout, /No obvious launch-readiness findings/)
  assert.doesNotMatch(stdout, /healthCheck returned 200 without a payment challenge/)
  assert.doesNotMatch(stdout, /healthCheck CORS preflight/)

  const mismatch = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/mismatch-openapi.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(mismatch.stdout, /priceMismatch/)
  assert.match(mismatch.stdout, /documented price \$0\.002 does not match live 402 challenge price \$0\.001/)

  const manifest = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/x402.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(manifest.stdout, /x402 manifest/)
  assert.match(manifest.stdout, /tokyo/)
  assert.match(manifest.stdout, /\$0\.001/)
  assert.match(manifest.stdout, /base-sepolia/)

  const itemsManifest = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/items.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(itemsManifest.stdout, /Premium routing recommendations/)
  assert.match(itemsManifest.stdout, /\$0\.02/)
  assert.match(itemsManifest.stdout, /eip155:8453/)
  assert.match(itemsManifest.stdout, /Fixture Facilitator \/ https:\/\/facilitator\.example \/ US/)
  assert.doesNotMatch(itemsManifest.stdout, /\[object Object\]/)

  const mpp = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    `${serverUrl}/mpp/eth`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(mpp.stdout, /direct endpoint/)
  assert.match(mpp.stdout, /mpp/)
  assert.match(mpp.stdout, /mainnet/)
  assert.match(mpp.stdout, /\$0\.001/)

  const x402Header = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'GET',
    `${serverUrl}/x402v2/header`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(x402Header.stdout, /direct endpoint/)
  assert.match(x402Header.stdout, /x402/)
  assert.match(x402Header.stdout, /eip155:8453/)
  assert.match(x402Header.stdout, /\$0\.02/)

  const legacy = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    `${serverUrl}/legacy/v1`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(legacy.stdout, /direct endpoint/)
  assert.match(legacy.stdout, /base-mainnet/)
  assert.match(legacy.stdout, /\$10\.00/)
  assert.doesNotMatch(legacy.stdout, /\$0\.00001/)
  assert.doesNotMatch(legacy.stdout, /challenge is missing amount/)

  const schemes = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    `${serverUrl}/schemes/v2`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(schemes.stdout, /solana-mainnet/)
  assert.match(schemes.stdout, /\$0\.05/)
  assert.doesNotMatch(schemes.stdout, /\$0\.000/)
  assert.doesNotMatch(schemes.stdout, /challenge is missing amount/)

  const needsParam = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'GET',
    `${serverUrl}/needs-param`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(needsParam.stdout, /validation HTTP 400 before a payment challenge/)
  assert.doesNotMatch(needsParam.stdout, /challenge is missing amount/)
  assert.doesNotMatch(needsParam.stdout, /does not repeat the resource URL/)
  assert.doesNotMatch(needsParam.stdout, /\$0\.000/)
  assert.doesNotMatch(needsParam.stdout, /\| needs-param \| GET \| 400 \| x402 \|/)

  const freeTrial = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'GET',
    `${serverUrl}/free-trial`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(freeTrial.stdout, /returned 200 without a payment challenge/)
  assert.doesNotMatch(freeTrial.stdout, /challenge is missing amount/)
  assert.doesNotMatch(freeTrial.stdout, /\$0\.000/)
  assert.doesNotMatch(freeTrial.stdout, /\| free-trial \| GET \| 200 \| x402 \|/)
}
finally {
  await new Promise(resolve => server.close(resolve))
}
