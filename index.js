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
const parseGitIgnore = require('gitignore-globs');
const axios = require('axios')

// HELPERS

const polrShorten = (polrUrl, urlToShorten) => {
    const polrApikey = process.env.POLR_APIKEY ? process.env.POLR_APIKEY : ''
    return axios.get(polrUrl+'/api/v2/action/shorten?apikey='+polrApikey+'&url='+urlToShorten)
      .then(res => res.data)
      .catch(err => {
        console.error('Error calling polr shorten API: ', err.message);
        return err
      });
}

const getBuffer = bent('buffer')
const mkdirIfDoesntExist = (p) => !fs.existsSync(p) && fs.mkdirSync(p, {recursive: true})
const getPumlUrl = ({imgFormat, encodedData, shorten, pumlServerUrl, polrUrl}) => {
    const fullPumlUrl = getFullPumlUrl({imgFormat, encodedData, pumlServerUrl})
    if (!shorten) return fullPumlUrl
    if (polrUrl) return polrShorten(polrUrl, fullPumlUrl)
    return tiny.shorten(fullPumlUrl)
}
const getFullPumlUrl = ({imgFormat, encodedData, pumlServerUrl}) => `${pumlServerUrl}/${imgFormat}/${encodedData}}`
const mapUniqMatches = (s, re, mapper, match = re.exec(s), results = []) => {
    if (match) return mapUniqMatches(s, re, mapper, re.exec(s), results.concat([match]))
    return _.uniqBy(results, String).map(mapper)
}

const replaceIgnore = (ignoreRegex, str, replaceFn) => {
    const splitRegex = new RegExp(`(?:(${ignoreRegex}))`, 'g')
    const splitStrArr = str.split(splitRegex)
    const replacedSplitStrArr = splitStrArr.map((splitStr) => {
        if (splitStr.match(new RegExp(ignoreRegex))) return splitStr
        return replaceFn(splitStr)
    })
    return replacedSplitStrArr.join('')
}

const replaceMdIgnoringInlineCode = (mdString, replaceFn) => {
    return replaceIgnore('`[^\n]*?(?=`)`', mdString, replaceFn)
}

const replaceMdIgnoringCodeBlocks = (mdString, replaceFn) => {
    return replaceIgnore('```[\\s\\S]*?(?=```)```', mdString, replaceFn)
}

const replaceMdIgnoringCode = (mdString, replaceFn) => {
    return replaceMdIgnoringCodeBlocks(mdString, str => replaceMdIgnoringInlineCode(str, replaceFn))
}

// DATA STRUCTURES

class PumlLinks extends Map {
    constructor({ pumlPaths, shouldShortenLinks, pumlServerUrl, polrUrl }) {
        super();
        this.shouldShortenLinks = shouldShortenLinks
        this.pumlServerUrl = pumlServerUrl
        this.polrUrl = polrUrl
        // We need to know which paths should be visited
        // Any path that's not marked 0 we know isn't a puml path because it doesn't correspond to a puml file
        pumlPaths.forEach(p => this.set(p, 0))
    }

    get(p) {
        return super.get(p);
    }

    async set(pumlPath, v) {
        if (typeof v === 'number') return super.set(pumlPath, v)

        const encodedData = plantUmlEncoder.encode(v)
        const url = await getPumlUrl({
            imgFormat: 'svg', encodedData, shorten: this.shouldShortenLinks, pumlServerUrl: this.pumlServerUrl, polrUrl: this.polrUrl
        })
        return super.set(pumlPath, {encodedData, url, data: v});
    }

    has(pumlPath) {
        return super.has(pumlPath);
    }
}

// SAVING DIAGRAMS

const downloadImg = async (outputPath, imgUrl) => {
    const imgBuffer = await getBuffer(imgUrl)
    fs.writeFileSync(outputPath, imgBuffer)
}

const saveDiagram = async ({rootDirectory, distDirectory, pumlPath, imgFormat, encodedData, pumlServerUrl}) => {
    const outputPath = path.join(
        distDirectory, pumlPath.replace(rootDirectory, '').replace(/\.puml$/, `.${imgFormat}`)
    )

    mkdirIfDoesntExist(path.dirname(outputPath))
    const imgUrl = getFullPumlUrl({ imgFormat, encodedData, pumlServerUrl })
    try {
        await downloadImg(outputPath, imgUrl)
    } catch (e) {
        console.warn(`\nWARN: Failed to save ${imgUrl} to ${outputPath}\n`)
        if (e.statusCode !== 400) throw e
    }
}

const saveDiagrams = async ({rootDirectory, distDirectory, imageFormats, pumlLinks, pumlServerUrl}) => {
    fs.rmSync(distDirectory, {recursive: true, force: true});
    for (let [pumlPath, {encodedData}] of pumlLinks) {
        for (let imgFormat of imageFormats) {
            await saveDiagram({
                distDirectory, rootDirectory, pumlPath, imgFormat, encodedData, pumlServerUrl
            })
        }
    }
}

