const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const encoder = require('plantuml-encoder')
const cli = path.resolve(__dirname, '../bin/index.js')

function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'puml-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), content)
  }
  return root
}
function run(root, args = []) {
  return spawnSync(process.execPath, [cli, '-t', '-x', root, ...args], { encoding: 'utf8', timeout: 5000 })
}
const diagram = '@startuml\nAlice -> Bob: hello\n@enduml\n'
const marker = '<!--![Diagram](a.puml)-->'
const read = root => fs.readFileSync(path.join(root, 'README.md'), 'utf8')

test('renders a valid URL and is idempotent', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  assert.equal(run(root).status, 0)
  const rendered = read(root)
  assert.ok(rendered.includes(`/svg/${encoder.encode(diagram)})`))
  assert.equal(run(root).status, 0)
  assert.equal(read(root), rendered)
})
test('preserves unrelated links and multiple diagram markers on one line', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': `[other](https://example.com) text ${marker} then ${marker}` })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).startsWith('[other](https://example.com) text '))
  assert.equal(read(root).split('/svg/').length - 1, 4)
})
test('reports missing references with a failed exit code without modifying markdown', t => {
  const root = fixture(t, { 'README.md': marker })
  assert.equal(run(root).status, 1)
  assert.equal(read(root), marker)
})
test('supports .plantuml files and whitespace around comment contents', t => {
  const root = fixture(t, { 'a.plantuml': diagram, 'README.md': '<!-- ![Diagram](a.plantuml) -->' })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).includes('/svg/'))
})
test('supports relative root-directory paths', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  assert.equal(run(path.relative(process.cwd(), root)).status, 0)
  assert.ok(read(root).includes('/svg/'))
})
test('honors gitignore negation and anchored paths', t => {
  const root = fixture(t, { '.gitignore': '*.puml\n!a.puml\n/ignored/\n', 'a.puml': diagram, 'README.md': marker, 'ignored/bad.md': '<!--[Bad](missing.puml)-->' })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).includes('/svg/'))
})
test('leaves fenced and inline code untouched', t => {
  const code = ['```md\n'+marker+'\n```', '~~~~md\n'+marker+'\n~~~~', '``inline ` '+marker+'``', '    '+marker, '```md\n'+marker].join('\n\n')
  const root = fixture(t, { 'a.puml': diagram, 'README.md': code })
  assert.equal(run(root).status, 0)
  assert.equal(read(root), code)
})
test('detects circular diagram links with a useful error', t => {
  const root = fixture(t, { 'a.puml': '$link="b.puml"', 'b.puml': '$link="a.puml"', 'README.md': marker })
  const result = run(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /circular|cycle/i)
  assert.doesNotMatch(result.stderr, /maximum call stack/i)
})
test('preserves external diagram hyperlinks', t => {
  const source = '@startuml\ncomponent A $link="https://example.com"\n@enduml'
  const root = fixture(t, { 'a.puml': source, 'README.md': marker })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).includes(encoder.encode(source)))
})
test('expands nested includes relative to the including file', t => {
  const root = fixture(t, { 'a.puml': '@startuml\n!include parts/b.iuml\n@enduml', 'parts/b.iuml': '!include c.iuml', 'parts/c.iuml': 'Alice -> Bob', 'README.md': marker })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).includes(encoder.encode('@startuml\nAlice -> Bob\n@enduml')))
})
test('validates all markdown before writing any of it', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, 'z.md': '<!--[Missing](missing.puml)-->' })
  assert.equal(run(root).status, 1)
  assert.equal(read(root), marker)
})
test('rejects invalid watch intervals', t => {
  const root = fixture(t)
  const result = run(root, ['--hot-reload', '--interval-seconds', 'oops'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /interval/i)
})

test('reruns preserve preceding links, prose, and multiple generated diagrams', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': `[other](https://example.com) text ${marker} then ${marker}` })
  assert.equal(run(root).status, 0)
  const first = read(root)
  assert.equal(run(root).status, 0)
  assert.equal(read(root), first)
})
test('can change a generated image to a link and edit its label', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  assert.equal(run(root).status, 0)
  fs.writeFileSync(path.join(root, 'README.md'), read(root).replace(marker, '<!--[New name](a.puml)-->'))
  assert.equal(run(root).status, 0)
  assert.ok(read(root).startsWith('[New name](https://'))
  assert.ok(!read(root).includes('Diagram'))
})
test('nested gitignore and subdirectory scanning retain root rules', t => {
  const root = fixture(t, { '.gitignore': 'skip.md\n', 'docs/.gitignore': 'bad.md\n', 'docs/a.puml': diagram, 'docs/README.md': marker, 'docs/bad.md': '<!--[Bad](missing.puml)-->', 'docs/skip.md': '<!--[Bad](missing.puml)-->' })
  assert.equal(run(root, ['-m', path.join(root, 'docs')]).status, 0)
  assert.ok(fs.readFileSync(path.join(root, 'docs/README.md'), 'utf8').includes('/svg/'))
})
test('ignore-gitignore opts back into ignored files', t => {
  const root = fixture(t, { '.gitignore': '*.puml\n', 'a.puml': diagram, 'README.md': marker })
  assert.equal(run(root, ['-g']).status, 0)
  assert.ok(read(root).includes('/svg/'))
})
test('custom missing gitignore reports an error', t => {
  const root = fixture(t)
  assert.equal(run(root, ['-i', path.join(root, 'missing')]).status, 1)
})
test('normalizes backslash references', t => {
  const root = fixture(t, { 'puml/a.puml': diagram, 'README.md': '<!--![Diagram](.\\puml\\a.puml)-->' })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).includes('/svg/'))
})
test('detects recursive includes', t => {
  const root = fixture(t, { 'a.puml': '!include b.iuml', 'b.iuml': '!include a.puml', 'README.md': marker })
  const result = run(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /circular include/i)
})
test('resolves links in included files relative to the include', t => {
  const root = fixture(t, { 'a.puml': '!include parts/b.iuml', 'parts/b.iuml': '$link="c.puml"', 'parts/c.puml': diagram, 'README.md': marker })
  assert.equal(run(root).status, 0)
  const linked = `https://www.plantuml.com/plantuml/svg/${encoder.encode(diagram)}`
  assert.ok(read(root).includes(encoder.encode(`$link="${linked}"`)))
})
test('missing local diagram links fail rather than becoming undefined', t => {
  const root = fixture(t, { 'a.puml': '$link="missing.puml"', 'README.md': marker })
  const result = run(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing.*diagram link/i)
})
test('custom server trailing slash is normalized', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  assert.equal(run(root, ['-s', 'https://example.com/plantuml/']).status, 0)
  assert.ok(read(root).includes('https://example.com/plantuml/svg/'))
})
test('preserves CRLF and leaves unchanged documents untouched', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': '# Hello\r\n\r\n'+marker+'\r\n' })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).startsWith('# Hello\r\n\r\n'))
  const file = path.join(root, 'README.md')
  fs.utimesSync(file, new Date(1000000000000), new Date(1000000000000))
  assert.equal(run(root).status, 0)
  assert.equal(fs.statSync(file).mtimeMs, 1000000000000)
})

