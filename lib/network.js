async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
  if (!response.ok) {
    await response.body?.cancel()
    const message = response.headers.get('x-plantuml-diagram-error')
    throw new Error(`HTTP ${response.status} from ${new URL(url).origin}${message ? ': ' + message : ''}`)
  }
  return response
}

function validUrl(value) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !/[\s<>]/.test(value)
  } catch { return false }
}

async function shorten(url, options) {
  try {
    let result
    if (options.polrUrl) {
      const body = new URLSearchParams({ url, key: process.env.POLR_APIKEY || '', response_type: 'json' })
      const response = await request(`${options.polrUrl}/api/v2/action/shorten`, { method: 'POST', body, redirect: 'error' })
      const text = (await response.text()).trim()
      try { result = JSON.parse(text).result } catch { result = text }
    } else {
      result = (await (await request(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`)).text()).trim()
    }
    if (typeof result !== 'string' || !validUrl(result)) throw new Error('Invalid shortener response')
    return { url: result, cacheable: true }
  } catch (error) {
    // A private provider must never fail over to a public shortener or leak its response body/key.
    const message = options.polrUrl ? 'Polr request failed' : error.message
    console.warn(`WARN: Link shortening failed (${message}); using the full diagram URL.`)
    return { url, cacheable: false }
  }
}
module.exports = { request, shorten, validUrl }
