#!/usr/bin/env node

const {Command, InvalidArgumentError} = require('commander')

const run = require(__dirname + '/../index.js')

const parseNumOpt = (numStr) => {
    const parsedValue = Number(numStr)
    if (isNaN(parsedValue)) {
        throw new InvalidArgumentError(`${numStr} is not a number.`);
    }

    if (parsedValue === 0) {
        throw new InvalidArgumentError('Reload interval must be greater than zero');
    }
    return parsedValue;
}

// Set default value if reload is set
const getReloadInterval = opts => opts.reload === true ? 2 : opts.reload

new Command()
    .argument(
        'docsDirPath',
        'Where to output generated markdown files and diagrams. Make sure all your diagrams are within `docsDir`/source/diagrams and all markdown is in `docsDir`/source`'
    )
    .option(
        '-r, --reload [interval]',
        'Rerun markdown generator every `interval` seconds (defaults to 2 seconds if interval not specified)',
        parseNumOpt,
    )
    .action((docsDir, opts) => run(docsDir, getReloadInterval(opts)).catch(console.error))
    .parse(process.argv)