const { spawn } = require('node:child_process')
const http = require('node:http')
function runAsync(root, args = [], extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '-t', '-x', root, ...args], extra)
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', status => resolve({ status, stdout, stderr }))
  })
}
async function server(t, handler) {
  const instance = http.createServer(handler)
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve) }))
  return `http://127.0.0.1:${instance.address().port}`
}
test('exports PNG and SVG without deleting unrelated files', async t => {
  const requested = []
  const url = await server(t, (req, res) => {
    requested.push(req.url)
    res.end(req.url.startsWith('/svg/') ? '<svg xmlns="http://www.w3.org/2000/svg"></svg>' : Buffer.from('89504e470d0a1a0a', 'hex'))
  })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, 'dist_puml/keep.txt': 'KEEP' })
  const result = await runAsync(root, ['-s', url, '-d', '-f', 'both'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(path.join(root, 'dist_puml/keep.txt'), 'utf8'), 'KEEP')
  assert.match(fs.readFileSync(path.join(root, 'dist_puml/a.svg'), 'utf8'), /<svg/)
  assert.equal(fs.readFileSync(path.join(root, 'dist_puml/a.png')).subarray(0, 4).toString('hex'), '89504e47')
  assert.equal(requested.length, 2)
  assert.ok(requested.every(url => !url.includes('}')))
})
test('HTTP image failure leaves markdown and existing image intact', async t => {
  const url = await server(t, (req, res) => { res.writeHead(500); res.end('failure') })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, 'dist_puml/a.png': 'OLD' })
  const result = await runAsync(root, ['-s', url, '-d'])
  assert.equal(result.status, 1)
  assert.equal(read(root), marker)
  assert.equal(fs.readFileSync(path.join(root, 'dist_puml/a.png'), 'utf8'), 'OLD')
})
test('rejects unsafe image destinations before writing anything', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const result = run(root, ['-d', '-b', root])
  assert.equal(result.status, 1)
  assert.equal(read(root), marker)
  assert.equal(fs.readFileSync(path.join(root, 'a.puml'), 'utf8'), diagram)
})
test('shortener failure falls back to direct URL with a warning', async t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, 'mock.cjs': "global.fetch = async () => { throw new Error('simulated offline') }" })
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--require', path.join(root, 'mock.cjs'), cli, '-x', root])
    let stderr = ''
    child.stderr.on('data', data => { stderr += data })
    child.on('exit', status => resolve({ status, stderr }))
  })
  assert.equal(result.status, 0)
  assert.match(result.stderr, /shortening failed/)
  assert.ok(read(root).includes('/svg/'))
})
test('watch processes immediately and updates after an edit', async t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const child = spawn(process.execPath, [cli, '-t', '-x', root, '-r', '-v', '0.05'])
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve))
      child.kill(); await exited
    }
  })
  let output = ''
  child.stdout.on('data', data => { output += data })
  const waitFor = async predicate => {
    const deadline = Date.now() + 4000
    while (!predicate()) {
      if (Date.now() > deadline) assert.fail('watch timed out: '+output)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  await waitFor(() => read(root).includes('/svg/'))
  const changed = diagram.replace('hello', 'changed')
  fs.writeFileSync(path.join(root, 'a.puml'), changed)
  await waitFor(() => read(root).includes(encoder.encode(changed)))
})

