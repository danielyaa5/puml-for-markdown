# Contributing

Use Node.js 22 or newer (the `.nvmrc` selects Node.js 24).

```sh
npm ci
npm test
```

Tests invoke the real CLI in temporary directories. Image-export tests use a
local HTTP server, and shortener-failure tests simulate network failures. No
external service is needed for the test suite. Temporary files, HTTP servers,
and watch processes are cleaned up after tests.

CI runs the suite on Linux, macOS, and Windows, using Node.js 22 and 24.
The pre-commit hook runs tests; it does not regenerate documentation or stage
unrelated changes.

For an optional live smoke test, create a temporary project with a small
PlantUML diagram and a Markdown marker, then run:

```sh
node /path/to/puml-for-markdown/bin/index.js -x /path/to/temporary/project -d -f both
```

Inspect the resulting Markdown, PNG, and SVG. This sends the diagram to the
configured renderer and the encoded URL to TinyURL. Add `-t` to disable
shortening, and `-s http://localhost:8080/plantuml` to use a local renderer.

Do not run live generation against the repository README as part of tests.
