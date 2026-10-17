const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const ignore = require('ignore')
const MarkdownIt = require('markdown-it')
const encoder = require('plantuml-encoder')
const { hash, writeAtomic, loadCache } = require('./lib/cache')
const { request, shorten, validUrl } = require('./lib/network')

const markdown = new MarkdownIt()
const diagramExtension = /\.(?:puml|plantuml)$/i
const posix = value => value.split(path.sep).join('/')
const isWithin = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}
const resolveReference = (file, ref) => path.resolve(path.dirname(file), ref.replace(/\\/g, '/'))
const fullUrl = (options, format, encoded) => `${options.pumlServerUrl}/${format}/${encoded}`

const localFormat = options => options.imageFormats.includes('svg') ? 'svg' : 'png'
function imagePath(file, format, options) {
  if (!isWithin(options.rootDirectory, file)) throw new Error(`Cannot export a diagram outside root-directory: ${file}`)
  return path.join(options.distDirectory, path.relative(options.rootDirectory, file).replace(diagramExtension, `.${format}`))
}
const relativeUrl = (from, to) => posix(path.relative(path.dirname(from), to)).split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')

function normalizeOptions(input) {
  const rootDirectory = path.resolve(input.rootDirectory || process.cwd())
  const options = {
    ...input,
    rootDirectory,
    markdownDirectory: path.resolve(input.markdownDirectory || rootDirectory),
    pumlDirectory: path.resolve(input.pumlDirectory || rootDirectory),
    distDirectory: path.resolve(input.distDirectory || path.join(rootDirectory, 'dist_puml')),
    gitignorePath: path.resolve(input.gitignorePath || path.join(rootDirectory, '.gitignore')),
    pumlServerUrl: (input.pumlServerUrl || 'https://www.plantuml.com/plantuml').replace(/\/+$/, ''),
    shouldShortenLinks: input.shouldShortenLinks ?? true,
    respectGitignore: input.respectGitignore ?? true,
    imageFormats: input.imageFormats || ['png'],
    intervalSeconds: Number(input.intervalSeconds ?? 2),
    polrUrl: input.polrUrl?.replace(/\/+$/, ''),
    outputImages: Boolean(input.outputImages || input.localImages),
  }
  if (options.respectGitignore && input.gitignorePath && !fs.existsSync(options.gitignorePath)) {
    throw new Error(`Gitignore file does not exist: ${options.gitignorePath}`)
  }
  if (options.interactiveLinks && !options.localImages) throw new Error('--interactive-links requires --local-images')
  if (options.polrUrl && !options.shouldShortenLinks) throw new Error('--polr-url cannot be combined with disabled shortening')
  if (options.polrUrl) {
    const polr = new URL(options.polrUrl)
    if (!validUrl(options.polrUrl) || polr.search || polr.hash) throw new Error('Polr URL must be an HTTP(S) base URL without credentials, query or fragment')
  }
  if (options.hotReload && (options.check || options.dryRun)) throw new Error('--check and --dry-run cannot be combined with --hot-reload')
  const server = new URL(options.pumlServerUrl)
  if (!validUrl(options.pumlServerUrl) || server.search || server.hash) {
    throw new Error('PlantUML server URL must be an HTTP(S) base URL without a query or fragment')
  }
  if (!Number.isFinite(options.intervalSeconds) || options.intervalSeconds <= 0 || options.intervalSeconds * 1000 > 2147483647) {
    throw new Error('interval-seconds must be a positive number no greater than 2147483')
  }
  if (!Array.isArray(options.imageFormats) || !options.imageFormats.length || options.imageFormats.some(f => !['svg', 'png'].includes(f))) {
    throw new Error('imageFormats must contain png and/or svg')
  }
  for (const key of ['rootDirectory', 'markdownDirectory', 'pumlDirectory']) {
    if (!fs.statSync(options[key]).isDirectory()) throw new Error(`Invalid ${key}: ${options[key]}`)
  }
  if (options.outputImages && (isWithin(options.distDirectory, rootDirectory) || isWithin(options.distDirectory, options.pumlDirectory))) {
    throw new Error('Image destination must not be the project or diagram directory, or an ancestor of either')
  }
  return options
}

