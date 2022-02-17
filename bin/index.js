#!/usr/bin/env node

const path = require('path')

const {Command, Option} = require('commander')

const run = require(path.resolve(__dirname, '../index.js'))


// =============
// = CLI Setup =
// =============

new Command()
    .description('An application to add interactive PUML diagrams to your github markdown files. If running with default arguments, run in project root directory.')
    .addOption(new Option(
            '-x, --root-directory <path>',
            'The path to your project'
        ).default(process.cwd(), 'CWD')
    )
    .option(
        '-r, --hot-reload',
        'Rerun markdown generator every `interval` seconds, determined by interval option',
    )
    .option(
        '-v, --interval-seconds <number>',
        'If --hot-reload is set, how often should it reload',
        2,
    )
    .addOption(new Option(
            '-p, --puml-directory <path>',
            'Path to directory containing puml files which are referenced in markdown files',
        ).default(false, 'rootDirectory')
    )
    .addOption(new Option(
            '-m, --markdown-directory <path>',
            'Path to directory containing markdown files referencing puml files',
        ).default(false, 'rootDirectory')
    )
    .option(
        '-g, --ignore-gitignore',
        "Don't ignore files PUML and MD files in projects gitignore",
    )
    .addOption(new Option(
            '-i, --gitignore-path <path>',
            'Use this as path to .gitignore file.'
        ).default(false, 'rootDirectory/.gitignore')
    )
    .option(
        '-d, --output-images',
        'If set, will output images of diagrams to the dist directory',
    )
    .addOption(new Option(
            '-b, --dist-directory <path>',
            'If --output-images is set, path to output diagram images'
        ).default(false, 'rootDirectory/dist_puml')
    )
    .addOption(new Option(
            '-f, --image-formats <format>',
            'If --output-images is set, sets the output image format',
        ).choices(['png', 'svg', 'both']).default('png')
    )
    .option(
        '-t, --turn-off-link-shortening',
        "Use the full puml server link instead of the tiny url, if your diagrams are too big this won't work",
    )
    .action(opts => {
        opts.distDirectory = opts.distDirectory || path.resolve(opts.rootDirectory, 'dist_puml')
        opts.gitignorePath = opts.gitignorePath || path.resolve(opts.rootDirectory, '.gitignore')
        opts.markdownDirectory = opts.markdownDirectory || opts.rootDirectory
        opts.pumlDirectory = opts.pumlDirectory || opts.rootDirectory
        opts.shouldShortenLinks = !opts.turnOffLinkShortening
        opts.respectGitignore = !opts.ignoreGitignore
        opts.imageFormats = opts.imageFormats === 'both' ? ['png', 'svg'] : [opts.imageFormats]

        return run(opts).catch((e) => {
            console.error('FATAL EXCEPTION')
            console.error(e)
        })
    })
    .parse(process.argv)
