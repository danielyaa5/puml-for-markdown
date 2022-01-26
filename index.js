/**
 * Update any markdown links in a specified directory which reference a PUML diagram so they link directly to a
 * puml server svg link. This is required for GitHub integration
 * NOTE: Does not support cyclic dependencies, only DAGS
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')
const bent = require('bent')

const Promise = require('bluebird')
const _ = require('lodash')
const glob = require('glob')
const plantUmlEncoder = require('plantuml-encoder')
const tiny = require('tinyurl');


// CONSTANTS
const DIAGRAMS_FOLDER_NAME = 'diagrams'
const SOURCE_FOLDER_NAME = 'source'
const PUML_SVG_SERVER = 'https://www.plantuml.com/plantuml/svg'
const PUML_PNG_SERVER = 'https://www.plantuml.com/plantuml/png'

// HELPERS

const getBuffer = bent('buffer')
const sourceDir = (docsDir) => path.resolve(docsDir, SOURCE_FOLDER_NAME)
const diagramsDir = (docsDir) => path.resolve(sourceDir(docsDir), DIAGRAMS_FOLDER_NAME)
const diagramsOutputDir = (docsDir) => path.resolve(docsDir, DIAGRAMS_FOLDER_NAME)
const mkdirIfDoesntExist = (p) => !fs.existsSync(p) && fs.mkdirSync(p, {recursive: true})
const formatPumlPath = (p) => p.replace(/^\.\//, '')
const getPngUrl = (encodedData) => `${PUML_PNG_SERVER}/${encodedData}}`
const getPumlTinyUrl = (encodedData) => tiny.shorten(`${PUML_SVG_SERVER}/${encodedData}`)
const mapUniqMatches = (s, re, mapper, match = re.exec(s), results = []) => {
    if (match) return mapUniqMatches(s, re, mapper, re.exec(s), results.concat([match]))
    return _.uniqBy(results, String).map(mapper)
}
const saveDiagramAsPng = async (docsDir, relPumlPath, encodedData) => {
    const outputP = path.resolve(diagramsOutputDir(docsDir), relPumlPath).replace(/puml$/, 'png')
    mkdirIfDoesntExist(path.dirname(outputP))
    const buffer = await getBuffer(getPngUrl(encodedData));
    fs.writeFileSync(outputP, buffer)
}

const saveDiagramsAsPng = (docsDir, relPumlPaths, pumlLinks) => Promise.all(
    relPumlPaths.map(p => saveDiagramAsPng(diagramsOutputDir(docsDir), p, pumlLinks.get(p).encodedData))
)


// DATA STRUCTURES

class PumlLinks extends Map {
    get(p) {
        return super.get(formatPumlPath(p));
    }

    async set(p, v) {
        const formattedPath = formatPumlPath(p)
        if (typeof v === 'number') return super.set(formattedPath, v)

        const encodedData = plantUmlEncoder.encode(v)
        const tinyUrl = await getPumlTinyUrl(encodedData)
        return super.set(formattedPath, {encodedData, tinyUrl, data: v});
    }

    has(p) {
        return super.has(formatPumlPath(p));
    }
}

// PROCESSORS

/**
 * Add the whole relative includes file into the puml instead of a reference
 * @param {string} docsDir
 * @param {string} data
 * @param {string} pumlPath
 * @returns {string} The puml data where relative includes are replaced with the data from referenced file
 */
const processIncludes = (docsDir, data, pumlPath) => {
    return data.replace(/!include (.*)/g, (fullMatch, url) => {
        const fullUrl = path.resolve(diagramsDir(docsDir), path.dirname(pumlPath), url)
        return fs.existsSync(fullUrl) ? fs.readFileSync(fullUrl, 'utf8') : fullMatch
    })
}


/**
 * Walk through each PUML file recursively so we can encode any linked files first since the files they link
 * from are dependent
 * @param {string} docsDir
 * @param {string} link
 * @param {PumlLinks} pumlLinks
 * @returns {Promise<string> | Promise<undefined>} Returns either processed puml file link, or original link
 */
