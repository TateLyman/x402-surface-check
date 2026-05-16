#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'

const methods = ['get', 'post', 'put', 'patch', 'delete']
const defaultLimit = 6

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

function usage() {
  return `x402-surface-check ${packageJson.version}

Usage:
  x402-surface-check <manifest-or-openapi-url> [output.md]
  x402-surface-check --endpoint --method POST <paid-endpoint-url> [output.md]

Options:
  --endpoint       Treat the URL as one paid endpoint instead of a discovery document
  --method <verb>  HTTP method for direct endpoint mode, default POST
  --body <json>    JSON request body for direct endpoint mode
  --body-file <p>  Read JSON request body for direct endpoint mode from a file
  --origin <url>   Origin to use for browser-style CORS preflight
  --limit <n>      Maximum endpoints to probe, default ${defaultLimit}
  --strict-cache   Flag missing Cache-Control on no-payment 402 responses
  --json           Print JSON instead of Markdown
  --help           Show this help
  --version        Show package version
`
}

function parseArgs(argv) {
  const args = {
    json: false,
    endpoint: false,
    limit: Number(process.env.X402_CHECK_LIMIT ?? defaultLimit),
    method: 'POST',
    origin: process.env.X402_CHECK_ORIGIN,
    body: process.env.X402_CHECK_BODY,
    bodyFile: process.env.X402_CHECK_BODY_FILE,
    outputPath: '',
    strictCache: process.env.X402_STRICT_CACHE === '1',
    url: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
    }
    else if (arg === '--version' || arg === '-v') {
      args.version = true
    }
    else if (arg === '--json') {
      args.json = true
    }
    else if (arg === '--endpoint') {
      args.endpoint = true
    }
    else if (arg === '--strict-cache') {
      args.strictCache = true
    }
    else if (arg === '--method') {
      args.method = String(argv[index + 1] ?? '').toUpperCase()
      index += 1
    }
    else if (arg === '--body') {
      args.body = argv[index + 1]
      index += 1
    }
    else if (arg === '--body-file') {
      args.bodyFile = argv[index + 1]
      index += 1
    }
    else if (arg === '--origin') {
      args.origin = argv[index + 1]
      index += 1
    }
    else if (arg === '--limit') {
      args.limit = Number(argv[index + 1])
      index += 1
    }
    else if (!args.url) {
      args.url = arg
    }
    else if (!args.outputPath) {
      args.outputPath = arg
    }
    else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  return args
}

async function directEndpointRequestBody(options) {
  if (!options.endpoint) return undefined
  if (options.body && options.bodyFile) {
    throw new Error('Use either --body or --body-file, not both.')
  }
  const raw = options.bodyFile
    ? await readFile(options.bodyFile, 'utf8')
    : options.body
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  }
  catch (error) {
    throw new Error(`Request body must be valid JSON: ${error.message}`)
  }
}

function moneyFromAtomic(amount, decimals = 6) {
  if (amount === '' || amount === null || amount === undefined) return ''
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return String(amount ?? '')
  const value = numeric / (10 ** decimals)
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 6,
    minimumFractionDigits: value < 0.01 ? 3 : 2,
  })}`
}

function moneyFromDecimal(amount) {
  if (amount === '' || amount === null || amount === undefined) return ''
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return String(amount ?? '')
  return `$${numeric.toLocaleString(undefined, {
    maximumFractionDigits: 6,
    minimumFractionDigits: numeric < 0.01 ? 3 : 2,
  })}`
}

function numberFromDecimal(amount) {
  const numeric = Number(amount)
  return Number.isFinite(numeric) ? numeric : null
}

function uniqueEntries(entries, limit) {
  const seen = new Set()
  return entries
    .filter(entry => {
      const key = `${entry.method}:${entry.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : defaultLimit)
}

function documentBaseUrl(document, sourceUrl) {
  if (typeof document.service_url === 'string') return document.service_url
  if (typeof document.serviceUrl === 'string') return document.serviceUrl
  if (typeof document.baseUrl === 'string') return document.baseUrl
  if (typeof document.base_url === 'string') return document.base_url
  return new URL('/', sourceUrl).toString()
}

function endpointUrl(rawPath, baseUrl, sourceUrl) {
  const value = String(rawPath ?? '')
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  const resolvedBase = baseUrl || documentBaseUrl({}, sourceUrl)
  const base = value.startsWith('/') ? resolvedBase : `${resolvedBase.replace(/\/?$/, '/')}`
  return new URL(value, base).toString()
}

function openApiServerBaseUrl(document, sourceUrl) {
  const rawUrl = document.servers?.find(server => typeof server?.url === 'string')?.url
  if (!rawUrl) return documentBaseUrl(document, sourceUrl)
  return endpointUrl(rawUrl, documentBaseUrl(document, sourceUrl), sourceUrl)
}

function linkedDiscoveryUrl(document, sourceUrl) {
  const rawUrl = document?.discovery_url
    ?? document?.discoveryUrl
    ?? document?.resources_url
    ?? document?.resourcesUrl
    ?? (/^(https?:\/\/|\/)/i.test(String(document?.openapi ?? '')) ? document.openapi : '')
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return ''
  return endpointUrl(rawUrl, documentBaseUrl(document, sourceUrl), sourceUrl)
}

function operationExpectedPrice(operation) {
  const price = operation?.['x-payment-info']?.price
    ?? operation?.['x-payment']?.price
    ?? operation?.payment?.price
  const amount = price?.amount ?? price?.amountUsd ?? price?.usd
  const numeric = numberFromDecimal(amount)
  return numeric === null ? null : numeric
}

function resolveLocalRef(ref, document) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined
  return ref
    .slice(2)
    .split('/')
    .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((value, part) => value?.[part], document)
}