// Walk native paths instead of constructing globs from Windows paths. Never follow symlinks.
function discover(directory, extension, options) {
  const baseRules = []
  if (options.respectGitignore && fs.existsSync(options.gitignorePath)) {
    baseRules.push({ base: options.rootDirectory, matcher: ignore().add(fs.readFileSync(options.gitignorePath, 'utf8')) })
  }
  const addRules = (dir, rules) => {
    const file = path.join(dir, '.gitignore')
    return options.respectGitignore && file !== options.gitignorePath && fs.existsSync(file)
      ? [...rules, { base: dir, matcher: ignore().add(fs.readFileSync(file, 'utf8')) }] : rules
  }
  const ignored = (file, isDirectory, rules) => {
    let result = false
    for (const { base, matcher } of rules) {
      if (!isWithin(base, file) || base === file) continue
      const match = matcher.test(posix(path.relative(base, file)) + (isDirectory ? '/' : ''))
      if (match.ignored) result = true
      else if (match.unignored) result = false
    }
    return result
  }
  let initialRules = baseRules
  if (isWithin(options.rootDirectory, directory) && directory !== options.rootDirectory) {
    let current = options.rootDirectory
    for (const part of path.relative(options.rootDirectory, directory).split(path.sep)) {
      initialRules = addRules(current, initialRules)
      current = path.join(current, part)
      if (ignored(current, true, initialRules)) return []
    }
  }
  const result = []
  function walk(dir, inherited) {
    const rules = addRules(dir, inherited)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name)) continue
      const file = path.join(dir, entry.name)
      if (file === options.distDirectory || ignored(file, entry.isDirectory(), rules)) continue
      if (entry.isDirectory()) walk(file, rules)
      else if (entry.isFile() && extension.test(entry.name)) result.push(file)
    }
  }
  walk(directory, initialRules)
  return result
}

