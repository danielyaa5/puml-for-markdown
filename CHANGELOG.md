# Changelog

## 2.1.1

- Shorten the GitHub Action's description to fit the Marketplace's 125-character
  limit, so the Action can be listed there. No CLI changes.

## 2.1.0

- Add a GitHub Action, `danielyaa5/puml-for-markdown@v2`. `update` mode regenerates
  diagrams and commits only the files it changed; `check` mode fails pull requests
  whose diagrams are out of date. Works on Linux, macOS, and Windows runners.
  See [GitHub Action](./README.md#github-action). No CLI changes.

## 2.0.1

- Correct outdated README statements about Windows support, automated testing,
  the pre-commit hook, and diagram privacy. No runtime behavior changes.

## 2.0.0

### Migration from version 1

- Requires Node.js 22 or newer. Upgrade Node.js before installing version 2.
- CLI failures now exit with a nonzero status so scripts and CI can detect errors.
- The CLI creates `.puml-cache.json` by default. Add it to `.gitignore`, or use
  `--no-cache` to disable caching. Refresh with `--no-cache` when remote includes
  or the rendering server change.

### Features and fixes

- Add local image links, offline check and dry-run modes, persistent caching,
  and private Polr URL shortening.
- Support `.plantuml` files, Windows paths, nested ignore rules, and recursive
  includes with cycle detection.
- Preserve Markdown formatting and code examples while replacing diagram links.
- Validate references before editing Markdown and preserve unrelated exported
  files. Export images atomically with readable permissions.
- Handle HTTP errors and timeouts, and serialize watch updates.
- Update dependencies and examples, with automated checks on Linux, macOS,
  and Windows using Node.js 22 and 24.