function resolveSchema(schema, document, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema
  if (!schema.$ref) return schema
  if (seen.has(schema.$ref)) return schema
  const resolved = resolveLocalRef(schema.$ref, document)
  if (!resolved) return schema
  seen.add(schema.$ref)
  return resolveSchema(resolved, document, seen)
}

function exampleValue(schemaOrParameter, document, depth = 0) {
  if (!schemaOrParameter || typeof schemaOrParameter !== 'object') return undefined
  const schema = resolveSchema(schemaOrParameter.schema ?? schemaOrParameter, document)
  const composite = schema.oneOf ?? schema.anyOf ?? schema.allOf
  if (Array.isArray(composite) && composite.length > 0) {
    return exampleValue(composite[0], document, depth + 1)
  }
  const value = schemaOrParameter.example
    ?? schema.const
    ?? schema.example
    ?? schema.default
    ?? (Array.isArray(schema.enum) ? schema.enum[0] : undefined)
  if (value !== undefined) return value
  if (schema.type === 'string') {
    if (schema.format === 'uri') return 'https://example.com'
    if (schema.format === 'date-time') return '2026-01-01T00:00:00.000Z'
    if (schema.format === 'date') return '2026-01-01'
    if (Number(schema.minLength) > 0) return 'example'
    return ''
  }
  if (schema.type === 'integer') return Number.isFinite(Number(schema.minimum)) ? Number(schema.minimum) : 1
  if (schema.type === 'number') return Number.isFinite(Number(schema.minimum)) ? Number(schema.minimum) : 1
  if (schema.type === 'boolean') return false
  if (schema.type === 'array') {
    if (depth > 4) return []
    const item = exampleValue(schema.items ?? {}, document, depth + 1)
    return item === undefined ? [] : [item]
  }
  if (schema.type === 'object') {
    if (depth > 4) return {}
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties
      : {}
    const required = new Set(Array.isArray(schema.required) ? schema.required : Object.keys(properties))
    const result = {}
    for (const [key, property] of Object.entries(properties)) {
      if (!required.has(key)) continue
      const nestedValue = exampleValue(property, document, depth + 1)
      if (nestedValue !== undefined) result[key] = nestedValue
    }
    return result
  }
  return undefined
}

function mediaExample(media, document) {
  if (!media || typeof media !== 'object') return undefined
  if (media.example !== undefined) return media.example
  const examples = media.examples && typeof media.examples === 'object'
    ? Object.values(media.examples)
    : []
  const firstExample = examples.find(Boolean)
  if (firstExample?.value !== undefined) return firstExample.value
  if (firstExample?.externalValue) return undefined

  const schema = resolveSchema(media.schema, document)
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') return undefined
  const body = {}
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : Object.keys(properties))

  for (const [name, property] of Object.entries(properties)) {
    if (!required.has(name)) continue
    const value = exampleValue(property, document)
    if (value !== undefined) body[name] = value
  }

  return Object.keys(body).length ? body : undefined
}

function operationRequestBody(operation, document) {
  const content = operation?.requestBody?.content
  if (!content || typeof content !== 'object') return undefined
  const media = content['application/json']
    ?? content['application/*+json']
    ?? Object.entries(content).find(([type]) => /json/i.test(type))?.[1]
  return mediaExample(media, document)
}

function operationPaymentSignal(operation) {
  if (operation?.['x-payment-info'] || operation?.['x-payment'] || operation?.['x-x402'] || operation?.payment) return 2
  if (operation?.responses && Object.hasOwn(operation.responses, '402')) return 1
  return 0
}

function openApiProbeUrl(path, operation, baseUrl, document) {
  const parameters = Array.isArray(operation?.parameters) ? operation.parameters : []
  let resolvedPath = path
  const searchParams = new URLSearchParams()

  for (const parameter of parameters) {
    const value = exampleValue(parameter, document)
    if (value === undefined || value === '') continue
    if (parameter.in === 'path') {
      resolvedPath = resolvedPath.replaceAll(`{${parameter.name}}`, encodeURIComponent(String(value)))
    }
    else if (parameter.in === 'query') {
      searchParams.set(parameter.name, String(value))
    }
  }

  const url = /^https?:\/\//i.test(String(resolvedPath))
    ? new URL(resolvedPath)
    : new URL(String(resolvedPath).replace(/^\/+/, ''), `${baseUrl.replace(/\/?$/, '/')}`)
  for (const [name, value] of searchParams.entries()) {
    url.searchParams.set(name, value)
  }
  return url.toString()
}

function manifestEndpointPaymentSignal(endpoint) {
  if (!endpoint || typeof endpoint !== 'object') return 0
  if (Number(endpoint.phase1_response?.status) === 402) return 2
  if (/payment-required|x-payment|402/i.test(String(endpoint.phase1_response?.header ?? ''))) return 2
  if (/payment|required|402/i.test(String(endpoint.description ?? ''))) return 1
  if (endpoint.accepts || endpoint.schemes || endpoint.payment || endpoint['x-payment-info']) return 1
  return 0
}

function manifestEndpointBody(endpoint, document) {
  const body = endpoint?.request_body ?? endpoint?.requestBody
  if (!body || typeof body !== 'object') return undefined
  if (body.example !== undefined) return body.example
  if (body.safe_example !== undefined) return body.safe_example
  if (body.safeExample !== undefined) return body.safeExample
  return exampleValue(body, document)
}

function manifestEndpointUrl(rawPath, endpoint, baseUrl, sourceUrl) {
  const url = new URL(endpointUrl(rawPath, baseUrl, sourceUrl))
  const parameters = endpoint?.parameters
  if (!parameters || typeof parameters !== 'object') return url.toString()

  for (const [name, parameter] of Object.entries(parameters)) {
    if (url.pathname.includes(`{${name}}`)) {
      const pathValue = parameter?.example ?? parameter?.default
      if (pathValue !== undefined && pathValue !== '') {
        url.pathname = url.pathname.replaceAll(`{${name}}`, encodeURIComponent(String(pathValue)))
      }
      continue
    }

    const value = parameter?.example ?? parameter?.default
    if (value !== undefined && value !== '') {
      url.searchParams.set(name, String(value))
    }
  }

  return url.toString()
}