async function buildDiagrams(files, options, cache) {
  const context = JSON.stringify([options.pumlServerUrl, options.polrUrl || null, hash(process.env.POLR_APIKEY || ""), options.shouldShortenLinks, !!options.localImages, !!options.interactiveLinks, localFormat(options)])
  let rebuilt = 0, reused = 0, unresolved = 0
  const known = new Set(files)
  const completed = new Map()
  const includedFiles = new Set()
  const linkedFiles = new Set()
  async function expand(file, chain, linkChain, owner, forRemote = false) {
    if (chain.includes(file)) throw new Error(`Circular include: ${[...chain, file].join(' -> ')}`)
    let data = fs.readFileSync(file, 'utf8')
    // Resolve hyperlinks before inlining so links retain their originating file's directory.
    const links = [...data.matchAll(/\$link\s*=\s*(["'])(.*?)\1/g)]
    for (const [match, , ref] of links) {
      if (/^[a-z][a-z\d+.-]*:/i.test(ref) || ref.startsWith('//') || !diagramExtension.test(ref)) continue
      const target = resolveReference(file, ref)
      if (!known.has(target)) throw new Error(`Missing or ignored diagram link "${ref}" in ${file}`)
      linkedFiles.add(target)
      const linked = await build(target, linkChain)
      const url = options.localImages && !forRemote
        ? relativeUrl(imagePath(owner, localFormat(options), options), imagePath(target, localFormat(options), options))
        : linked.url
      data = data.replaceAll(match, () => `$link="${url}"`)
    }
    const includes = [...data.matchAll(/^[ \t]*!include[ \t]+([^\r\n]+)(?=\r?$)/gm)]
    for (const [match, raw] of includes) {
      const ref = raw.trim().replace(/^"(.*)"$/, '$1')
      if (/^https?:\/\//i.test(ref) || ref.startsWith('<')) continue
      const target = resolveReference(file, ref)
      // Macro-based and remote includes remain for the PlantUML server to evaluate.
      if (!fs.existsSync(target)) {
        if (/^(?:\.{1,2}[\\/]|[\\/])/.test(ref)) throw new Error(`Missing include "${ref}" in ${file}`)
        continue
      }
      includedFiles.add(target)
      const expanded = await expand(target, [...chain, file], linkChain, owner, forRemote)
      data = data.replace(match, () => expanded)
    }
    return data
  }
  async function build(file, chain = []) {
    if (chain.includes(file)) throw new Error(`Circular diagram link: ${[...chain, file].join(' -> ')}`)
    if (completed.has(file)) return completed.get(file)
    const data = await expand(file, [], [...chain, file], file)
    const remoteData = options.localImages && options.interactiveLinks ? await expand(file, [], [...chain, file], file, true) : data
    const key = hash(context + JSON.stringify([data, remoteData]))
    const cached = cache.get('diagrams', key)
    let result
    if (cached && typeof cached.encodedData === 'string' && validUrl(cached.url)) {
      result = { data, ...cached }
      cache.set('diagrams', key, cached)
      reused++
    } else {
      rebuilt++
      const encodedData = encoder.encode(data)
      const url = fullUrl(options, 'svg', remoteData === data ? encodedData : encoder.encode(remoteData))
      const needsShortening = options.shouldShortenLinks && (!options.localImages || options.interactiveLinks)
      const readOnly = options.check || options.dryRun
      if (needsShortening && readOnly) unresolved++
      const resolved = needsShortening && !readOnly ? await shorten(url, options) : { url, cacheable: !needsShortening }
      result = { data, encodedData, url: resolved.url }
      if (resolved.cacheable) cache.set('diagrams', key, { encodedData, url: resolved.url })
    }
    completed.set(file, result)
    return result
  }
  for (const file of files) await build(file)
  for (const [file, diagram] of completed) diagram.includeOnly = includedFiles.has(file) && !linkedFiles.has(file)
  completed.stats = { rebuilt, reused, unresolved }
  return completed
}

// Retain source bytes, including CRLF, while protecting CommonMark code blocks and spans.
function replaceOutsideCode(source, replace) {
  const offsets = [0]
  for (const match of source.matchAll(/\n/g)) offsets.push(match.index + 1)
  const ranges = markdown.parse(source, {}).filter(token => ['fence', 'code_block'].includes(token.type))
    .map(token => [offsets[token.map[0]], offsets[token.map[1]] ?? source.length])
  function inline(text) {
    const runs = [...text.matchAll(/`+/g)]
    let output = '', cursor = 0
    for (let i = 0; i < runs.length; i++) {
      const open = runs[i]
      let close = i + 1
      while (close < runs.length && runs[close][0].length !== open[0].length) close++
      if (close === runs.length) continue
      const end = runs[close].index + runs[close][0].length
      output += replace(text.slice(cursor, open.index)) + text.slice(open.index, end)
      cursor = end
      i = close
    }
    return output + replace(text.slice(cursor))
  }
  let output = '', cursor = 0
  for (const [start, end] of ranges) {
    output += inline(source.slice(cursor, start)) + source.slice(start, end)
    cursor = end
  }
  return output + inline(source.slice(cursor))
}

function renderMarkdown(file, diagrams, options) {
  const original = fs.readFileSync(file, 'utf8')
  const updated = replaceOutsideCode(original, text => {
    const marker = /<!--[ \t]*(!?\[((?:\\.|[^\]\\\r\n])*)\])\(([^)\r\n]+\.(?:puml|plantuml))\)[ \t]*-->/gi
    let output = '', cursor = 0
    for (const match of text.matchAll(marker)) {
      const [comment, label, , ref] = match
      const diagram = diagrams.get(resolveReference(file, ref))
      if (!diagram) throw new Error(`Could not find diagram "${ref}" referenced by ${file}`)
      diagram.includeOnly = false
      let prefix = text.slice(cursor, match.index)
      // Only remove one immediately adjacent generated link, never earlier links on the line.
      prefix = prefix.replace(/(?:\[!\[(?:\\.|[^\]\\\r\n])*\]\([^()\r\n]*\)\]\([^()\r\n]*\)|!?\[(?:\\.|[^\[\]\\\r\n])*\]\([^()\r\n]*\))$/, '')
      const target = options.localImages ? relativeUrl(file, imagePath(resolveReference(file, ref), localFormat(options), options)) : diagram.url
      const link = label.startsWith('!') && (!options.localImages || options.interactiveLinks)
        ? `[${label}(${target})](${diagram.url})` : `${label}(${target})`
      output += prefix + link + comment
      cursor = match.index + comment.length
    }
    return output + text.slice(cursor)
  })
  return { file, original, updated }
}

function checkDestination(destination, options) {
  const boundary = isWithin(options.rootDirectory, options.distDirectory) ? options.rootDirectory : options.distDirectory
  let current = destination
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to export through symbolic link: ${current}`)
    }
    if (current === boundary) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

async function saveDiagrams(diagrams, options, cache) {
  const outputs = new Map()
  for (const [file, diagram] of diagrams) {
    // Includes containing only settings are not standalone diagrams.
    if (diagram.includeOnly || !/^\s*@start\w+/m.test(diagram.data)) continue
    if (!isWithin(options.rootDirectory, file)) throw new Error(`Cannot export a diagram outside root-directory: ${file}`)
    for (const format of options.imageFormats) {
      const destination = imagePath(file, format, options)
      checkDestination(destination, options)
      if (outputs.has(destination)) throw new Error(`Multiple diagrams would overwrite ${destination}`)
      outputs.set(destination, { diagram, format })
    }
  }
  const changed = []
  for (const [destination, { diagram, format }] of outputs) {
    const key = hash(JSON.stringify([posix(path.relative(options.rootDirectory, destination)), options.pumlServerUrl, format, diagram.encodedData]))
    const cached = cache.get('images', key)
    if (cached && fs.existsSync(destination) && cached.digest === hash(fs.readFileSync(destination))) {
      cache.set('images', key, cached)
      continue
    }
    changed.push(destination)
    if (options.check || options.dryRun) continue
    let buffer
    try {
      buffer = Buffer.from(await (await request(fullUrl(options, format, diagram.encodedData))).arrayBuffer())
    } catch (error) {
      throw new Error(`Failed to export ${destination}: ${error.message}`)
    }
    const valid = format === 'png'
      ? buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : /<svg[\s>]/i.test(buffer.toString('utf8'))
    if (!valid) throw new Error(`PlantUML server did not return a valid ${format} image for ${destination}`)
    // Never remove the output directory: it may contain unrelated user files.
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    checkDestination(destination, options)
    const mode = fs.existsSync(destination) ? fs.statSync(destination).mode & 0o777 : 0o666
    writeAtomic(destination, buffer, mode)
    cache.set('images', key, { digest: hash(buffer) })
  }
  return changed

}

async function runOnce(options) {
  const cache = loadCache(options)
  const mdPaths = discover(options.markdownDirectory, /\.md$/i, options)
  const pumlPaths = discover(options.pumlDirectory, diagramExtension, options)
  const diagrams = await buildDiagrams(pumlPaths, options, cache)
  // Validate all documents before writing images or Markdown.
  const updates = mdPaths.map(file => renderMarkdown(file, diagrams, options)).filter(item => item.original !== item.updated)
  const imageChanges = options.outputImages ? await saveDiagrams(diagrams, options, cache) : []
  const readOnly = options.check || options.dryRun
  for (const { file, updated } of updates) {
    if (!readOnly) fs.writeFileSync(file, updated)
    else console.info(`Would update Markdown: ${posix(path.relative(options.rootDirectory, file))}`)
  }
  if (readOnly) {
    for (const file of imageChanges) console.info(`Would render image: ${posix(path.relative(options.rootDirectory, file))}`)
    if (diagrams.stats.unresolved) console.info(`${diagrams.stats.unresolved} shortened URLs need generation; no network requests were made.`)
  }
  cache.save()
  const stale = updates.length + imageChanges.length + diagrams.stats.unresolved > 0
  console.info(`Processed ${pumlPaths.length} diagrams and ${mdPaths.length} Markdown files; ${readOnly ? 'would update' : 'updated'} ${updates.length}. Rebuilt ${diagrams.stats.rebuilt}; reused ${diagrams.stats.reused}.`)
  if (options.check) console.info(stale ? 'Documentation is out of date.' : 'Documentation is up to date.')
  return { stale, changed: updates.length, images: imageChanges.length, ...diagrams.stats }
}

module.exports = async function run(input = {}) {
  const options = normalizeOptions(input)
  if (!options.hotReload) return runOnce(options)
  do {
    try { await runOnce(options) } catch (error) { console.error(`ERROR: ${error.message}`) }
    await delay(options.intervalSeconds * 1000)
  } while (true)
}