test('rejects HTML returned as a successful image download', async t => {
  const url = await server(t, (req, res) => res.end('<html>Login required</html>'))
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const result = await runAsync(root, ['-s', url, '-d'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /valid png/)
  assert.equal(read(root), marker)
})
test('rejects colliding output filenames', t => {
  const root = fixture(t, { 'a.puml': diagram, 'a.plantuml': diagram, 'README.md': marker })
  const result = run(root, ['-d'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /overwrite/)
})
test('does not follow directory symlinks during export', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, 'outside/keep.txt': 'KEEP' })
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'dist_puml'), 'junction')
  const result = run(root, ['-d'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /symbolic link/)
  assert.deepEqual(fs.readdirSync(path.join(root, 'outside')), ['keep.txt'])
})

test('does not export files used only as includes even with start directives', async t => {
  let requests = 0
  const url = await server(t, (req, res) => { requests++; res.end('<svg xmlns="http://www.w3.org/2000/svg"></svg>') })
  const root = fixture(t, { 'a.puml': '@startuml\n!include styles.puml\nAlice -> Bob\n@enduml', 'styles.puml': '@startuml\nskinparam backgroundColor white\n@enduml', 'README.md': marker })
  assert.equal((await runAsync(root, ['-s', url, '-d', '-f', 'svg'])).status, 0)
  assert.equal(requests, 1)
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist_puml')), ['a.svg'])
})

