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
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return String(amount ?? '')
  const value = numeric / (10 ** decimals)
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 6,
    minimumFractionDigits: value < 0.01 ? 3 : 2,
  })}`
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
    const baseUrl = document.servers?.find(server => typeof server?.url === 'string')?.url
      ?? sourceUrl

    for (const [path, operations] of Object.entries(document.paths)) {
      if (!operations || typeof operations !== 'object') continue
      for (const method of methods) {
        const operation = operations[method]
        if (!operation || typeof operation !== 'object') continue
        const url = path.startsWith('http') ? path : new URL(path, baseUrl).toString()
        entries.push({
          name: operation.operationId ?? `${method.toUpperCase()} ${path}`,
          url,
          method: method.toUpperCase(),
        })
      }
    }
  }

  for (const resource of document.resources ?? []) {
    if (typeof resource !== 'string') continue
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

async function probeEndpoint(entry) {
  const method = entry.method ?? 'POST'
  const response = await fetch(entry.url, {
    method,
    headers: {
      'user-agent': `x402-surface-check/${packageJson.version}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  })
  const body = await readText(response)
  const headerChallenge = parseEncodedChallenge(
    response.headers.get('payment-required') ?? response.headers.get('x-payment-required'),
  )
  const authenticateChallenge = parsePaymentAuthenticate(response.headers.get('www-authenticate'))
    ?? parseX402Authenticate(response.headers.get('www-authenticate'))

  if (!body.json?.accepts?.length) {
    if (headerChallenge) {
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
  if (Array.isArray(value)) return value.map(String)
  if (value && typeof value === 'object') return Object.keys(value)
  if (typeof value === 'string') return [value]
  return []
}

function capabilityList(value) {
  if (!Array.isArray(value)) return []
  return value.map(item => item?.id ?? item?.name ?? item).filter(Boolean).map(String)
}

function challengeAccepts(result) {
  return Array.isArray(result.body.json?.accepts) ? result.body.json.accepts : []
}

function challengeSummary(result) {
  const challenge = result.body.json
  const firstAccept = challenge?.accepts?.[0] ?? {}
  const amount = firstAccept.amount ?? firstAccept.maxAmountRequired ?? firstAccept.maxAmount ?? ''
  const resourceUrl = challenge?.resource?.url ?? firstAccept.resource ?? ''
  const extraResource = firstAccept.extra?.resource ?? firstAccept.resource ?? ''

  return {
    status: result.status,
    protocol: challenge?.protocol ?? (firstAccept.scheme === 'mpp' ? 'mpp' : 'x402'),
    resourceUrl,
    network: firstAccept.network ?? '',
    amount,
    price: moneyFromAtomic(amount),
    payTo: firstAccept.payTo ?? '',
    asset: firstAccept.asset ?? '',
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

function findingList(documentResult, challengeResults, preflightResults, entries) {
  const document = documentResult.body.json ?? {}
  const findings = []
  const networks = valueList(document.networks)
  const challengeNetworks = new Set()

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

    if (result.status !== 402) {
      findings.push(`P1 - ${result.name} returned ${result.status}, not 402, for a no-payment ${result.method ?? 'POST'} probe.`)
    }
    if (summary.resourceUrl.startsWith('http://') || summary.extraResource.startsWith('http://')) {
      findings.push(`P1 - ${result.name} challenge uses a non-HTTPS resource URL: ${summary.resourceUrl || summary.extraResource}.`)
    }
    if (!summary.amount || !summary.payTo || !summary.asset) {
      findings.push(`P1 - ${result.name} challenge is missing amount/maxAmountRequired, payTo, or asset metadata.`)
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
    const allowed = result.headers['access-control-allow-headers'] ?? ''
    if (allowed !== '*' && !/x-payment/i.test(allowed)) {
      findings.push(`P1 - ${result.name} CORS preflight does not allow X-PAYMENT; observed allow headers: ${allowed || 'none'}.`)
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
    `- Facilitator: ${document.facilitator ?? '-'}`,
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
  const document = options.endpoint
    ? {
        status: 200,
        ok: true,
        headers: {},
        url: options.url,
        body: { text: '{}', json: {} },
      }
    : await fetchDocument(options.url)
  const entries = options.endpoint
    ? [{ name: new URL(options.url).pathname.split('/').filter(Boolean).at(-1) ?? options.url, url: options.url, method: options.method || 'POST' }]
    : (document.body.json ? endpointEntries(document.body.json, document.url, options.limit) : [])
  const origin = options.origin ?? new URL(document.url).origin
  const challenges = []
  const preflights = []

  for (const entry of entries) {
    challenges.push(await probeEndpoint(entry))
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