// PROCESSORS

/**
 * Add the whole relative includes file into the puml instead of a reference
 * @returns {string} The puml data where relative includes are replaced with the data from referenced file
 */
const processIncludes = (pumlPath, data) => {
    return data.replace(/!include (.*)/g, (fullMatch, url) => {
        const fullUrl = path.resolve(path.dirname(pumlPath), url)
        return fs.existsSync(fullUrl) ? fs.readFileSync(fullUrl, 'utf8') : fullMatch
    })
}


/**
 * Walk through each PUML file recursively so we can encode any linked files first since the files they link
 * from are dependent
 * @returns {Promise<string> | Promise<undefined>} Returns either processed puml file link, or original link
 */
const processPumlFile = async (pumlPath, pumlLinks) => {
    // Base Cases
    if (!pumlLinks.has(pumlPath)) return pumlPath
    if (pumlLinks.get(pumlPath)) return pumlLinks.get(pumlPath)

    let data = fs.readFileSync(pumlPath, 'utf8')
    await Promise.all(mapUniqMatches(data, /\$link=["']([^"']+)['"]/gm, async ([pumlLink, pumlLinkPath]) => {
        // console.debug(pumlLink, pumlLinkPath)
        const newLink = await processPumlFile(path.resolve(path.dirname(pumlPath), pumlLinkPath), pumlLinks)
        data = data.replaceAll(pumlLink, `$link="${newLink.url}"`)
    }))

    data = processIncludes(pumlPath, data)
    await pumlLinks.set(pumlPath, data)
    return pumlLinks.get(pumlPath)
}

/**
 * Update any markdown links which reference PUML diagram so they link directly to a puml server svg link
 * Output them as new markdown in the docs directory
 */
const processMdFile = async (mdPath, pumlLinks) => {
    console.info(`Processing md file at ${mdPath}`)
    let originalMdStr = fs.readFileSync(mdPath, 'utf8')
    const findMdPumlLinksRE = new RegExp(
        `(\\[.*\]\\([^)]+\\))?<!\-\-(!?\\[[^\\]]+\\])\\(([^)]+\\.puml)\\)\-\->`, 'g'
    )
    // Add puml server tinyurl link for puml links indicated in markdown comments
    const mdWithUpdatedPumlLinks = replaceMdIgnoringCode(originalMdStr, (str) => {
        return str.replace(findMdPumlLinksRE, (match, _, linkText, mdPumlLinkPath) => {
            const pumlPath = path.resolve(path.dirname(mdPath), mdPumlLinkPath)
            const pumlLink = pumlLinks.get(pumlPath)
            if (!pumlLink) {
                throw Error(`Could not find puml for md link path = ${mdPumlLinkPath}, absolute path = ${pumlPath}`)
            }
            let replacement
            // If the puml link is a markdown image
            if (linkText[0] === '!') {
                replacement = `[${linkText}(${pumlLink.url})](${pumlLink.url})<!--${linkText}(${mdPumlLinkPath})-->`
            } else {
                // If the puml link is a markdown hyperlink
                replacement = `${linkText}(${pumlLink.url})<!--${linkText}(${mdPumlLinkPath})-->`
            }

            // console.debug({match, linkText, mdPumlLinkPath, replacement})
            return replacement
        })
    })


    fs.writeFileSync(mdPath, mdWithUpdatedPumlLinks)
}

const runOnce = async (
    {
        pumlServerUrl,
        rootDirectory,
        markdownDirectory,
        pumlDirectory,
        distDirectory,
        outputImages,
        imageFormats,
        respectGitignore,
        gitignorePath,
        shouldShortenLinks,
        polrUrl
    }
) => {
    assert(fs.existsSync(markdownDirectory), "That's an invalid md folder path")
    assert(fs.existsSync(pumlDirectory), "That's an invalid puml folder path")

    const ignore = respectGitignore ? parseGitIgnore(gitignorePath) : []
    const mdPaths = glob.sync(`${markdownDirectory}/**/*.md`, {ignore, nodir: true})
    const pumlPaths = glob.sync(`${pumlDirectory}/**/*.puml`, {ignore, nodir: true})
    const pumlLinks = new PumlLinks({
        pumlPaths, shouldShortenLinks, pumlServerUrl, polrUrl
    })

    for (let p of pumlPaths) await processPumlFile(p, pumlLinks)
    for (let p of mdPaths) await processMdFile(p, pumlLinks)

    if (outputImages) {
        await saveDiagrams({
            rootDirectory, distDirectory, imageFormats, pumlLinks, pumlServerUrl
        })
    }
}

const reloadRun = ({intervalSeconds, ...rest}) =>
    Promise.delay(intervalSeconds * 1000, rest)
        .then(run).catch(console.error)
        .finally(() => reloadRun({intervalSeconds, ...rest}))

const run = ({hotReload, ...rest}) => hotReload ? reloadRun(rest) : runOnce(rest)

module.exports = run
