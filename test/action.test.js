const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { splitArgs, checkArgs } = require('../action/run')
const runner = path.resolve(__dirname, '../action/run.js')

const diagram = '@startuml\nAlice -> Bob: hello\n@enduml\n'
const marker = '<!--![Diagram](a.puml)-->\n'
// Keep tests independent of the developer's git settings and of the GIT_* variables
// (author, index file) that git exports when the suite runs from a pre-commit hook.
const isolated = base => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: path.join(base, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
})

function git(base, cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: isolated(base) })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trimEnd()
}

// A checkout with a bare origin, as actions/checkout leaves it.
function repo(t, files = { 'a.puml': diagram, 'README.md': marker }) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'puml-action-')))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const origin = path.join(base, 'origin.git'), work = path.join(base, 'work')
  git(base, base, 'init', '--quiet', '--bare', '-b', 'main', origin)
  git(base, base, 'init', '--quiet', '-b', 'main', work)
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, name)), { recursive: true })
    fs.writeFileSync(path.join(work, name), content)
  }
  git(base, work, 'add', '-A')
  git(base, work, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'init')
  git(base, work, 'remote', 'add', 'origin', origin)
  git(base, work, 'push', '--quiet', 'origin', 'main')
  return { base, origin, work, git: (...args) => git(base, work, ...args) }
}

function parseOutputs(text) {
  const outputs = {}
  for (const [, name, , value] of text.matchAll(/^([\w-]+)<<(PUML_[\w-]+)\n([\s\S]*?)\n\2\n/gm)) outputs[name] = value
  return outputs
}

// Async so tests can serve images from this process while the action runs.
function action({ base, work }, inputs = {}) {
  const output = path.join(base, 'github-output'), summary = path.join(base, 'step-summary')
  fs.writeFileSync(output, '')
  fs.writeFileSync(summary, '')
  const env = { ...isolated(base), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, PUML_ARGS: '-t', ...inputs }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], { cwd: work, env })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => child.kill(), 15000)
    child.on('error', reject)
    child.on('close', status => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr, outputs: parseOutputs(fs.readFileSync(output, 'utf8')), summary: fs.readFileSync(summary, 'utf8') })
    })
  })
}

