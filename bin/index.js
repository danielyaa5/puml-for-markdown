#!/usr/bin/env node

const path = require('path')
const fs = require('fs')

const {Command, Option} = require('commander')

const run = require(path.resolve(__dirname, '../index.js'))


// =============
// = CLI Setup =
// =============

new Command()
  .name('puml-for-markdown')
  .description('An application to add interactive PUML diagrams to your github markdown files. If running with default arguments, run in project root directory.')
  .option(
    '-s, --puml-server-url <url>',
    'This is the base URL used to render diagrams. Defaults to the public plantuml server.',
    'https://www.plantuml.com/plantuml',
  )
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
    "Don't use .gitignore rules to skip PUML and MD",
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
  .option('--local-images', 'Link Markdown to exported local images (implies --output-images)')
  .option('--interactive-links', 'Wrap local image previews in an interactive renderer link')
  .option('--check', 'Check for stale Markdown and images without writing or using the network')
  .option('--dry-run', 'List planned changes without writing or using the network')
  .option('--no-cache', 'Disable the persistent diagram and image cache')
  .option('-l, --polr-url <url>', 'Use a private Polr shortener; reads POLR_APIKEY from the environment')
  .action(opts => {
      const useDefaultGitignorePath = !opts.gitignorePath

      opts.distDirectory = opts.distDirectory || path.resolve(opts.rootDirectory, 'dist_puml')
      opts.gitignorePath = opts.gitignorePath || path.resolve(opts.rootDirectory, '.gitignore')
      opts.markdownDirectory = opts.markdownDirectory || opts.rootDirectory
      opts.pumlDirectory = opts.pumlDirectory || opts.rootDirectory
      opts.shouldShortenLinks = !opts.turnOffLinkShortening
      opts.respectGitignore = !opts.ignoreGitignore
      opts.imageFormats = opts.imageFormats === 'both' ? ['png', 'svg'] : [opts.imageFormats]

      // A missing root ignore file must not disable nested .gitignore files.
      if (useDefaultGitignorePath && !fs.existsSync(opts.gitignorePath)) {
          opts.gitignorePath = undefined
      }

      return run(opts).then(result => {
          if (opts.check && result.stale) process.exitCode = 1
      }).catch((e) => {
          console.error(`ERROR: ${e.message}`)
          process.exitCode = 1
      })
  })
  .parse(process.argv)