function endpointEntries(document, sourceUrl, limit) {
  const entries = []
  const baseUrl = documentBaseUrl(document, sourceUrl)

  for (const [name, url] of Object.entries(document.x402Endpoints ?? {})) {
    if (typeof url === 'string' && url.startsWith('http')) {
      entries.push({ name, url, method: 'POST' })
    }
  }

  for (const [category, items] of Object.entries(document.categories ?? {})) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (typeof item?.endpoint === 'string' && item.endpoint.startsWith('http')) {
        entries.push({
          name: item.id ?? item.name ?? category,
          url: item.endpoint,
          method: item.method ?? 'POST',
        })
      }
    }
  }

  if (Array.isArray(document.endpoints)) {
    for (const endpoint of document.endpoints) {
      const rawPath = endpoint?.url ?? endpoint?.endpoint ?? endpoint?.path
      if (!rawPath) continue
      entries.push({
        name: endpoint.id ?? endpoint.name ?? String(rawPath).split('/').filter(Boolean).at(-1) ?? String(rawPath),
        url: endpointUrl(rawPath, baseUrl, sourceUrl),
        method: String(endpoint.method ?? 'POST').toUpperCase(),
      })
    }
  }
  else if (document.endpoints && typeof document.endpoints === 'object') {
    for (const [key, endpoint] of Object.entries(document.endpoints)) {
      if (!endpoint || typeof endpoint !== 'object') continue
      const rawPath = endpoint.url ?? endpoint.endpoint ?? endpoint.path
      if (!rawPath) continue
      const method = String(endpoint.method ?? 'POST').toUpperCase()
      const paymentSignal = manifestEndpointPaymentSignal(endpoint)
      const hasPathParameters = /\{[^}]+\}/.test(String(rawPath))
      if (paymentSignal === 0 && (method !== 'GET' || hasPathParameters)) continue
      entries.push({
        name: endpoint.id ?? endpoint.name ?? key,
        url: manifestEndpointUrl(rawPath, endpoint, baseUrl, sourceUrl),
        method,
        requestBody: manifestEndpointBody(endpoint, document),
        publicDiscovery: paymentSignal === 0,
      })
    }
  }

  if (Array.isArray(document.items)) {
    for (const item of document.items) {
      if (item?.type && item.type !== 'http') continue
      const rawPath = item?.resource ?? item?.url ?? item?.endpoint ?? item?.path
      if (!rawPath) continue
      entries.push({
        name: item.metadata?.name ?? item.id ?? item.name ?? String(rawPath).split('/').filter(Boolean).at(-1) ?? String(rawPath),
        url: endpointUrl(rawPath, baseUrl, sourceUrl),
        method: String(item.method ?? 'GET').toUpperCase(),
      })
    }
  }

  if (document.openapi && document.paths && typeof document.paths === 'object') {
    const baseUrl = openApiServerBaseUrl(document, sourceUrl)
    const openApiEntries = []

    for (const [path, operations] of Object.entries(document.paths)) {
      if (!operations || typeof operations !== 'object') continue
      for (const method of methods) {
        const operation = operations[method]
        if (!operation || typeof operation !== 'object') continue
        const url = openApiProbeUrl(path, operation, baseUrl, document)
        openApiEntries.push({
          name: operation.operationId ?? `${method.toUpperCase()} ${path}`,
          url,
          method: method.toUpperCase(),
          expectedPriceUsd: operationExpectedPrice(operation),
          requestBody: operationRequestBody(operation, document),
          paymentSignal: operationPaymentSignal(operation),
        })
      }
    }

    entries.push(...openApiEntries
      .sort((a, b) => b.paymentSignal - a.paymentSignal)
      .map(({ paymentSignal, ...entry }) => entry))
  }

  for (const resource of document.resources ?? []) {
    if (typeof resource === 'string') {
      const match = resource.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i)
      const method = match?.[1] ?? 'GET'
      const rawPath = match?.[2] ?? resource
      const url = rawPath.startsWith('http')
        ? rawPath
        : new URL(rawPath, document.baseUrl ?? sourceUrl).toString()
      entries.push({
        name: rawPath.split('/').filter(Boolean).at(-1) ?? rawPath,
        url,
        method: method.toUpperCase(),
      })
      continue
    }

    if (!resource || typeof resource !== 'object') continue
    const rawPath = resource.url ?? resource.endpoint ?? resource.resource ?? resource.path
    if (!rawPath) continue
    entries.push({
      name: resource.id
        ?? resource.name
        ?? resource.title
        ?? String(resource.path ?? rawPath).split('/').filter(Boolean).at(-1)
        ?? String(rawPath),
      url: endpointUrl(rawPath, baseUrl, sourceUrl),
      method: String(resource.method ?? 'GET').toUpperCase(),
    })
  }

  return uniqueEntries(entries, limit)
}

async function readText(response) {
  const text = await response.text()
  try {
    return { text, json: JSON.parse(text) }
  }
  catch {
    return { text, json: null }
  }
}

function parseEncodedChallenge(value) {
  if (!value) return null
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  }
  catch {
    try {
      return JSON.parse(value)
    }
    catch {
      return null
    }
  }
}

function authenticateParams(value, scheme) {
  const header = String(value ?? '').replace(/^www-authenticate:\s*/i, '').trim()
  if (!header || !new RegExp(`^${scheme}\\s+`, 'i').test(header)) return null
  const params = {}
  const pattern = /([a-zA-Z][\w-]*)="([^"]*)"/g
  let match = pattern.exec(header)

  while (match) {
    params[match[1]] = match[2]
    match = pattern.exec(header)
  }

  return params
}