test('local PNG links are relative to nested Markdown and encode spaces', async t => {
  const url = await server(t, (req, res) => res.end(Buffer.from('89504e470d0a1a0a', 'hex')))
  const root = fixture(t, { 'puml/a.puml': diagram, 'docs/README.md': '<!--![Diagram](../puml/a.puml)-->' })
  const args = ['--local-images', '-b', path.join(root, 'my images'), '-s', url]
  assert.equal((await runAsync(root, args)).status, 0)
  const file = path.join(root, 'docs/README.md')
  const first = fs.readFileSync(file, 'utf8')
  assert.equal(first, '![Diagram](../my%20images/puml/a.png)<!--![Diagram](../puml/a.puml)-->')
  assert.equal((await runAsync(root, args)).status, 0)
  assert.equal(fs.readFileSync(file, 'utf8'), first)
})
test('local SVG cross-links resolve relative to the owner diagram, including included links', async t => {
  const sources = []
  const url = await server(t, (req, res) => { sources.push(encoder.decode(req.url.split('/').pop())); res.end('<svg></svg>') })
  const root = fixture(t, {
    'a.puml': '@startuml\n!include parts/link.iuml\n@enduml',
    'parts/link.iuml': '$link="nested/b.puml"',
    'parts/nested/b.puml': diagram,
    'README.md': marker,
  })
  const args = ['--local-images', '-f', 'svg', '-s', url]
  assert.equal((await runAsync(root, args)).status, 0)
  assert.ok(sources.some(s => s.includes('$link="parts/nested/b.svg"')))
  assert.ok(read(root).startsWith('![Diagram](dist_puml/a.svg)'))
  assert.equal((await runAsync(root, [...args, '--check'])).status, 0)
})
test('read-only modes never write files or contact the network', async t => {
  let requests = 0
  const url = await server(t, (req, res) => { requests++; res.end('<svg></svg>') })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const args = ['--local-images', '-f', 'svg', '-s', url]
  const dry = await runAsync(root, [...args, '--dry-run'])
  assert.equal(dry.status, 0)
  assert.match(dry.stdout, /Would update Markdown: README.md/)
  assert.match(dry.stdout, /Would render image: dist_puml\/a.svg/)
  assert.equal((await runAsync(root, [...args, '--check'])).status, 1)
  assert.equal(requests, 0)
  assert.equal(read(root), marker)
  assert.deepEqual(fs.readdirSync(root).sort(), ['README.md', 'a.puml'])
})
test('check detects edited source with no writes, then passes after generation', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  assert.equal(run(root).status, 0)
  assert.equal(run(root, ['--check']).status, 0)
  const original = read(root)
  const cached = fs.readFileSync(path.join(root, '.puml-cache.json'), 'utf8')
  fs.writeFileSync(path.join(root, 'a.puml'), diagram.replace('hello', 'changed'))
  assert.equal(run(root, ['--check']).status, 1)
  assert.equal(read(root), original)
  assert.equal(fs.readFileSync(path.join(root, '.puml-cache.json'), 'utf8'), cached)
  assert.equal(run(root).status, 0)
  assert.equal(run(root, ['--check']).status, 0)
})
test('cache avoids duplicate renders and repairs missing or modified output', async t => {
  let requests = 0
  const url = await server(t, (req, res) => { requests++; res.end('<svg></svg>') })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const args = ['--local-images', '-f', 'svg', '-s', url]
  assert.equal((await runAsync(root, args)).status, 0)
  assert.equal((await runAsync(root, args)).status, 0)
  assert.equal(requests, 1)
  const image = path.join(root, 'dist_puml/a.svg')
  fs.unlinkSync(image)
  assert.equal((await runAsync(root, [...args, '--check'])).status, 1)
  assert.equal(requests, 1)
  assert.equal((await runAsync(root, args)).status, 0)
  fs.writeFileSync(image, 'modified')
  assert.equal((await runAsync(root, args)).status, 0)
  assert.equal(requests, 3)
  assert.equal((await runAsync(root, [...args, '--no-cache'])).status, 0)
  assert.equal(requests, 4)
})
test('include edits rebuild affected diagrams, leaving unrelated images cached', async t => {
  const sources = []
  const url = await server(t, (req, res) => { sources.push(encoder.decode(req.url.split('/').pop())); res.end('<svg></svg>') })
  const root = fixture(t, { 'a.puml': '@startuml\n!include style.iuml\nAlice -> Bob\n@enduml', 'style.iuml': 'skinparam backgroundColor white', 'b.puml': diagram, 'README.md': marker })
  const args = ['--local-images', '-f', 'svg', '-s', url]
  assert.equal((await runAsync(root, args)).status, 0)
  assert.equal(sources.length, 2)
  fs.writeFileSync(path.join(root, 'style.iuml'), 'skinparam backgroundColor yellow')
  const result = await runAsync(root, args)
  assert.equal(result.status, 0)
  assert.equal(sources.length, 3)
  assert.match(sources[2], /yellow/)
  assert.match(result.stdout, /Rebuilt 1; reused 1/)
})
function providerRun(root, args, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '-x', root, ...args], extra)
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', status => resolve({ status, stdout, stderr }))
  })
}

