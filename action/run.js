// GitHub Action entry point. Runs the CLI, then commits what it changed (update)
// or fails when the committed documentation is out of date (check).
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')

const cli = path.resolve(__dirname, '../bin/index.js')
const botName = 'github-actions[bot]'
const botEmail = '41898282+github-actions[bot]@users.noreply.github.com'

// Split CLI options like a shell would, without evaluating anything. Backslashes are
// literal (Windows paths) except before a quote or backslash inside double quotes.
function splitArgs(value = '') {
  const args = []
  let current = '', quote = null, started = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (quote) {
      if (c === quote) quote = null
      else if (quote === '"' && c === '\\' && ['"', '\\'].includes(value[i + 1])) current += value[++i]
      else current += c
    } else if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (/\s/.test(c)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += c
      started = true
    }
  }
  if (quote) throw new Error('args has an unterminated quote')
  if (started) args.push(current)
  return args
}

// The action owns these options: it sets the root itself, and it must generate for real.
function checkArgs(args) {
  const owned = {
    '-x': 'root-directory input', '--root-directory': 'root-directory input',
    '--check': 'mode: check', '--dry-run': 'mode: check',
    '-r': 'a separate workflow run', '--hot-reload': 'a separate workflow run',
  }
  for (const arg of args) {
    const name = arg.split('=')[0]
    if (owned[name]) throw new Error(`Do not pass ${name} in args; use ${owned[name]} instead`)
    // Combined short flags such as -dx.
    const short = /^-([A-Za-z]{2,})$/.exec(arg)
    for (const flag of short ? short[1] : '') {
      if (owned[`-${flag}`]) throw new Error(`Do not pass -${flag} in args; use ${owned[`-${flag}`]} instead`)
    }
  }
}

function parseInputs(env) {
  const mode = (env.PUML_MODE || 'update').trim()
  if (!['update', 'check'].includes(mode)) throw new Error(`mode must be update or check, not "${mode}"`)
  const bool = (name, fallback) => {
    const value = (env[name] || fallback).trim().toLowerCase()
    if (!['true', 'false'].includes(value)) throw new Error(`${name.replace(/^PUML_/, '').toLowerCase()} must be true or false`)
    return value === 'true'
  }
  const args = splitArgs(env.PUML_ARGS)
  checkArgs(args)
  return {
    mode,
    args,
    root: path.resolve(env.PUML_ROOT_DIRECTORY || '.'),
    commit: bool('PUML_COMMIT', 'true'),
    message: (env.PUML_COMMIT_MESSAGE || '').trim() || 'Update PlantUML diagrams',
  }
}

function git(top, args, options = {}) {
  const result = spawnSync('git', args, { cwd: top, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw Object.assign(new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`), { detail })
  }
  return result.stdout
}

const digest = file => {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') } catch { return null }
}

// Paths (relative to the repository root) of every modified or untracked file, with content hashes.
function snapshot(top) {
  const parts = git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0')
  const files = new Map()
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue
    const status = parts[i].slice(0, 2), file = parts[i].slice(3)
    if (/[RC]/.test(status[0])) i++ // The next entry is the rename or copy source.
    files.set(file, digest(path.join(top, file)))
  }
  return files
}

// Only files the CLI touched: new entries, or entries whose content changed during the run.
function changedFiles(before, after, ignored) {
  return [...after].filter(([file, hash]) => file !== ignored && before.get(file) !== hash).map(([file]) => file).sort()
}

const escapeCommand = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
function annotate(level, message) {
  console.log(`::${level}::${escapeCommand(message)}`)
}
function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return
  const delimiter = `PUML_${randomUUID()}`
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
}
function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
}
const list = files => files.map(file => `- \`${file}\``)

function commitAndPush(top, files, message) {
  let branch
  try {
    branch = git(top, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim()
  } catch {
    throw new Error('Cannot commit from a detached HEAD. On pull_request events use mode: check, '
      + 'or check out the branch with actions/checkout ref: ${{ github.head_ref }}. Set commit: false to skip committing.')
  }
  const input = files.join('\0')
  const pathspec = ['--pathspec-from-file=-', '--pathspec-file-nul']
  const identity = []
  const configured = spawnSync('git', ['config', 'user.email'], { cwd: top, encoding: 'utf8' })
  if (configured.status !== 0 || !configured.stdout.trim()) identity.push('-c', `user.name=${botName}`, '-c', `user.email=${botEmail}`)
  git(top, ['add', ...pathspec], { input })
  // A pathspec limits the commit to these files even if earlier steps staged others.
  git(top, [...identity, 'commit', '--quiet', '-m', message, ...pathspec], { input })
  const sha = git(top, ['rev-parse', 'HEAD']).trim()
  try {
    git(top, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`])
  } catch (error) {
    const hint = /403|denied|permission/i.test(error.detail || '') ? ' Grant the job permissions: contents: write.' : ''
    throw new Error(`Committed ${sha.slice(0, 7)} but could not push to ${branch}.${hint} ${error.message}`)
  }
  return { sha, branch }
}

function main(env = process.env) {
  const inputs = parseInputs(env)
  if (!fs.existsSync(inputs.root) || !fs.statSync(inputs.root).isDirectory()) {
    throw new Error(`root-directory does not exist: ${inputs.root}`)
  }
  const root = inputs.root
  let top, prefix
  try {
    top = git(root, ['rev-parse', '--show-toplevel']).trim()
    prefix = git(root, ['rev-parse', '--show-prefix']).trim()
  } catch {
    throw new Error('root-directory is not inside a git repository. Run actions/checkout first.')
  }
  // Ask git for the relative path: comparing paths breaks on Windows short names and macOS /private.
  const cacheFile = `${prefix}.puml-cache.json`

  const before = snapshot(top)
  const result = spawnSync(process.execPath, [cli, '-x', root, ...inputs.args], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`puml-for-markdown exited with status ${result.status}; see the log above`)
  const files = changedFiles(before, snapshot(top), cacheFile)

  setOutput('changed', String(files.length > 0))
  setOutput('files', files.join('\n'))

  if (inputs.mode === 'check') {
    if (!files.length) {
      console.log('Diagrams are up to date.')
      summary(['### PlantUML diagrams are up to date'])
      return 0
    }
    const command = ['npx', 'puml-for-markdown', ...inputs.args].join(' ')
    annotate('error', `Diagrams are out of date in ${files.length} file(s): ${files.join(', ')}. Run "${command}" and commit the result.`)
    summary(['### PlantUML diagrams are out of date', '', `Run \`${command}\` and commit:`, '', ...list(files)])
    spawnSync('git', ['--no-pager', 'diff', '--stat', '--', ...files], { cwd: top, stdio: 'inherit' })
    return 1
  }

  if (!files.length) {
    console.log('Diagrams are up to date; nothing to commit.')
    setOutput('commit', '')
    return 0
  }
  console.log(`Updated ${files.length} file(s):\n${files.map(file => `  ${file}`).join('\n')}`)
  if (!inputs.commit) {
    setOutput('commit', '')
    summary(['### Updated PlantUML diagrams (not committed)', '', ...list(files)])
    return 0
  }
  const { sha, branch } = commitAndPush(top, files, inputs.message)
  console.log(`Pushed ${sha.slice(0, 7)} to ${branch}.`)
  setOutput('commit', sha)
  summary([`### Updated PlantUML diagrams in ${sha.slice(0, 7)}`, '', ...list(files)])
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = main()
  } catch (error) {
    annotate('error', error.message)
    process.exitCode = 1
  }
}

module.exports = { splitArgs, checkArgs, parseInputs, changedFiles, main }