function parsePaymentAuthenticate(value) {
  const params = authenticateParams(value, 'Payment')
  if (!params) return null

  const request = parseEncodedChallenge(params.request)
  if (!request) return null

  return {
    protocol: 'mpp',
    resource: { url: '' },
    accepts: [{
      scheme: 'mpp',
      network: request.methodDetails?.network ?? params.method ?? '',
      amount: request.amount ?? '',
      asset: request.currency ?? '',
      payTo: request.recipient ?? '',
      resource: '',
      maxTimeoutSeconds: '',
      extra: {
        description: request.description ?? '',
        decimals: request.methodDetails?.decimals ?? '',
        expires: params.expires ?? '',
        id: params.id ?? '',
        intent: params.intent ?? '',
        method: params.method ?? '',
      },
    }],
  }
}

function parseX402Authenticate(value) {
  const params = authenticateParams(value, 'X402')
  if (!params) return null

  const requirements = parseEncodedChallenge(params.requirements ?? params.request)
  if (!requirements || !Array.isArray(requirements.accepts)) return null

  return {
    protocol: requirements.protocol ?? 'x402',
    ...requirements,
  }
}

async function fetchDocument(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': `x402-surface-check/${packageJson.version}`,
      accept: 'application/json',
    },
  })
  const body = await readText(response)
  return {
    status: response.status,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    url: response.url,
    body,
  }
}