test('update commits only the regenerated Markdown, pushes it, and is idempotent', async t => {
  const r = repo(t)
  const result = await action(r, { PUML_MODE: 'update' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.outputs.changed, 'true')
  assert.equal(result.outputs.files, 'README.md')
  assert.equal(result.outputs.commit, r.git('rev-parse', 'HEAD'))
  assert.equal(git(r.base, r.origin, 'rev-parse', 'main'), result.outputs.commit)
  assert.equal(r.git('show', '--name-only', '--format=', 'HEAD'), 'README.md')
  assert.equal(r.git('log', '-1', '--format=%an <%ae> %s'), 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> Update PlantUML diagrams')
  assert.match(fs.readFileSync(path.join(r.work, 'README.md'), 'utf8'), /\/svg\//)
  assert.match(result.summary, /Updated PlantUML diagrams/)

  const again = await action(r, { PUML_MODE: 'update' })
  assert.equal(again.status, 0)
  assert.equal(again.outputs.changed, 'false')
  assert.equal(again.outputs.commit, '')
  assert.equal(r.git('rev-parse', 'HEAD'), result.outputs.commit)
})

test('update leaves earlier modified and staged files out of its commit', async t => {
  const r = repo(t, { 'a.puml': diagram, 'README.md': marker, 'notes.txt': 'one\n' })
  fs.writeFileSync(path.join(r.work, 'notes.txt'), 'two\n')
  fs.writeFileSync(path.join(r.work, 'staged.txt'), 'staged\n')
  r.git('add', 'staged.txt')
  const result = await action(r, { PUML_MODE: 'update', PUML_COMMIT_MESSAGE: 'Refresh diagrams' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(r.git('show', '--name-only', '--format=%s', 'HEAD'), 'Refresh diagrams\n\nREADME.md')
  const status = r.git('status', '--porcelain')
  assert.match(status, /^ M notes\.txt$/m)
  assert.match(status, /^A  staged\.txt$/m)
})

test('check fails on stale docs without committing, then passes once they are current', async t => {
  const r = repo(t)
  const head = r.git('rev-parse', 'HEAD')
  const stale = await action(r, { PUML_MODE: 'check' })
  assert.equal(stale.status, 1)
  assert.match(stale.stdout, /::error::Diagrams are out of date in 1 file\(s\): README\.md\. Run "npx puml-for-markdown -t"/)
  assert.equal(stale.outputs.changed, 'true')
  assert.match(stale.summary, /out of date/)
  assert.equal(r.git('rev-parse', 'HEAD'), head)

  // Each workflow run starts from a clean checkout.
  r.git('checkout', '--', 'README.md')
  assert.equal((await action(r, { PUML_MODE: 'update' })).status, 0)
  const current = await action(r, { PUML_MODE: 'check' })
  assert.equal(current.status, 0, current.stdout + current.stderr)
  assert.equal(current.outputs.changed, 'false')

  fs.writeFileSync(path.join(r.work, 'a.puml'), diagram.replace('hello', 'hi'))
  assert.equal((await action(r, { PUML_MODE: 'check' })).status, 1)
})

test('commit false reports changes without committing them', async t => {
  const r = repo(t)
  const head = r.git('rev-parse', 'HEAD')
  const result = await action(r, { PUML_COMMIT: 'false' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.outputs.changed, 'true')
  assert.equal(result.outputs.commit, '')
  assert.equal(r.git('rev-parse', 'HEAD'), head)
  assert.match(r.git('status', '--porcelain'), /^ M README\.md$/m)
})

test('new image files in a project subdirectory are committed', async t => {
  const r = repo(t, { 'docs/a.puml': diagram, 'docs/README.md': marker, 'other/README.md': '<!--[Missing](nothing.puml)-->' })
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('image')])
  const server = http.createServer((req, res) => res.end(png))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.address().port}`
  const result = await action(r, { PUML_ROOT_DIRECTORY: 'docs', PUML_ARGS: `-t -d -s ${url}` })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.outputs.files, 'docs/README.md\ndocs/dist_puml/a.png')
  assert.equal(r.git('show', '--name-only', '--format=', 'HEAD'), 'docs/README.md\ndocs/dist_puml/a.png')
  assert.match(r.git('status', '--porcelain', '--untracked-files=all'), /^\?\? docs\/\.puml-cache\.json$/m)
})

test('a detached HEAD or failed push stops with a useful error', async t => {
  const r = repo(t)
  r.git('checkout', '--quiet', '--detach')
  const detached = await action(r)
  assert.equal(detached.status, 1)
  assert.match(detached.stdout, /::error::Cannot commit from a detached HEAD/)

  r.git('checkout', '--quiet', '--force', 'main')
  r.git('remote', 'remove', 'origin')
  const offline = await action(r)
  assert.equal(offline.status, 1)
  assert.match(offline.stdout, /::error::Committed [0-9a-f]{7} but could not push to main/)
})

test('invalid inputs fail before running the CLI', async t => {
  const r = repo(t)
  for (const [inputs, message] of [
    [{ PUML_MODE: 'deploy' }, /mode must be update or check/],
    [{ PUML_COMMIT: 'yes' }, /commit must be true or false/],
    [{ PUML_ARGS: '--check' }, /Do not pass --check in args; use mode: check/],
    [{ PUML_ROOT_DIRECTORY: 'missing' }, /root-directory does not exist/],
  ]) {
    const result = await action(r, inputs)
    assert.equal(result.status, 1)
    assert.match(result.stdout, message)
  }
  assert.equal(r.git('status', '--porcelain'), '')
})

test('a project outside a git repository is rejected', async t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'puml-action-')))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  fs.writeFileSync(path.join(base, 'README.md'), marker)
  const result = await action({ base, work: base }, { GIT_CEILING_DIRECTORIES: path.dirname(base) })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /not inside a git repository/)
})

test('action.yml description fits the GitHub Marketplace limit', () => {
  const metadata = fs.readFileSync(path.resolve(__dirname, '../action.yml'), 'utf8')
  const description = /^description: (.+)$/m.exec(metadata)[1]
  assert.ok(description.length < 125, `${description.length} characters`)
})

test('args split like a shell without evaluating, and owned options are refused', () => {
  assert.deepEqual(splitArgs(` --dist-directory "docs/my images" -f 'svg'  C:\\out "say \\"hi\\"" '' `),
    ['--dist-directory', 'docs/my images', '-f', 'svg', 'C:\\out', 'say "hi"', ''])
  assert.deepEqual(splitArgs('$(touch pwned) `id`'), ['$(touch', 'pwned)', '`id`'])
  assert.throws(() => splitArgs('"open'), /unterminated quote/)
  for (const args of [['--dry-run'], ['-x', 'docs'], ['--root-directory=docs'], ['-dr'], ['--hot-reload']]) {
    assert.throws(() => checkArgs(args), /Do not pass/)
  }
  assert.doesNotThrow(() => checkArgs(['-d', '-t', '-f', 'svg', '--local-images', '-dt']))
})