const processPumlFile = async (docsDir, link, pumlLinks) => {
    // Base Cases
    if (!pumlLinks.has(link)) return link
    if (pumlLinks.get(link)) return pumlLinks.get(link)

    let data = fs.readFileSync(path.join(diagramsDir(docsDir), link), 'utf8')
    await Promise.all(mapUniqMatches(data, /\$link=["']([^"']+)['"]/gm, async ([styledNestedLink, nestedLink]) => {
        const newLink = await processPumlFile(docsDir, nestedLink, pumlLinks)
        data = data.replaceAll(styledNestedLink, `$link="${newLink.tinyUrl}"`)
    }))

    data = processIncludes(docsDir, data, link)
    await pumlLinks.set(link, data)
    return pumlLinks.get(link)
}

/**
 * Update any markdown links which reference PUML diagram so they link directly to a puml server svg link
 * Output them as new markdown in the docs directory
 * @param {string} docsDir
 * @param {object} p An object with absolute and relative path of the markdown file being processed
 * @param {PumlLinks} pumlLinks A map which stores a relative link to a puml file => shortened url to the puml svg server link
 */
const processMdFile = async (docsDir, p, pumlLinks) => {
    let pumlsToOutputAsPng = []
    let data = '[comment]: <> (THIS IS A GENERATED MARKDOWN FILE, PLEASE EDIT SOURCE)\n'
    data += fs.readFileSync(p.abs, 'utf8')
    // Create puml links for any new relative links to puml files
    const findMdPumlLinksRE = new RegExp(`(!?\\[[^\\]]+\\])\\(([^)]+\\.puml)\\)`, 'g')
    data = data.replace(findMdPumlLinksRE, (match, linkText, pumlPath) => {
        const absPumlPath = path.resolve(sourceDir(docsDir), pumlPath)
        const relPumlPath = path.relative(diagramsDir(docsDir), absPumlPath)
        const pumlLink = pumlLinks.get(relPumlPath)
        if (match[0] === '!') {
            pumlsToOutputAsPng.push(relPumlPath)
        }
        return `${linkText}(${pumlLink.tinyUrl})`
    })

    const outputP = path.resolve(docsDir, p.rel)
    mkdirIfDoesntExist(path.dirname(outputP))
    fs.writeFileSync(outputP, data)

    await saveDiagramsAsPng(docsDir, pumlsToOutputAsPng, pumlLinks)
}

/**
 *
 * @param {string} docsDir Where to output generated markdown and templates also where the source markdown and diagrams
 * are located
 * @returns {Promise<void>}
 */
const runOnce = async (docsDir) => {
    assert(fs.existsSync(docsDir), "That's an invalid docs folder path")

    const pumlLinks = new PumlLinks()
    const mdPaths = glob.sync(`${sourceDir(docsDir)}/**/*.md`)
        .map(abs => ({ abs, rel: path.relative(sourceDir(docsDir), abs) }))
    const pumlPaths = glob.sync(`${diagramsDir(docsDir)}/**/*.puml`)
        .map(abs => ({ abs, rel: path.relative(diagramsDir(docsDir), abs) }))

    mkdirIfDoesntExist(diagramsOutputDir(docsDir))

    // Mark paths so we know which should be visited
    // Any path that's not marked 0 we know isn't a puml path because it doesn't correspond to a puml fil
    pumlPaths.forEach(p => pumlLinks.set(p.rel, 0))

    for (let p of pumlPaths) await processPumlFile(docsDir, p.rel, pumlLinks)
    for (let p of mdPaths) await processMdFile(docsDir, p, pumlLinks)
}

const reloadRun = (docsDir, intervalSec) => Promise.delay(intervalSec * 1000, docsDir)
    .then(run).catch(console.error).finally(() => reloadRun(docsDir))

const run = (docsDir, intervalSec) => intervalSec ? reloadRun(docsDir, intervalSec) : runOnce(docsDir)
module.exports = run