async function probeEndpoint(entry, origin) {
  const method = entry.method ?? 'POST'
  const response = await fetch(entry.url, {
    method,
    headers: {
      'user-agent': `x402-surface-check/${packageJson.version}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: method === 'GET' || method === 'HEAD'
      ? undefined
      : JSON.stringify(entry.requestBody ?? {}),
  })
  const body = await readText(response)
  const headerChallenge = parseEncodedChallenge(
    response.headers.get('payment-required') ?? response.headers.get('x-payment-required'),
  )
  const authenticateChallenge = parsePaymentAuthenticate(response.headers.get('www-authenticate'))
    ?? parseX402Authenticate(response.headers.get('www-authenticate'))

  const bodyHasChallenge = Array.isArray(body.json?.accepts) || Array.isArray(body.json?.schemes)
  if (!bodyHasChallenge) {
    if (headerChallenge && typeof headerChallenge === 'object') {
      body.json = headerChallenge
    }
    else if (authenticateChallenge) {
      authenticateChallenge.resource = authenticateChallenge.resource ?? { url: entry.url }
      authenticateChallenge.resource.url = authenticateChallenge.resource.url || entry.url
      authenticateChallenge.accepts[0].resource = authenticateChallenge.accepts[0].resource || entry.url
      body.json = authenticateChallenge
    }
  }

  return {
    ...entry,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

async function probePreflight(entry, origin) {
  const response = await fetch(entry.url, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': entry.method ?? 'POST',
      'access-control-request-headers': 'content-type,x-payment',
    },
  })

  return {
    ...entry,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
  }
}

function valueList(value) {
  if (Array.isArray(value)) return value.map(displayMetadataValue)
  if (value && typeof value === 'object') return Object.keys(value)
  if (typeof value === 'string') return [value]
  return []
}

function displayMetadataValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (Array.isArray(value)) {
    return value.map(displayMetadataValue).filter(item => item && item !== '-').join(', ') || '-'
  }
  if (typeof value === 'object') {
    const parts = [
      value.name,
      value.operator,
      value.url,
      value.jurisdiction,
      value.network,
    ].filter(item => item !== null && item !== undefined && item !== '').map(String)
    return parts.join(' / ') || Object.keys(value).join(', ') || '-'
  }
  return String(value)
}

function capabilityList(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => item?.id ?? item?.name ?? item).filter(Boolean).map(String)
}

function challengeAccepts(result) {
  if (Array.isArray(result.body.json?.accepts)) return result.body.json.accepts
  if (Array.isArray(result.body.json?.schemes)) return result.body.json.schemes
  return []
}

function acceptAmountValue(accept) {
  return accept.maxAmountRequired ?? accept.maxAmount ?? accept.amount ?? ''
}

function acceptAssetValue(accept) {
  return accept.asset ?? accept.token ?? accept.currency ?? ''
}

function acceptDecimals(accept) {
  const value = accept.decimals ?? accept.extra?.decimals ?? accept.methodDetails?.decimals
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 6
}

function acceptResourceValue(accept) {
  return accept.resource
    ?? accept.extra?.resource
    ?? accept.resourceUrl
    ?? accept.extra?.resourceUrl
    ?? ''
}

function challengeResourceValue(challenge) {
  return challenge?.resource?.url
    ?? challenge?.resourceUrl
    ?? ''
}

function hasFreshnessMetadata(challenge, accept) {
  return [
    challenge?.expires,
    challenge?.expiresAt,
    challenge?.validBefore,
    challenge?.maxTimeoutSeconds,
    accept?.maxTimeoutSeconds,
    accept?.maxTimeout,
    accept?.timeout,
    accept?.expires,
    accept?.expiresAt,
    accept?.validBefore,
    accept?.extra?.expires,
    accept?.extra?.validBefore,
  ].some(value => value !== undefined && value !== null && value !== '')
}

function usesDecimalAmount(accept, result) {
  const rawAmount = acceptAmountValue(accept)
  if (rawAmount === undefined || rawAmount === null || rawAmount === '') return false
  const amount = String(rawAmount)
  if (amount.includes('.')) return true
  if (accept.maxAmountRequired !== undefined || accept.maxAmount !== undefined) return false
  if (!accept.asset && (accept.token || result.headers?.['x-payment-token'])) return true
  return result.headers?.['x-payment-amount'] === amount
}

function challengePrice(accept, result) {
  const amount = acceptAmountValue(accept)
  return usesDecimalAmount(accept, result)
    ? moneyFromDecimal(amount)
    : moneyFromAtomic(amount, acceptDecimals(accept))
}

function challengePriceUsd(accept, result) {
  const amount = acceptAmountValue(accept)
  if (usesDecimalAmount(accept, result)) return numberFromDecimal(amount)
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return null
  return numeric / (10 ** acceptDecimals(accept))
}

function hasPaymentChallenge(result) {
  const challenge = result.body.json
  return challengeAccepts(result).length > 0 || Boolean(challenge?.resource || challenge?.payment || result.headers?.['www-authenticate'])
}

function challengeSummary(result) {
  const challenge = result.body.json
  const firstAccept = challengeAccepts(result)[0] ?? {}
  const hasChallenge = hasPaymentChallenge(result)
  const amount = acceptAmountValue(firstAccept)
  const resourceUrl = challengeResourceValue(challenge) || acceptResourceValue(firstAccept)
  const extraResource = acceptResourceValue(firstAccept)

  return {
    status: result.status,
    protocol: hasChallenge ? challenge?.protocol ?? (firstAccept.scheme === 'mpp' ? 'mpp' : 'x402') : '',
    resourceUrl,
    network: firstAccept.network ?? '',
    amount,
    price: hasChallenge ? challengePrice(firstAccept, result) : '',
    priceUsd: hasChallenge ? challengePriceUsd(firstAccept, result) : null,
    expectedPriceUsd: typeof result.expectedPriceUsd === 'number' ? result.expectedPriceUsd : null,
    payTo: firstAccept.payTo ?? '',
    asset: acceptAssetValue(firstAccept),
    timeout: firstAccept.maxTimeoutSeconds ?? '',
    extraResource,
  }
}

function looksLikeStagingNetwork(network) {
  return /devnet|testnet|sepolia|local|eip155:84532|solana:EtWTRAB/i.test(String(network ?? ''))
}

function looksLikePlaceholderPayTo(payTo) {
  const value = String(payTo ?? '')
  if (!value) return false
  if (/^0x0{36,}0?1?$/i.test(value)) return true
  if (/^1{24,}$/.test(value)) return true
  return false
}

function looksLikeLocalResourceUrl(value) {
  if (!/^https?:\/\//i.test(String(value ?? ''))) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'localhost'
      || host === '0.0.0.0'
      || host === '127.0.0.1'
      || host === '::1'
      || host.endsWith('.local')
  }
  catch {
    return false
  }
}

const secretQueryParamPattern =
  /^(?:access[_-]?token|api[_-]?key|auth|authorization|bearer|client[_-]?secret|code|key|password|private[_-]?key|secret|session|sig|signature|token|jwt)$/i

function redactedCredentialUrl(value) {
  if (!/^https?:\/\//i.test(String(value ?? ''))) return null
  try {
    const url = new URL(value)
    let changed = false

    if (url.username || url.password) {
      if (url.username) url.username = 'REDACTED'
      if (url.password) url.password = 'REDACTED'
      changed = true
    }

    for (const [name] of Array.from(url.searchParams.entries())) {
      if (secretQueryParamPattern.test(name)) {
        url.searchParams.set(name, 'REDACTED')
        changed = true
      }
    }

    return changed ? url.toString() : null
  }
  catch {
    return null
  }
}

function publicUrlCredentialFindings(value, path = 'document', depth = 0) {
  if (depth > 8 || value === null || value === undefined) return []
  if (typeof value === 'string') {
    const redacted = redactedCredentialUrl(value)
    return redacted
      ? [`P2 - Public document exposes credential-like URL material at ${path}: ${redacted}. Move provider tokens, signatures, sessions, or API keys out of registry-visible endpoint URLs.`]
      : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => publicUrlCredentialFindings(item, `${path}[${index}]`, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => {
      const safeKey = /^[a-zA-Z_$][\w$-]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
      return publicUrlCredentialFindings(item, `${path}${safeKey}`, depth + 1)
    })
  }
  return []
}

function cachePolicy(headers = {}) {
  return headers['cache-control'] ?? headers.cacheControl ?? ''
}

function paymentSignalHeaders(headers = {}) {
  return [
    'x-payment-required',
    'x-payment-enforce',
    'x-price-usdc',
    'x-payment-address',
    'x-payment-network',
    'x-payment-token',
    'x-payment-protocol',
  ].filter(name => headers[name] !== undefined && headers[name] !== '')
}

function advertisesPaymentEnforcement(headers = {}) {
  const required = String(headers['x-payment-required'] ?? '').toLowerCase() === 'true'
  const enforced = String(headers['x-payment-enforce'] ?? '').toLowerCase() === 'true'
  return required || enforced || (required && paymentSignalHeaders(headers).length > 1)
}

function looksExplicitlyCacheable(headers = {}) {
  const policy = cachePolicy(headers)
  if (!policy) return false
  if (/\b(no-store|private|no-cache)\b/i.test(policy)) return false
  return /\b(public|s-maxage|max-age\s*=)\b/i.test(policy)
}

function entryKey(entry) {
  return `${entry.method ?? 'POST'} ${entry.url}`
}

function looksLikeOperationalHealthEndpoint(result) {
  const value = `${result.name ?? ''} ${new URL(result.url).pathname}`.toLowerCase()
  return /(^|[/_\s-])(health|healthz|ready|readiness|live|liveness|status)([/_\s-]|$)/.test(value)
}

function findingList(documentResult, challengeResults, preflightResults, entries, options = {}) {
  const document = documentResult.body.json ?? {}
  const findings = []
  const networks = valueList(document.networks)
  const challengeNetworks = new Set()
  const challengesByEntry = new Map(challengeResults.map(result => [entryKey(result), result]))

  if (documentResult.status < 200 || documentResult.status >= 300) {
    findings.push(`P1 - Document returned HTTP ${documentResult.status}; expected a successful JSON response.`)
  }

  if (!documentResult.body.json) {
    findings.push(`P1 - Document did not return parseable JSON; content begins: ${documentResult.body.text.slice(0, 80).replace(/\s+/g, ' ')}.`)
  }
  else {
    findings.push(...publicUrlCredentialFindings(document))
  }

  if (entries.length === 0) {
    findings.push('P1 - Document does not expose any manifest, OpenAPI, item, category, or resource endpoints for no-payment probes.')
  }

  for (const result of challengeResults) {
    const summary = challengeSummary(result)
    if (summary.network) challengeNetworks.add(summary.network)
    const hasChallenge = hasPaymentChallenge(result)

    if (result.publicDiscovery && !hasChallenge) {
      if (result.status < 200 || result.status >= 300) {
        findings.push(`P2 - ${result.name} is documented as a public discovery route but returned HTTP ${result.status}; check the manifest example parameters or route availability.`)
      }
      continue
    }

    if (result.status !== 402) {
      if (result.status >= 200 && result.status < 300) {
        if (!looksLikeOperationalHealthEndpoint(result)) {
          findings.push(`P3 - ${result.name} returned ${result.status} without a payment challenge for a no-payment ${result.method ?? 'POST'} probe; document this as free/trial access or move the 402 challenge before content.`)
        }
        if (advertisesPaymentEnforcement(result.headers)) {
          findings.push(`P2 - ${result.name} returned ${result.status} content while payment headers advertise enforcement (${paymentSignalHeaders(result.headers).join(', ')}); either return a 402 before content or document this endpoint as public telemetry.`)
        }
      }
      else if (result.status === 400 || result.status === 422) {
        findings.push(`P1 - ${result.name} returned validation HTTP ${result.status} before a payment challenge for a no-payment ${result.method ?? 'POST'} probe.`)
      }
      else if (result.status === 401 || result.status === 403) {
        findings.push(`P2 - ${result.name} returned auth HTTP ${result.status} before a payment challenge for a no-payment ${result.method ?? 'POST'} probe; document the auth/free-tier order if this is intentional.`)
      }
      else {
        findings.push(`P1 - ${result.name} returned ${result.status}, not 402, for a no-payment ${result.method ?? 'POST'} probe.`)
      }
    }

    if (!hasChallenge) {
      continue
    }

    if (!result.headers?.['access-control-allow-origin']) {
      findings.push(`P1 - ${result.name} 402 challenge response does not allow the requesting origin; browser agents cannot read the payment requirements even if preflight succeeds.`)
    }
    if (summary.resourceUrl.startsWith('http://') || summary.extraResource.startsWith('http://')) {
      findings.push(`P1 - ${result.name} challenge uses a non-HTTPS resource URL: ${summary.resourceUrl || summary.extraResource}.`)
    }
    if (looksLikeLocalResourceUrl(summary.resourceUrl) || looksLikeLocalResourceUrl(summary.extraResource)) {
      findings.push(`P1 - ${result.name} challenge binds payment to a localhost/private-development resource URL: ${summary.resourceUrl || summary.extraResource}.`)
    }
    if (!summary.amount || !summary.payTo || !summary.asset) {
      findings.push(`P1 - ${result.name} challenge is missing amount/maxAmountRequired, payTo, or asset metadata.`)
    }
    if (summary.expectedPriceUsd !== null && summary.priceUsd !== null) {
      const delta = Math.abs(summary.expectedPriceUsd - summary.priceUsd)
      if (delta > 0.000001) {
        findings.push(`P1 - ${result.name} documented price ${moneyFromDecimal(summary.expectedPriceUsd)} does not match live 402 challenge price ${moneyFromDecimal(summary.priceUsd)}.`)
      }
    }
    const accepts = challengeAccepts(result)
    const topResource = challengeResourceValue(result.body.json)
    const acceptResources = accepts.map(acceptResourceValue)
    const populatedAcceptResources = acceptResources.filter(Boolean)

    for (const accept of accepts) {
      if (looksLikePlaceholderPayTo(accept.payTo)) {
        findings.push(`P1 - ${result.name} challenge advertises placeholder-looking payTo ${accept.payTo}; production listings should not ask agents to pay placeholder recipients.`)
      }
      if (looksLikeStagingNetwork(accept.network)) {
        findings.push(`P2 - ${result.name} challenge advertises staging/test network ${accept.network}; document this as demo-only until live-value payment rails are active.`)
      }
    }
    if (!topResource && populatedAcceptResources.length === 0) {
      findings.push(`P2 - ${result.name} challenge does not expose a signed/intended resource URL at the top level or in any accept leg.`)
    }
    else if (accepts.length > 0 && populatedAcceptResources.length < accepts.length) {
      findings.push(`P2 - ${result.name} challenge does not repeat the resource URL in every accept leg for spend-map and replay binding.`)
    }
    if (topResource && populatedAcceptResources.some(resource => resource !== topResource)) {
      findings.push(`P2 - ${result.name} challenge resource URL differs between resource.url and one or more accept legs; agents may bind the payment to inconsistent resources.`)
    }
    if (accepts.length > 0 && !accepts.some(accept => hasFreshnessMetadata(result.body.json, accept))) {
      findings.push(`P2 - ${result.name} challenge does not expose timeout/expiry metadata; bounded freshness helps reduce replay windows for payment capabilities.`)
    }
    if (looksExplicitlyCacheable(result.headers)) {
      findings.push(`P1 - ${result.name} payment challenge response is explicitly cacheable (${cachePolicy(result.headers)}); paid routes should use no-store/private cache policy or bypass shared caches.`)
    }
    else if (options.strictCache && !cachePolicy(result.headers)) {
      findings.push(`P3 - ${result.name} payment challenge response did not expose Cache-Control; for payment-gated routes, document or send no-store/private cache policy and confirm paid 200 responses are never shared-cacheable.`)
    }
  }

  for (const result of preflightResults) {
    const challengeResult = challengesByEntry.get(entryKey(result))
    if (!challengeResult || (!hasPaymentChallenge(challengeResult) && !advertisesPaymentEnforcement(challengeResult.headers))) continue
    const allowedOrigin = result.headers['access-control-allow-origin'] ?? ''
    if (!allowedOrigin) {
      findings.push(`P1 - ${result.name} CORS preflight does not allow the requesting origin; observed allow-origin: none.`)
    }
    const allowed = result.headers['access-control-allow-headers'] ?? ''
    if (allowed !== '*' && !/x-payment/i.test(allowed)) {
      const observed = result.status >= 400
        ? `HTTP ${result.status}; allow headers: ${allowed || 'none'}`
        : `allow headers: ${allowed || 'none'}`
      findings.push(`P1 - ${result.name} CORS preflight does not allow X-PAYMENT; observed ${observed}.`)
    }
    const allowedMethods = result.headers['access-control-allow-methods'] ?? ''
    if (/delete|put|patch/i.test(allowedMethods)) {
      findings.push(`P2 - ${result.name} CORS allow-methods is broader than a narrow public x402 contract: ${allowedMethods}.`)
    }
  }

  if (networks.length > 1 && challengeNetworks.size === 1) {
    findings.push(`P2 - Document lists ${networks.length} networks, while observed 402 challenges exposed one network: ${[...challengeNetworks].join(', ')}.`)
  }

  if (document.x402Endpoint && document.x402Endpoints) {
    findings.push(`P3 - Document includes both x402Endpoint (${document.x402Endpoint}) and x402Endpoints; clarify which path clients should prefer.`)
  }

  return findings
}

function groupedFindingLabel(finding) {
  if (/402 challenge response does not allow the requesting origin/.test(finding)) {
    return 'P1 - Actual 402 challenge responses do not allow the requesting origin; browser clients cannot read payment requirements.'
  }
  if (/CORS preflight does not allow the requesting origin/.test(finding)) {
    return 'P1 - CORS preflight does not allow the requesting origin.'
  }
  if (/CORS preflight does not allow X-PAYMENT/.test(finding)) {
    return 'P1 - CORS preflight does not allow X-PAYMENT.'
  }
  if (/challenge does not expose a signed\/intended resource URL|challenge does not repeat the resource URL|challenge resource URL differs/.test(finding)) {
    return 'P2 - Challenges have incomplete or inconsistent resource binding.'
  }
  if (/returned validation HTTP \d+ before a payment challenge/.test(finding)) {
    return 'P1 - Routes return validation before a payment challenge.'
  }
  if (/returned auth HTTP \d+ before a payment challenge/.test(finding)) {
    return 'P2 - Routes return auth before a payment challenge.'
  }
  if (/challenge advertises staging\/test network/.test(finding)) {
    return 'P2 - Challenges advertise staging or test networks.'
  }
  if (/challenge advertises placeholder-looking payTo/.test(finding)) {
    return 'P1 - Challenges advertise placeholder-looking payTo recipients.'
  }
  if (/challenge does not expose timeout\/expiry metadata/.test(finding)) {
    return 'P2 - Challenges do not expose timeout or expiry metadata for replay-window control.'
  }
  if (/payment challenge response did not expose Cache-Control/.test(finding)) {
    return 'P3 - Payment challenge responses do not expose Cache-Control in strict cache mode.'
  }
  if (/payment challenge response is explicitly cacheable/.test(finding)) {
    return 'P1 - Payment challenge responses are explicitly cacheable.'
  }
  if (/content while payment headers advertise enforcement/.test(finding)) {
    return 'P2 - Payment headers advertise enforcement on a 200 response.'
  }
  return null
}

function groupedFindingSummary(findings) {
  const counts = new Map()
  for (const finding of findings) {
    const label = groupedFindingLabel(finding)
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([label, count]) => `- ${count} endpoints: ${label}`)
}

function referenceGuides(findings) {
  const guides = []
  const add = (label, url) => {
    if (!guides.some(guide => guide.url === url)) guides.push({ label, url })
  }
  const text = findings.join('\n')
  if (/CORS|402 challenge response does not allow the requesting origin|X-PAYMENT/i.test(text)) {
    add('x402 CORS Fix', 'https://tateprograms.com/x402-cors-fix.html')
    add('Cloudflare x402 Worker Starter', 'https://tateprograms.com/cloudflare-x402-worker.html')
  }
  if (/cacheable|Cache-Control|cache policy|shared caches/i.test(text)) {
    add('Cloudflare x402 Worker Starter', 'https://tateprograms.com/cloudflare-x402-worker.html')
    add('x402 Attack Map 2026', 'https://tateprograms.com/x402-attack-map-2026.html')
  }
  if (/validation HTTP \d+ before a payment challenge|auth HTTP \d+ before a payment challenge|replay|idempotency|timeout\/expiry|freshness/i.test(text)) {
    add('x402 Launch Checklist', 'https://tateprograms.com/x402-launch-checklist.html')
    add('x402 Attack Map 2026', 'https://tateprograms.com/x402-attack-map-2026.html')
  }
  if (/resource URL|resource echo|resource binding|accept leg|accepts\[0\]\.extra\.resource/i.test(text)) {
    add('x402 Surface Check notes', 'https://tateprograms.com/x402-surface-check.html')
    add('x402 Attack Map 2026', 'https://tateprograms.com/x402-attack-map-2026.html')
  }
  if (/credential-like URL material|provider tokens|API keys|registry-visible endpoint URLs/i.test(text)) {
    add('x402 Metadata Filter', 'https://tateprograms.com/x402-metadata-filter.html')
    add('Agent Commerce Gate', 'https://tateprograms.com/agent-commerce-gate.html')
  }
  return guides.map(guide => `- ${guide.label}: ${guide.url}`)
}

function formatMarkdown(report) {
  const document = report.document.body.json ?? {}
  const challengeRows = report.challenges.map(result => {
    const summary = challengeSummary(result)
    return `| ${result.name} | ${result.method ?? 'POST'} | ${result.status} | ${summary.protocol || '-'} | ${summary.price || '-'} | ${summary.network || '-'} | ${summary.resourceUrl || '-'} |`
  })
  const preflightRows = report.preflights.map(result => {
    return `| ${result.name} | ${result.method ?? 'POST'} | ${result.status} | ${result.headers['access-control-allow-origin'] ?? '-'} | ${result.headers['access-control-allow-headers'] ?? '-'} | ${result.headers['access-control-allow-methods'] ?? '-'} |`
  })
  const cacheRows = report.challenges.map(result => {
    return `| ${result.name} | ${result.method ?? 'POST'} | ${result.status} | ${cachePolicy(result.headers) || '-'} |`
  })
  const findingSummary = groupedFindingSummary(report.findings)
  const guides = referenceGuides(report.findings)

  return [
    '# x402 Public Surface Check',
    '',
    ...(report.sourceDocument ? [`Source: ${report.sourceDocument.url}`] : []),
    `Document: ${report.document.url}`,
    `Checked: ${report.checkedAt}`,
    'Scope: manifest/OpenAPI parsing, no-payment endpoint probes, and browser-style CORS preflight. No payment headers or paid calls.',
    `Preflight origin: ${report.origin}`,
    '',
    '## Document',
    '',
    `- Status: ${report.document.status}`,
    `- Type: ${report.directEndpoint ? 'direct endpoint' : (document.openapi ? 'OpenAPI' : 'x402 manifest or JSON document')}`,
    `- Agent: ${document.agent?.name ?? '-'}`,
    `- Wallet: ${document.agent?.wallet ?? '-'}`,
    `- Facilitator: ${displayMetadataValue(document.facilitator)}`,
    `- Networks: ${valueList(document.networks).join(', ') || '-'}`,
    `- Capabilities: ${capabilityList(document.capabilities).join(', ') || '-'}`,
    `- Probed endpoints: ${report.entries.length}`,
    '',
    '## No-Payment Challenge Map',
    '',
    '| Endpoint | Method | HTTP | Protocol | Price | Network | Resource URL |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(challengeRows.length ? challengeRows : ['| - | - | - | - | - | - | - |']),
    '',
    '## Browser Preflight Map',
    '',
    '| Endpoint | Method | HTTP | Allow-Origin | Allow-Headers | Allow-Methods |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(preflightRows.length ? preflightRows : ['| - | - | - | - | - | - |']),
    '',
    '## Cache Policy Map',
    '',
    '| Endpoint | Method | HTTP | Cache-Control |',
    '| --- | --- | --- | --- |',
    ...(cacheRows.length ? cacheRows : ['| - | - | - | - |']),
    '',
    ...(findingSummary.length ? [
      '## Finding Summary',
      '',
      ...findingSummary,
      '',
    ] : []),
    '## Findings',
    '',
    ...(report.findings.length ? report.findings.map(item => `- ${item}`) : ['- No obvious launch-readiness findings from the public no-payment probes.']),
    '',
    ...(guides.length ? [
      '## Reference Guides',
      '',
      ...guides,
      '',
    ] : []),
  ].join('\n')
}

async function runCheck(options) {
  const directRequestBody = await directEndpointRequestBody(options)
  let sourceDocument = null
  let document = options.endpoint
    ? {
        status: 200,
        ok: true,
        headers: {},
        url: options.url,
        body: { text: '{}', json: {} },
      }
    : await fetchDocument(options.url)
  let entries = options.endpoint
    ? [{ name: new URL(options.url).pathname.split('/').filter(Boolean).at(-1) ?? options.url, url: options.url, method: options.method || 'POST', requestBody: directRequestBody }]
    : (document.body.json ? endpointEntries(document.body.json, document.url, options.limit) : [])

  if (!options.endpoint && entries.length === 0 && document.body.json) {
    const discoveryUrl = linkedDiscoveryUrl(document.body.json, document.url)
    if (discoveryUrl) {
      const followedDocument = await fetchDocument(discoveryUrl)
      const followedEntries = followedDocument.body.json
        ? endpointEntries(followedDocument.body.json, followedDocument.url, options.limit)
        : []
      if (followedEntries.length > 0) {
        sourceDocument = document
        document = followedDocument
        entries = followedEntries
      }
    }
  }

  const origin = options.origin ?? new URL(document.url).origin
  const challenges = []
  const preflights = []

  for (const entry of entries) {
    challenges.push(await probeEndpoint(entry, origin))
    preflights.push(await probePreflight(entry, origin))
  }

  const report = {
    checkedAt: new Date().toISOString(),
    document,
    directEndpoint: options.endpoint,
    entries,
    findings: [],
    origin,
    challenges,
    preflights,
    sourceDocument,
  }
  report.findings = findingList(document, challenges, preflights, entries, {
    strictCache: options.strictCache,
  })
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (options.version) {
    console.log(packageJson.version)
    return
  }
  if (!options.url) {
    console.error(usage())
    process.exitCode = 2
    return
  }

  const report = await runCheck(options)
  const output = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${formatMarkdown(report)}\n`

  if (options.outputPath) {
    await writeFile(options.outputPath, output)
  }

  process.stdout.write(output)
}

main().catch(error => {
  console.error(`x402-surface-check: ${error.message}`)
  process.exitCode = 1
})
