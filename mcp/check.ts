// Talks to Distill's MCP endpoint with nothing but fetch: initialize, list the tools, call one on
// the free tier. Use it to check the endpoint from your network before wiring up a client.
//
//   node mcp/check.ts [tool] [json-arguments]
//   node mcp/check.ts hospital_prices '{"code":"70551","zip":"80218","radius_miles":25}'
const endpoint = process.env.DISTILL_MCP_URL ?? 'https://data.spencermcw.com/mcp?via=examples'
const tool = process.argv[2] ?? 'tax_sales_rate'
const args = JSON.parse(process.argv[3] ?? '{"zip":"98101-3143"}') as Record<string, unknown>

let id = 0
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'user-agent': 'distill-examples/0.1 (+https://data.spencermcw.com)',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  })
  const text = await res.text()
  // Streamable HTTP answers JSON or one server-sent event; take the JSON either way.
  const json = text.trimStart().startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '')
  if (!res.ok || !json) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`)
  const message = JSON.parse(json) as { result?: Record<string, unknown>; error?: { message: string } }
  if (message.error) throw new Error(`${method}: ${message.error.message}`)
  return message.result ?? {}
}

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'distill-examples', version: '0.1.0' },
})
const info = init.serverInfo as { name: string; version: string }
console.log(`connected: ${info.name} ${info.version}`)
const { tools } = (await rpc('tools/list')) as { tools: { name: string; description: string }[] }
console.log(`${tools.length} tools:`)
for (const t of tools) console.log(`  ${t.name.padEnd(26)} ${t.description.split('. ')[0]?.slice(0, 100)}`)

const result = (await rpc('tools/call', { name: tool, arguments: args })) as {
  isError?: boolean
  structuredContent?: { data?: unknown; price_paid?: unknown; method_version?: string; notices?: string[] }
  content?: { text?: string }[]
}
if (result.isError) {
  console.log(`${tool}: payment required or error (free calls used up?)`)
  console.log(result.content?.[0]?.text?.slice(0, 300))
  process.exitCode = 1
} else {
  const env = result.structuredContent
  console.log(`${tool} answered (${env?.method_version}, ${env?.price_paid ? 'paid' : 'free tier'}):`)
  console.log(JSON.stringify(env?.data, null, 2).slice(0, 800))
}
