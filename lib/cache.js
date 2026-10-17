const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const hash = value => createHash('sha256').update(value).digest('hex')

function writeAtomic(file, data, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`
  let created = false
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx', mode })
    created = true
    fs.renameSync(temporary, file)
  } finally {
    if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

function loadCache(options) {
  const filename = path.join(options.rootDirectory, '.puml-cache.json')
  let data = { version: 1, diagrams: {}, images: {} }
  if (options.cache !== false && fs.existsSync(filename)) {
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing to read a symlinked .puml-cache.json')
    try {
      const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'))
      if (parsed.version === 1 && parsed.diagrams && parsed.images) data = parsed
    } catch {
      console.warn('WARN: Ignoring unreadable diagram cache; run generation to rebuild it.')
    }
  }
  const used = { version: 1, diagrams: {}, images: {} }
  return {
    get(kind, key) { return options.cache === false ? undefined : (used[kind][key] || data[kind][key]) },
    set(kind, key, value) { used[kind][key] = value },
    save() {
      if (options.cache === false || options.check || options.dryRun) return
      const serialized = JSON.stringify(used, null, 2) + '\n'
      if (fs.existsSync(filename)) {
        if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Refusing to overwrite a symlinked .puml-cache.json')
        if (fs.readFileSync(filename, 'utf8') === serialized) return
      }
      writeAtomic(filename, serialized)
    },
  }
}
module.exports = { hash, writeAtomic, loadCache }
