# puml-for-markdown project instructions

Node CLI and GitHub Action that render linked PlantUML diagrams in Markdown. Read `README.md`, `package.json`, and affected modules in `lib/` or `bin/`.

- Node 22+ is required by the current manifest. Install with `npm ci`; run `npm test` (`node --test`).
- Preserve nested `.gitignore` handling, negation rules, link-only/image syntax, and exclusions for symlinks and generated output.
- Rendering can involve external PlantUML services; use non-sensitive diagram fixtures.
- For release work verify packed files, a fresh install, README rendering, and Action behavior as applicable. Publishing credentials and account approvals are private.

## Working rules

- Preserve unrelated changes and use the repository's existing conventions.
- Test changes through the real user flow before saying they work. State what could not be tested and why. A passing build or a saved setting is not end-to-end verification.
- Run browser tests headlessly when no visible interaction is needed. Close only the windows/tabs you opened and stop only the temporary servers you started.
- Never send email on the user's behalf without showing the complete draft and receiving approval of that exact version. Changes to the draft require renewed approval.
- Do not add AI attribution, AI co-author trailers, or session links to commits, PRs, issues, releases, or comments. Use the repository owner's configured Git identity; never invent an identity.
- Before starting a new product or tool, research existing solutions, compare their fit/cost/limitations, and wait for the user's choice. Routine fixes, additions to existing projects, and throwaway scripts do not require that step.
- Give progress updates during long work. Do not stop or restart a slow job the user is waiting on without asking.
- Keep credentials, personal identifiers, account details, private hostnames, and private notebooks out of repository instructions and public artifacts. Use fictional test data and repo-relative paths.
- Keep durable public project knowledge in this file or focused project docs. Private notes belong in the agent's configured private context store, if available; a cloud task must work from this repo without access to private files.