test('Polr uses POST with an encoded URL and key, and cached checks make no requests', async t => {
  let requests = 0
  const url = await server(t, (req, res) => {
    requests++
    assert.equal(req.url, '/private/api/v2/action/shorten')
    assert.equal(req.method, 'POST')
    let body = ''
    req.on('data', data => { body += data })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      assert.equal(params.get('key'), 'test-key-not-a-real-secret')
      assert.equal(params.get('url'), `https://www.plantuml.com/plantuml/svg/${encoder.encode(diagram)}`)
      res.end(JSON.stringify({ result: 'https://private.example/diagram' }))
    })
  })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const args = ['--polr-url', url+'/private/']
  const extra = { env: { ...process.env, POLR_APIKEY: 'test-key-not-a-real-secret' } }
  assert.equal((await providerRun(root, args, extra)).status, 0)
  assert.equal((await providerRun(root, args, extra)).status, 0)
  assert.equal((await providerRun(root, [...args, '--check'], extra)).status, 0)
  assert.equal(requests, 1)
  assert.ok(read(root).includes('https://private.example/diagram'))
  assert.ok(!fs.readFileSync(path.join(root, '.puml-cache.json'), 'utf8').includes('test-key-not-a-real-secret'))
})
test('a failed private shortener falls back to direct URL without leaking its response', async t => {
  const url = await server(t, (req, res) => { res.writeHead(401); res.end('sensitive error body') })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const result = await providerRun(root, ['--polr-url', url])
  assert.equal(result.status, 0)
  assert.match(result.stderr, /Polr request failed/)
  assert.doesNotMatch(result.stderr, /sensitive/)
  assert.ok(read(root).includes('/svg/'))
})
test('uncached shortener check is offline and reports unresolved work', async t => {
  let requests = 0
  const url = await server(t, (req, res) => { requests++; res.end('https://example.com/d') })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const result = await providerRun(root, ['--polr-url', url, '--check'])
  assert.equal(result.status, 1)
  assert.equal(requests, 0)
  assert.match(result.stdout, /shortened URLs need generation/)
  assert.equal(read(root), marker)
  assert.ok(!fs.existsSync(path.join(root, '.puml-cache.json')))
})
test('local images bypass shortening unless interactive links are requested', async t => {
  const requests = []
  const url = await server(t, (req, res) => { requests.push(req.url); res.end('<svg></svg>') })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  assert.equal((await providerRun(root, ['--local-images', '-f', 'svg', '-s', url, '--polr-url', url])).status, 0)
  assert.equal(requests.length, 1)
  assert.match(requests[0], /^\/svg\//)
})
test('interactive preview uses local SVG links and a separate working remote source', async t => {
  const downloaded = []
  const url = await server(t, (req, res) => { downloaded.push(encoder.decode(req.url.split('/').pop())); res.end('<svg></svg>') })
  const root = fixture(t, { 'a.puml': '@startuml\ncomponent A $link="b.puml"\n@enduml', 'b.puml': diagram, 'README.md': marker })
  assert.equal((await runAsync(root, ['--local-images', '--interactive-links', '-f', 'svg', '-s', url])).status, 0)
  assert.ok(read(root).startsWith('[![Diagram](dist_puml/a.svg)]('))
  assert.ok(downloaded.some(s => s.includes('$link="b.svg"')))
  const remote = read(root).match(/\]\((http[^)]+)\)/)[1]
  const source = encoder.decode(remote.split('/').pop())
  assert.ok(source.includes(`$link="${url}/svg/${encoder.encode(diagram)}"`))
})
test('custom shortener-url supports prefix and {url} template, caches by endpoint, and hides failure bodies', async t => {
  const requests = []
  const url = await server(t, (req, res) => {
    requests.push(req.url)
    if (req.url.startsWith('/fail')) { res.writeHead(500); res.end('secret internal error'); return }
    res.end(`https://short.example/r/${requests.length}\n`)
  })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const expectedTarget = encodeURIComponent(`https://www.plantuml.com/plantuml/svg/${encoder.encode(diagram)}`)
  assert.equal((await providerRun(root, ['--shortener-url', `${url}/s?url=`])).status, 0)
  assert.equal(requests.length, 1)
  assert.equal(requests[0], `/s?url=${expectedTarget}`)
  assert.ok(read(root).includes('https://short.example/r/1'))
  assert.equal((await providerRun(root, ['--shortener-url', `${url}/s?url=`, '--check'])).status, 0)
  assert.equal(requests.length, 1)

  // Changing shortener-url invalidates the cache entry and uses {url} placeholder when present.
  assert.equal((await providerRun(root, ['--shortener-url', `${url}/t?target={url}&format=text`])).status, 0)
  assert.equal(requests.length, 2)
  assert.equal(requests[1], `/t?target=${expectedTarget}&format=text`)
  assert.ok(read(root).includes('https://short.example/r/2'))

  // A failed custom shortener falls back to the direct URL without leaking response body.
  const failed = await providerRun(root, ['--shortener-url', `${url}/fail?url=`])
  assert.equal(failed.status, 0)
  assert.match(failed.stderr, /Shortener request failed/)
  assert.doesNotMatch(failed.stderr, /secret/)
  assert.ok(read(root).includes('/svg/'))
})
test('invalid mode combinations fail before writing', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  for (const args of [
    ['--interactive-links'],
    ['--check', '-r'],
    ['--dry-run', '-r'],
    ['--polr-url', 'https://example.com'],
    ['--shortener-url', 'https://example.com/s?url='],
    ['--polr-url', 'https://example.com', '--shortener-url', 'https://example.com/s?url=', '-t'],
    ['--shortener-url', 'ftp://example.com/s?url='],
    ['--shortener-url', 'https://user:pass@example.com/s?url='],
    ['--shortener-url', 'https://example.com/s?url=#frag'],
  ]) {
    assert.equal(run(root, args).status, 1)
  }
  assert.equal(assert.equal(spawnSync(process.execPath, [cli, '-x', root, '--polr-url', 'https://example.com', '--shortener-url', 'https://example.com/s?url='], { encoding: 'utf8' }).status, 1), undefined)
  assert.equal(read(root), marker)
})

