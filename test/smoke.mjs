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
        '/score/{wallet}': {
          get: {
            operationId: 'getScore',
            parameters: [
              { name: 'wallet', in: 'path', required: true, schema: { type: 'string' } },
            ],
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
}
finally {
  await new Promise(resolve => server.close(resolve))
}
