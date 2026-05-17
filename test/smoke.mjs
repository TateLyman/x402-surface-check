import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { strict as assert } from 'node:assert'

const execFileAsync = promisify(execFile)

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS' && (request.url === '/no-origin' || request.url === '/no-origin-2')) {
    response.statusCode = 204
    response.setHeader('access-control-allow-headers', 'content-type,x-payment')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    response.end()
    return
  }

  if (request.method === 'OPTIONS' && request.url === '/header-enforced-free') {
    response.statusCode = 204
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'Content-Type, Authorization, X-Client-ID')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    response.end()
    return
  }

  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type,x-payment')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    response.end()
    return
  }

  if (request.url === '/streamable-mcp' && request.method === 'GET') {
    response.statusCode = 405
    response.setHeader('content-type', 'application/json')
    response.setHeader('allow', 'POST,GET,HEAD,DELETE')
    response.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'SSE not supported in stateless mode. Use POST.',
      },
      id: null,
    }))
    return
  }

  if (request.url === '/streamable-mcp' && request.method === 'POST') {
    response.statusCode = 200
    response.setHeader('content-type', 'text/event-stream')
    response.setHeader('cache-control', 'no-cache')
    response.end(`event: message
data: ${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          {
            name: 'paid_search',
            description: 'Real-time web search. $0.01 per call.',
            inputSchema: { type: 'object' },
          },
          {
            name: 'wallet_status',
            description: 'Check local wallet balance. Free.',
            inputSchema: { type: 'object' },
          },
        ],
      },
    })}

`)
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

  if (request.url === '/examples-openapi.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Examples Fixture', version: '1.0.0' },
      servers: [{ url: serverUrl }],
      paths: {
        '/brands': {
          get: {
            operationId: 'listBrandsWithExample',
            parameters: [{
              name: 'country_code',
              in: 'query',
              required: true,
              schema: { type: 'string', example: 'us' },
            }],
          },
        },
        '/orders': {
          post: {
            operationId: 'createOrderWithExample',
            requestBody: {
              content: {
                'application/json': {
                  example: {
                    email: 'agent@example.com',
                    items: [{ product_id: 'sku_123', product_value: 25 }],
                  },
                },
              },
            },
          },
        },
        '/chat': {
          post: {
            operationId: 'createChatWithSchema',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['model', 'messages'],
                    properties: {
                      model: { type: 'string', enum: ['fixture-model'] },
                      messages: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['role', 'content'],
                          properties: {
                            role: { type: 'string', enum: ['user'] },
                            content: { type: 'string', minLength: 1 },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }))
    return
  }

  if (request.url === '/gateway/openapi.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Gateway Fixture', version: '1.0.0' },
      servers: [{ url: `${serverUrl}/gateway` }],
      paths: {
        '/pay/v1/protected': {
          get: {
            operationId: 'protectedByGatewayBasePath',
            'x-payment-info': {
              price: { mode: 'fixed', currency: 'USD', amount: '0.003' },
            },
          },
        },
      },
    }))
    return
  }

  if (request.url === '/mixed-openapi.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Mixed Fixture', version: '1.0.0' },
      servers: [{ url: serverUrl }],
      paths: {
        '/docs': {
          get: {
            operationId: 'docsLanding',
            responses: { 200: { description: 'Public docs' } },
          },
        },
        '/paid': {
          post: {
            operationId: 'paidOperation',
            'x-payment-info': {
              price: { mode: 'fixed', currency: 'USD', amount: '0.004' },
            },
            responses: { 402: { description: 'Payment required' } },
          },
        },
      },
    }))
    return
  }

  if (request.url === '/ref-openapi.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Ref Fixture', version: '1.0.0' },
      servers: [{ url: serverUrl }],
      paths: {
        '/ref-paid': {
          post: {
            operationId: 'paidWithRefBody',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/RefPaidRequest' },
                },
              },
            },
            responses: { 402: { description: 'Payment required' } },
          },
        },
      },
      components: {
        schemas: {
          RefPaidRequest: {
            type: 'object',
            required: ['target', 'tier', 'count'],
            properties: {
              target: { type: 'string', format: 'uri' },
              tier: { type: 'string', enum: ['quick', 'deep'] },
              count: { type: 'integer', minimum: 1 },
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

  if (request.url === '/no-origin-list.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      x402Version: 2,
      endpoints: [{
        path: '/no-origin',
        method: 'GET',
        description: 'No CORS fixture one',
      }, {
        path: '/no-origin-2',
        method: 'GET',
        description: 'No CORS fixture two',
      }],
    }))
    return
  }

  if (request.url === '/well-known.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      name: 'Linked Discovery Fixture',
      discovery_url: `${serverUrl}/items.json`,
    }))
    return
  }

  if (request.url === '/nested-discovery.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      name: 'Nested Discovery Fixture',
      discovery: {
        x402_json: '/items.json',
        openapi: '/unused-openapi.json',
      },
    }))
    return
  }

  if (request.url === '/string-endpoints.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      name: 'String Endpoint Fixture',
      endpoints: {
        '/string-paid': '$0.04 USDC -- string-valued endpoint metadata',
        'POST /string-post': '$0.08 USDC -- method-prefixed endpoint metadata',
      },
      tools: {
        '/tool-paid': {
          method: 'GET',
          price: '$0.02',
          description: 'Tool map endpoint metadata',
        },
      },
    }))
    return
  }

  if (request.url === '/tool-name-array.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      name: 'MCP Tool Name Fixture',
      endpoint: '/mcp',
      tools: [
        'get_manifest',
        'get_quote',
        'settle',
      ],
    }))
    return
  }

  if (request.url === '/route-catalog.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      object: 'route_catalog',
      service: 'Route Catalog Fixture',
      accepts: [{ scheme: 'exact', network: 'eip155:8453' }],
      routes: [
        {
          path: '/route-paid',
          reportType: 'route_paid',
          priceUsd: '$0.03',
          exampleCalls: [{ method: 'GET', url: '/route-paid?category=coffee' }],
        },
        {
          path: '/route-post',
          agentName: 'Route Post',
          priceUsd: '$0.07',
          method: 'POST',
          requestBody: {
            example: { id: 'safe-route-fixture' },
          },
        },
      ],
    }))
    return
  }

  if (request.url === '/resources.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      x402Version: 2,
      resources: [{
        path: '/api/premium/routing',
        url: `${serverUrl}/api/premium/routing`,
        method: 'GET',
        description: 'Premium routing resource object',
        accepts: [{
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '20000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        }],
      }, `${serverUrl}/api/raw-resource`],
    }))
    return
  }

  if (request.url === '/string-paid' || request.url === '/string-post' || request.url === '/tool-paid') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        maxAmountRequired: request.url === '/string-post' ? '80000' : request.url === '/tool-paid' ? '20000' : '40000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}${request.url}`,
      }],
    }))
    return
  }

  if (request.url === '/registry-leak.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      name: 'Agent Marketplace Fixture',
      services: [{
        id: 'svc_token_query',
        name: 'Tokenized endpoint',
        endpoint: `${serverUrl}/api/provider?token=abc123abc123abc123abc123&surface=demo`,
      }, {
        id: 'svc_userinfo',
        name: 'Userinfo endpoint',
        endpoint: 'https://user:pass@example.com/api/provider',
      }],
    }))
    return
  }

  if (request.url === '/object-endpoints.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      version: '1.0',
      service: {
        name: 'Object Endpoint Fixture',
        url: serverUrl,
      },
      networks: [{ id: 'base', network: 'eip155:8453' }],
      endpoints: {
        brandsObject: {
          method: 'GET',
          path: '/object/brands',
          description: 'Discover public brands before checkout.',
          parameters: {
            country_code: { type: 'string', required: true, example: 'us' },
          },
        },
        catalogObject: {
          method: 'GET',
          path: '/object/catalog',
          description: 'Get public catalog products before checkout.',
          parameters: {
            country_code: { type: 'string', required: true, example: 'us' },
            brand_name: { type: 'string', required: false, example: 'Example Store' },
          },
        },
        createOrderObject: {
          method: 'POST',
          path: '/object/order',
          description: 'Two-phase endpoint. First call returns 402 PAYMENT-REQUIRED.',
          request_body: {
            example: {
              email: 'agent@example.com',
              items: [{ product_id: 'sku_123', beneficiary_account: 'recipient@example.com' }],
            },
          },
          phase1_response: {
            status: 402,
            header: 'PAYMENT-REQUIRED',
          },
        },
        getOrderObject: {
          method: 'GET',
          path: '/object/orders/{order_id}',
          description: 'Poll after a paid order exists.',
        },
      },
    }))
    return
  }

  if (request.url === '/openapi-link.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      name: 'Linked OpenAPI Fixture',
      openapi: `${serverUrl}/examples-openapi.json`,
      networks: [{
        id: 'solana',
        network: 'solana-mainnet',
        asset: 'USDC',
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

  if (request.url?.startsWith('/route-paid')) {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: `${serverUrl}${request.url}` },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '30000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}${request.url}`,
      }],
    }))
    return
  }

  if (request.url === '/route-post') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: `${serverUrl}/route-post` },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '70000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}/route-post`,
      }],
    }))
    return
  }

  if (request.url === '/api/raw-resource') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '30000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}/api/raw-resource`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/object/brands?country_code=us') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([{ brand_name: 'Example Store' }]))
    return
  }

  if (request.url === '/object/catalog?country_code=us&brand_name=Example+Store') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([{ product_id: 'sku_123', price_usdc: '0.02' }]))
    return
  }

  if (request.url === '/object/order') {
    let body = ''
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      if (parsed.email !== 'agent@example.com' || parsed.items?.[0]?.product_id !== 'sku_123') {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'missing object endpoint body example' }))
        return
      }
      response.statusCode = 402
      response.setHeader('content-type', 'application/json')
      response.setHeader('access-control-allow-origin', '*')
      response.end(JSON.stringify({
        x402Version: 2,
        error: 'Payment required',
        resource: { url: `${serverUrl}/object/order` },
        accepts: [{
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '20000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
          resource: `${serverUrl}/object/order`,
          extra: { resource: `${serverUrl}/object/order` },
        }],
      }))
    })
    return
  }

  if (request.url === '/gateway/pay/v1/protected') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'solana',
        maxAmountRequired: '3000',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
        resource: `${serverUrl}/gateway/pay/v1/protected`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/paid') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'solana',
        maxAmountRequired: '4000',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
        resource: `${serverUrl}/paid`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/body-required') {
    let body = ''
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      if (parsed.prompt !== 'price CPI') {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'missing body prompt' }))
        return
      }
      response.statusCode = 402
      response.setHeader('content-type', 'application/json')
      response.setHeader('access-control-allow-origin', '*')
      response.end(JSON.stringify({
        x402Version: 1,
        error: 'Payment required',
        accepts: [{
          scheme: 'exact',
          network: 'solana',
          maxAmountRequired: '7000',
          asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
          resource: `${serverUrl}/body-required`,
          maxTimeoutSeconds: 60,
        }],
      }))
    })
    return
  }

  if (request.url === '/proofed-order') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: `${serverUrl}/proofed-order` },
      extensions: {
        'payment-identifier': { required: false },
        'offer-receipt': { format: 'jws', includeTxHash: false },
      },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '20000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}/proofed-order`,
        maxTimeoutSeconds: 60,
      }],
    }))
    return
  }

  if (request.url === '/ref-paid') {
    let body = ''
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      if (parsed.target !== 'https://example.com' || parsed.tier !== 'quick' || parsed.count !== 1) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'missing ref body example' }))
        return
      }
      response.statusCode = 402
      response.setHeader('content-type', 'application/json')
      response.setHeader('access-control-allow-origin', '*')
      response.end(JSON.stringify({
        x402Version: 1,
        error: 'Payment required',
        accepts: [{
          scheme: 'exact',
          network: 'solana',
          maxAmountRequired: '6000',
          asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
          resource: `${serverUrl}/ref-paid`,
          maxTimeoutSeconds: 60,
        }],
      }))
    })
    return
  }

  if (request.url === '/pay/v1/protected') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, route: 'unguarded-root' }))
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

  if (request.url === '/brands?country_code=us') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, brands: ['Example'] }))
    return
  }

  if (request.url === '/orders') {
    let body = ''
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      if (parsed.email !== 'agent@example.com' || !Array.isArray(parsed.items)) {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'missing order example' }))
        return
      }
      response.statusCode = 402
      response.setHeader('content-type', 'application/json')
      response.setHeader('access-control-allow-origin', '*')
      response.end(JSON.stringify({
        x402Version: 1,
        error: 'Payment required',
        accepts: [{
          scheme: 'exact',
          network: 'solana',
          maxAmountRequired: '25000',
          asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
          resource: `${serverUrl}/orders`,
          maxTimeoutSeconds: 60,
        }],
      }))
    })
    return
  }

  if (request.url === '/chat') {
    let body = ''
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      if (parsed.model !== 'fixture-model' || parsed.messages?.[0]?.content !== 'example') {
        response.statusCode = 400
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ error: 'missing nested chat body' }))
        return
      }
      response.statusCode = 402
      response.setHeader('content-type', 'application/json')
      response.setHeader('access-control-allow-origin', '*')
      response.end(JSON.stringify({
        x402Version: 1,
        error: 'Payment required',
        accepts: [{
          scheme: 'exact',
          network: 'solana',
          maxAmountRequired: '9000',
          asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          payTo: '2Ynf2xxaiLbPy9p8iWE5ZiUd1wojJ45pRwCEN3mgK8aE',
          resource: `${serverUrl}/chat`,
          maxTimeoutSeconds: 60,
        }],
      }))
    })
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

  if (request.url === '/no-origin') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: `${serverUrl}/no-origin` },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '20000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
      }],
    }))
    return
  }

  if (request.url === '/no-origin-2') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: `${serverUrl}/no-origin-2` },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '20000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
      }],
    }))
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

  if (request.url === '/cacheable') {
    response.statusCode = 402
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('cache-control', 'public, max-age=300')
    response.end(JSON.stringify({
      x402Version: 2,
      error: 'Payment required',
      resource: { url: `${serverUrl}/cacheable` },
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '20000',
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        payTo: '0x549c82e6bfc54bdae9a2073744cbc2af5d1fc6d1',
        resource: `${serverUrl}/cacheable`,
        extra: { resource: `${serverUrl}/cacheable` },
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

  if (request.url === '/header-enforced-free') {
    response.statusCode = 200
    response.setHeader('content-type', 'application/json')
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('x-payment-required', 'true')
    response.setHeader('x-payment-enforce', 'true')
    response.setHeader('x-price-usdc', '0.001')
    response.setHeader('x-payment-protocol', 'x402')
    response.end(JSON.stringify({ ok: true, billed: false }))
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

  const examples = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/examples-openapi.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(examples.stdout, /listBrandsWithExample/)
  assert.match(examples.stdout, /createOrderWithExample/)
  assert.match(examples.stdout, /createChatWithSchema/)
  assert.match(examples.stdout, /\$0\.025/)
  assert.match(examples.stdout, /\$0\.009/)
  assert.doesNotMatch(examples.stdout, /listBrandsWithExample returned validation HTTP 400/)
  assert.doesNotMatch(examples.stdout, /createOrderWithExample returned validation HTTP 400/)
  assert.doesNotMatch(examples.stdout, /createChatWithSchema returned validation HTTP 400/)

  const gatewayBasePath = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/gateway/openapi.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(gatewayBasePath.stdout, /protectedByGatewayBasePath/)
  assert.match(gatewayBasePath.stdout, new RegExp(`${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/gateway\\/pay\\/v1\\/protected`))
  assert.match(gatewayBasePath.stdout, /\$0\.003/)
  assert.doesNotMatch(gatewayBasePath.stdout, /protectedByGatewayBasePath returned 200 without a payment challenge/)
  assert.doesNotMatch(gatewayBasePath.stdout, /unguarded-root/)

  const paidFirst = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/mixed-openapi.json`,
    '--limit',
    '1',
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(paidFirst.stdout, /paidOperation/)
  assert.match(paidFirst.stdout, /\$0\.004/)
  assert.doesNotMatch(paidFirst.stdout, /docsLanding/)
  assert.doesNotMatch(paidFirst.stdout, /returned 200 without a payment challenge/)

  const refBody = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/ref-openapi.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(refBody.stdout, /paidWithRefBody/)
  assert.match(refBody.stdout, /\$0\.006/)
  assert.doesNotMatch(refBody.stdout, /validation HTTP 400/)

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

  const resourceManifest = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/resources.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(resourceManifest.stdout, /premium\/routing/)
  assert.match(resourceManifest.stdout, /raw-resource/)
  assert.match(resourceManifest.stdout, /\$0\.02/)
  assert.match(resourceManifest.stdout, /\$0\.03/)
  assert.match(resourceManifest.stdout, /eip155:8453/)
  assert.doesNotMatch(resourceManifest.stdout, /Document does not expose/)

  const registryLeak = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/registry-leak.json`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(registryLeak.stdout, /credential-like URL material/)
  assert.match(registryLeak.stdout, /token=REDACTED&surface=demo/)
  assert.match(registryLeak.stdout, /https:\/\/REDACTED:REDACTED@example\.com\/api\/provider/)
  assert.doesNotMatch(registryLeak.stdout, /abc123abc123abc123abc123/)
  assert.doesNotMatch(registryLeak.stdout, /user:pass@example/)

  const objectEndpoints = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/object-endpoints.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(objectEndpoints.stdout, /brandsObject/)
  assert.match(objectEndpoints.stdout, /catalogObject/)
  assert.match(objectEndpoints.stdout, /createOrderObject/)
  assert.match(objectEndpoints.stdout, /Probed endpoints: 3/)
  assert.match(objectEndpoints.stdout, /\$0\.02/)
  assert.doesNotMatch(objectEndpoints.stdout, /getOrderObject/)
  assert.doesNotMatch(objectEndpoints.stdout, /Document does not expose/)
  assert.doesNotMatch(objectEndpoints.stdout, /brandsObject returned 200 without a payment challenge/)
  assert.doesNotMatch(objectEndpoints.stdout, /catalogObject returned 200 without a payment challenge/)
  assert.doesNotMatch(objectEndpoints.stdout, /createOrderObject returned validation HTTP 400/)

  const linkedDiscovery = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/well-known.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(linkedDiscovery.stdout, new RegExp(`Source: ${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/well-known\\.json`))
  assert.match(linkedDiscovery.stdout, new RegExp(`Document: ${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/items\\.json`))
  assert.match(linkedDiscovery.stdout, /Premium routing recommendations/)

  const nestedDiscovery = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/nested-discovery.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(nestedDiscovery.stdout, new RegExp(`Source: ${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/nested-discovery\\.json`))
  assert.match(nestedDiscovery.stdout, new RegExp(`Document: ${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/items\\.json`))
  assert.match(nestedDiscovery.stdout, /Premium routing recommendations/)

  const stringEndpoints = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/string-endpoints.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(stringEndpoints.stdout, /string-paid/)
  assert.match(stringEndpoints.stdout, /string-post/)
  assert.match(stringEndpoints.stdout, /tool-paid/)
  assert.match(stringEndpoints.stdout, /Probed endpoints: 3/)
  assert.match(stringEndpoints.stdout, /\$0\.02/)
  assert.match(stringEndpoints.stdout, /\$0\.04/)
  assert.match(stringEndpoints.stdout, /\$0\.08/)

  const toolNameArray = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/tool-name-array.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(toolNameArray.stdout, /Probed endpoints: 0/)
  assert.doesNotMatch(toolNameArray.stdout, /\| 0 \|/)
  assert.match(toolNameArray.stdout, /Document does not expose any manifest, OpenAPI, item, category, or resource endpoints/)

  const streamableMcp = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/streamable-mcp`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(streamableMcp.stdout, /Streamable HTTP MCP endpoint/)
  assert.match(streamableMcp.stdout, /MCP Tool Catalog/)
  assert.match(streamableMcp.stdout, /Tools: 2/)
  assert.match(streamableMcp.stdout, /`paid_search`/)
  assert.match(streamableMcp.stdout, /Streamable HTTP MCP catalog exposes 2 tools/)
  assert.doesNotMatch(streamableMcp.stdout, /Document returned HTTP 405/)

  const routeCatalog = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/route-catalog.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(routeCatalog.stdout, /route-paid/)
  assert.match(routeCatalog.stdout, /route-post/)
  assert.match(routeCatalog.stdout, /Probed endpoints: 2/)
  assert.match(routeCatalog.stdout, /\$0\.03/)
  assert.match(routeCatalog.stdout, /\$0\.07/)

  const linkedOpenApi = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/openapi-link.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(linkedOpenApi.stdout, new RegExp(`Source: ${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/openapi-link\\.json`))
  assert.match(linkedOpenApi.stdout, new RegExp(`Document: ${serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/examples-openapi\\.json`))
  assert.match(linkedOpenApi.stdout, /createOrderWithExample/)
  assert.doesNotMatch(linkedOpenApi.stdout, /\[object Object\]/)

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
  assert.doesNotMatch(legacy.stdout, /did not expose Cache-Control/)

  const strictCache = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    `${serverUrl}/legacy/v1`,
    '--strict-cache',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(strictCache.stdout, /payment challenge response did not expose Cache-Control/)
  assert.match(strictCache.stdout, /Cloudflare x402 Worker Starter/)
  assert.match(strictCache.stdout, /x402 Attack Map 2026/)

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

  const cacheable = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'GET',
    `${serverUrl}/cacheable`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(cacheable.stdout, /Cache Policy Map/)
  assert.match(cacheable.stdout, /public, max-age=300/)
  assert.match(cacheable.stdout, /payment challenge response is explicitly cacheable/)
  assert.match(cacheable.stdout, /Cloudflare x402 Worker Starter/)
  assert.match(cacheable.stdout, /x402 Attack Map 2026/)

  const noOrigin = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'GET',
    `${serverUrl}/no-origin`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(noOrigin.stdout, /CORS preflight does not allow the requesting origin/)
  assert.match(noOrigin.stdout, /402 challenge response does not allow the requesting origin/)
  assert.match(noOrigin.stdout, /x402 CORS Fix/)
  assert.match(noOrigin.stdout, /Cloudflare x402 Worker Starter/)

  const groupedNoOrigin = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    `${serverUrl}/no-origin-list.json`,
    '--origin',
    'https://example.com',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(groupedNoOrigin.stdout, /## Finding Summary/)
  assert.match(groupedNoOrigin.stdout, /2 endpoints: P1 - Actual 402 challenge responses do not allow the requesting origin/)
  assert.match(groupedNoOrigin.stdout, /2 endpoints: P1 - CORS preflight does not allow the requesting origin/)

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

  const bodyRequired = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    '--body',
    '{"prompt":"price CPI"}',
    `${serverUrl}/body-required`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(bodyRequired.stdout, /body-required/)
  assert.match(bodyRequired.stdout, /\$0\.007/)
  assert.doesNotMatch(bodyRequired.stdout, /validation HTTP 400/)

  const strictProof = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    '--body',
    '{"email":"agent@example.com","items":[]}',
    `${serverUrl}/orders`,
    '--strict-proof',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(strictProof.stdout, /payment-identifier idempotency/)
  assert.match(strictProof.stdout, /signed offer\/receipt metadata/)
  assert.match(strictProof.stdout, /x402 Payment-Identifier/)
  assert.match(strictProof.stdout, /x402 Signed Offers & Receipts/)

  const proofedOrder = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'POST',
    `${serverUrl}/proofed-order`,
    '--strict-proof',
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(proofedOrder.stdout, /proofed-order/)
  assert.doesNotMatch(proofedOrder.stdout, /payment-identifier idempotency/)
  assert.doesNotMatch(proofedOrder.stdout, /signed offer\/receipt metadata/)

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

  const headerEnforcedFree = await execFileAsync('node', [
    'bin/x402-surface-check.mjs',
    '--endpoint',
    '--method',
    'GET',
    '--origin',
    serverUrl,
    `${serverUrl}/header-enforced-free`,
  ], { cwd: new URL('..', import.meta.url) })

  assert.match(headerEnforcedFree.stdout, /returned 200 without a payment challenge/)
  assert.match(headerEnforcedFree.stdout, /content while payment headers advertise enforcement/)
  assert.match(headerEnforcedFree.stdout, /CORS preflight does not allow X-PAYMENT/)
}
finally {
  await new Promise(resolve => server.close(resolve))
}