test('nested ignore files work even without a root gitignore', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, 'docs/.gitignore': 'bad.md', 'docs/bad.md': '<!--[missing](missing.puml)-->' })
  assert.equal(run(root).status, 0)
  assert.ok(read(root).includes('/svg/'))
})
test('child diagram edits invalidate the remote parent but not unrelated diagrams', async t => {
  let requests = 0
  const url = await server(t, (req, res) => { requests++; res.end('<svg></svg>') })
  const root = fixture(t, { 'a.puml': '@startuml\ncomponent A $link="b.puml"\n@enduml', 'b.puml': diagram, 'c.puml': '@startuml\nA -> B\n@enduml', 'README.md': marker })
  const args = ['-d', '-f', 'svg', '-s', url]
  assert.equal((await runAsync(root, args)).status, 0)
  assert.equal(requests, 3)
  fs.writeFileSync(path.join(root, 'b.puml'), diagram.replace('hello', 'changed'))
  const result = await runAsync(root, args)
  assert.equal(result.status, 0)
  assert.equal(requests, 5)
  assert.match(result.stdout, /Rebuilt 2; reused 1/)
})
test('Polr accepts complete chunked plain text and retries malformed responses', async t => {
  let requests = 0
  const url = await server(t, (req, res) => {
    requests++
    if (requests === 1) { res.end('<html>not a URL</html>'); return }
    res.write('https://private.example/')
    setTimeout(() => res.end('complete-link'), 10)
  })
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const args = ['--polr-url', url]
  assert.equal((await providerRun(root, args)).status, 0)
  assert.ok(read(root).includes('/svg/'))
  assert.equal((await providerRun(root, args)).status, 0)
  assert.ok(read(root).includes('https://private.example/complete-link'))
  assert.equal(requests, 2)
})
test('corrupt cache recovers without changing output and no-cache does not write cache', t => {
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker, '.puml-cache.json': '{broken' })
  const result = run(root)
  assert.equal(result.status, 0)
  assert.match(result.stderr, /Ignoring unreadable/)
  const saved = fs.readFileSync(path.join(root, '.puml-cache.json'), 'utf8')
  const rendered = read(root)
  assert.equal(run(root, ['--no-cache']).status, 0)
  assert.equal(read(root), rendered)
  assert.equal(fs.readFileSync(path.join(root, '.puml-cache.json'), 'utf8'), saved)
})

