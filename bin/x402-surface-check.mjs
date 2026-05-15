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
  --origin <url>   Origin to use for browser-style CORS preflight
  --limit <n>      Maximum endpoints to probe, default ${defaultLimit}
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
    outputPath: '',
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
    else if (arg === '--method') {
      args.method = String(argv[index + 1] ?? '').toUpperCase()
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

function exampleValue(schemaOrParameter) {
  if (!schemaOrParameter || typeof schemaOrParameter !== 'object') return undefined
  const schema = schemaOrParameter.schema ?? schemaOrParameter
  const value = schemaOrParameter.example
    ?? schema.example
    ?? schema.default
    ?? (Array.isArray(schema.enum) ? schema.enum[0] : undefined)
  if (value !== undefined) return value
  if (schema.type === 'string') return ''
  if (schema.type === 'number' || schema.type === 'integer') return 0
  if (schema.type === 'boolean') return false
  return undefined
}

function mediaExample(media) {
  if (!media || typeof media !== 'object') return undefined
  if (media.example !== undefined) return media.example
  const examples = media.examples && typeof media.examples === 'object'
    ? Object.values(media.examples)
    : []
  const firstExample = examples.find(Boolean)
  if (firstExample?.value !== undefined) return firstExample.value
  if (firstExample?.externalValue) return undefined

  const schema = media.schema
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') return undefined
  const body = {}
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required : Object.keys(properties))

  for (const [name, property] of Object.entries(properties)) {
    if (!required.has(name)) continue
    const value = exampleValue(property)
    if (value !== undefined) body[name] = value
  }

  return Object.keys(body).length ? body : undefined
}

function operationRequestBody(operation) {
  const content = operation?.requestBody?.content
  if (!content || typeof content !== 'object') return undefined
  const media = content['application/json']
    ?? content['application/*+json']
    ?? Object.entries(content).find(([type]) => /json/i.test(type))?.[1]
  return mediaExample(media)
}

function openApiProbeUrl(path, operation, baseUrl) {
  const parameters = Array.isArray(operation?.parameters) ? operation.parameters : []
  let resolvedPath = path
  const searchParams = new URLSearchParams()

  for (const parameter of parameters) {
    const value = exampleValue(parameter)
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

    for (const [path, operations] of Object.entries(document.paths)) {
      if (!operations || typeof operations !== 'object') continue
      for (const method of methods) {
        const operation = operations[method]
        if (!operation || typeof operation !== 'object') continue
        const url = openApiProbeUrl(path, operation, baseUrl)
        entries.push({
          name: operation.operationId ?? `${method.toUpperCase()} ${path}`,
          url,
          method: method.toUpperCase(),
          expectedPriceUsd: operationExpectedPrice(operation),
          requestBody: operationRequestBody(operation),
        })
      }
    }
  }

  for (const resource of document.resources ?? []) {
    if (typeof resource === 'string') {
      const match = resource.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i)
      if (!match) continue
      const [, method, rawPath] = match
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
  const resourceUrl = challenge?.resource?.url ?? firstAccept.resource ?? ''
  const extraResource = firstAccept.extra?.resource ?? firstAccept.resource ?? ''

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

function entryKey(entry) {
  return `${entry.method ?? 'POST'} ${entry.url}`
}

function looksLikeOperationalHealthEndpoint(result) {
  const value = `${result.name ?? ''} ${new URL(result.url).pathname}`.toLowerCase()
  return /(^|[/_\s-])(health|healthz|ready|readiness|live|liveness|status)([/_\s-]|$)/.test(value)
}

function findingList(documentResult, challengeResults, preflightResults, entries) {
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

  if (entries.length === 0) {
    findings.push('P1 - Document does not expose any manifest, OpenAPI, item, category, or resource endpoints for no-payment probes.')
  }

  for (const result of challengeResults) {
    const summary = challengeSummary(result)
    if (summary.network) challengeNetworks.add(summary.network)
    const hasChallenge = hasPaymentChallenge(result)

    if (result.status !== 402) {
      if (result.status >= 200 && result.status < 300) {
        if (!looksLikeOperationalHealthEndpoint(result)) {
          findings.push(`P3 - ${result.name} returned ${result.status} without a payment challenge for a no-payment ${result.method ?? 'POST'} probe; document this as free/trial access or move the 402 challenge before content.`)
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
    if (!summary.amount || !summary.payTo || !summary.asset) {
      findings.push(`P1 - ${result.name} challenge is missing amount/maxAmountRequired, payTo, or asset metadata.`)
    }
    if (summary.expectedPriceUsd !== null && summary.priceUsd !== null) {
      const delta = Math.abs(summary.expectedPriceUsd - summary.priceUsd)
      if (delta > 0.000001) {
        findings.push(`P1 - ${result.name} documented price ${moneyFromDecimal(summary.expectedPriceUsd)} does not match live 402 challenge price ${moneyFromDecimal(summary.priceUsd)}.`)
      }
    }
    for (const accept of challengeAccepts(result)) {
      if (looksLikePlaceholderPayTo(accept.payTo)) {
        findings.push(`P1 - ${result.name} challenge advertises placeholder-looking payTo ${accept.payTo}; production listings should not ask agents to pay placeholder recipients.`)
      }
      if (looksLikeStagingNetwork(accept.network)) {
        findings.push(`P2 - ${result.name} challenge advertises staging/test network ${accept.network}; document this as demo-only until live-value payment rails are active.`)
      }
    }
    if (!summary.resourceUrl || !summary.extraResource) {
      findings.push(`P2 - ${result.name} challenge does not repeat the resource URL in both resource.url and accepts[0].extra.resource/resource.`)
    }
  }

  for (const result of preflightResults) {
    const challengeResult = challengesByEntry.get(entryKey(result))
    if (!challengeResult || !hasPaymentChallenge(challengeResult)) continue
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

function formatMarkdown(report) {
  const document = report.document.body.json ?? {}
  const challengeRows = report.challenges.map(result => {
    const summary = challengeSummary(result)
    return `| ${result.name} | ${result.method ?? 'POST'} | ${result.status} | ${summary.protocol || '-'} | ${summary.price || '-'} | ${summary.network || '-'} | ${summary.resourceUrl || '-'} |`
  })
  const preflightRows = report.preflights.map(result => {
    return `| ${result.name} | ${result.method ?? 'POST'} | ${result.status} | ${result.headers['access-control-allow-origin'] ?? '-'} | ${result.headers['access-control-allow-headers'] ?? '-'} | ${result.headers['access-control-allow-methods'] ?? '-'} |`
  })

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
    '## Findings',
    '',
    ...(report.findings.length ? report.findings.map(item => `- ${item}`) : ['- No obvious launch-readiness findings from the public no-payment probes.']),
    '',
  ].join('\n')
}

async function runCheck(options) {
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
    ? [{ name: new URL(options.url).pathname.split('/').filter(Boolean).at(-1) ?? options.url, url: options.url, method: options.method || 'POST' }]
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
  report.findings = findingList(document, challenges, preflights, entries)
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