test('issue #10: the supplied Visual Studio gitignore does not hide all diagrams', t => {
  const patterns = fs.readFileSync(path.join(__dirname, 'fixtures/visualstudio.gitignore'), 'utf8')
  const root = fixture(t, { '.gitignore': patterns, 'a.puml': diagram, 'README.md': marker, 'Debug/bad.md': '<!--[Bad](missing.puml)-->' })
  const result = run(root)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(read(root).includes('/svg/'))
})
test('issue #6: nested native paths and whitespace in comments find the diagram', t => {
  const root = fixture(t, { 'docs/puml/a.puml': diagram, 'docs/01-context.md': '<!--![TimespendLapse](./puml/a.puml) -->' })
  const result = run(root, ['-m', path.join(root, 'docs')])
  assert.equal(result.status, 0, result.stderr)
  assert.match(fs.readFileSync(path.join(root, 'docs/01-context.md'), 'utf8'), /\/svg\//)
})

test('exported images use normal permissions and preserve existing modes; cache stays private', { skip: process.platform === 'win32' }, async t => {
  const url = await server(t, (req, res) => res.end('<svg></svg>'))
  const root = fixture(t, { 'a.puml': diagram, 'README.md': marker })
  const args = ['--local-images', '-f', 'svg', '-s', url]
  assert.equal((await runAsync(root, args)).status, 0)
  const image = path.join(root, 'dist_puml/a.svg')
  assert.equal(fs.statSync(image).mode & 0o777, 0o666 & ~process.umask())
  assert.equal(fs.statSync(path.join(root, '.puml-cache.json')).mode & 0o777, 0o600 & ~process.umask())
  fs.chmodSync(image, 0o640)
  assert.equal((await runAsync(root, [...args, '--no-cache'])).status, 0)
  assert.equal(fs.statSync(image).mode & 0o777, 0o640 & ~process.umask())
})
