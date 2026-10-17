# puml-for-markdown

## Simple CLI Usage
Just run `puml-for-markdown` in any directory where you have markdown files and it will render links to PlantUML files
in markdown comments. The best part about this is that it requires no build files, you don't even need to store 
puml images in your repo. Also the embedded diagrams can link to other diagrams. [PlantUML](https://plantuml.com) files 
allow you to create diagrams that are defined using a simple and intuitive language. By default the entire directory 
is recursively searched, respecting root and nested `.gitignore` rules, including negation. `.git`, `node_modules`, the output directory, and symbolic links are always skipped. Both `.puml` and `.plantuml` diagram files are supported.

## Examples
The following examples are of a project I worked on, **yellow components will link you to another diagram**. Obviously the
diagram content has been obfuscated.

### Embed a Diagram
You can easily add an embedded diagram to your markdown. Simply add a link to the puml file in a markdown comment like so:

```
<!--![Diagram Image Link](./puml/level_1_system_view.puml)-->
```

Here's the result. **Try clicking on the yellow blocks.**

[![Diagram Image Link](https://tinyurl.com/2d47useb)](https://tinyurl.com/2d47useb)<!--![Diagram Image Link](./puml/level_1_system_view.puml)-->

### Link Only
To render a link to a puml diagram, do the same thing but exclude the `!`
```
<!--[Click to Open Interactive Diagram](./puml/level_1_system_view.puml)-->
```

which renders into

[Click to Open Interactive Diagram](https://tinyurl.com/2d47useb)<!--[Click to Open Interactive Diagram](./puml/level_1_system_view.puml)-->

## Goal
The goal is to make PlantUML diagrams easily accessible from markdown, specifically GitHub flavored.
* Should work with both private and public repositories
* Should not have to use tokens to get it to work with private repositories
* Should support hyperlinking to other diagrams
* Should support PlantUML `!include`
* Should support PlantUML [sprites](https://crashedmind.github.io/PlantUMLHitchhikersGuide/PlantUMLSpriteLibraries/plantuml_sprites.html) (small graphic images)
* Any time you make changes to diagrams you should be able to run the CLI tool to update the markdown links

## Background
[PlantUML](https://plantuml.com) allows you to create diagrams that are defined using a simple and intuitive language.
PlantUML diagrams are great for designing new projects but they don't work very well in Github markdown preview. There
are some [workarounds](https://stackoverflow.com/questions/32203610/how-to-integrate-uml-diagrams-into-gitlab-or-github),
but I found these to be unstable and they have a lot of caveats.

**Update**: Github released support for embeddable Mermaid diagrams, but PlantUML is still unsupported,
[see here](https://github.blog/2022-02-14-include-diagrams-markdown-files-mermaid/) for more info.


### Basic Usage
Whenever you run the CLI it will add a tinyurl link to the rendered SVG next to the markdown comments referencing a
puml diagram. E.g.
```
<!--[Example With Only Link](./puml/level_1_system_view.puml)-->
```
will be replaced with
```
[Example With Only Link](https://tinyurl.com/yfpclfpp)<!--[Example With Only Link](./puml/level_1_system_view.puml)-->
```

When `!` is included in front of the markdown link, it will render the diagram image in the markdown. If the image is
clicked it will open up the diagram. E.g.
```
<!--![Example With Graph Image](./puml/level_1_system_view.puml)-->
```
will be replaced with
```
[![Example With Graph Image](https://tinyurl.com/yfpclfpp)](https://tinyurl.com/yfpclfpp)<!--![Example With Graph Image](./puml/level_1_system_view.puml)-->
```

If you want to update the link text or switch it between image and link, just update the comment and rerun the CLI. You
don't need to delete the rendered image or link.

### Installation
Requires **Node.js 22 or newer** (Node.js 24 recommended for development).

`npm i -g puml-for-markdown`

### Advanced Usage
Here are some other features supported
- You can specify the CLI to output the diagram images as png and/or svg see `--output-images` and `--image-formats`.
For an example of outputted images, checkout [dist_puml/puml](./dist_puml/puml). These images were created by the
[pre-commit hook](./.husky/pre-commit).
- You can specify the PUML server used to render the diagrams see `--puml-server-url`

### All CLI Options
```text
Usage: puml-for-markdown [options]

An application to add interactive PUML diagrams to your github markdown files. If running with default arguments, run in project root directory.

Options:
  -s, --puml-server-url <url>      This is the base URL used to render
                                   diagrams. Defaults to the public plantuml
                                   server. (default:
                                   "https://www.plantuml.com/plantuml")
  -x, --root-directory <path>      The path to your project (default: CWD)
  -r, --hot-reload                 Rerun markdown generator every `interval`
                                   seconds, determined by interval option
  -v, --interval-seconds <number>  If --hot-reload is set, how often should it
                                   reload (default: 2)
  -p, --puml-directory <path>      Path to directory containing puml files
                                   which are referenced in markdown files
                                   (default: rootDirectory)
  -m, --markdown-directory <path>  Path to directory containing markdown files
                                   referencing puml files (default:
                                   rootDirectory)
  -g, --ignore-gitignore           Don't use .gitignore rules to skip PUML and
                                   MD
  -i, --gitignore-path <path>      Use this as path to .gitignore file.
                                   (default: rootDirectory/.gitignore)
  -d, --output-images              If set, will output images of diagrams to
                                   the dist directory
  -b, --dist-directory <path>      If --output-images is set, path to output
                                   diagram images (default:
                                   rootDirectory/dist_puml)
  -f, --image-formats <format>     If --output-images is set, sets the output
                                   image format (choices: "png", "svg", "both",
                                   default: "png")
  -t, --turn-off-link-shortening   Use the full puml server link instead of the
                                   tiny url, if your diagrams are too big this
                                   won't work
  --local-images                   Link Markdown to exported local images
                                   (implies --output-images)
  --interactive-links              Wrap local image previews in an interactive
                                   renderer link
  --check                          Check for stale Markdown and images without
                                   writing or using the network
  --dry-run                        List planned changes without writing or
                                   using the network
  --no-cache                       Disable the persistent diagram and image
                                   cache
  -l, --polr-url <url>             Use a private Polr shortener; reads
                                   POLR_APIKEY from the environment
  -h, --help                       display help for command
```

### Notes
- Comments within inline or multiline code styling will be ignored
- Cyclic diagram links and recursive local includes fail with an error showing the reference chain.
- See the [pre-commit hook](./.husky/pre-commit) to see how to add a git hook
- Image export skips files without an `@start...` directive and files used only as local includes. A Markdown reference or diagram hyperlink makes an included file exportable. Other files must render successfully.
- Anything inside `inline code` or `code blocks` will be excluded from rendering

### How It Works
#### Using PlantUML Web Service to Render PUML Diagrams
You can use PlantUML using the online web service to generate images on-the-fly. A online demonstration is available at
[http://www.plantuml.com/plantuml](http://www.plantuml.com/plantuml). You can pass the
[encoded text](https://plantuml.com/text-encoding) of your diagrams to the web service in the url path and it will
generate an SVG or PNG for you. Here's a simple HelloWorld example
[http://www.plantuml.com/plantuml/uml/Aov9B2hXil98pSd9LoZFByf9iUOgBial0000](http://www.plantuml.com/plantuml/uml/Aov9B2hXil98pSd9LoZFByf9iUOgBial0000).
Large diagrams will have very long encoding strings, they can exceed maximum url length. They also don't look very good
in markdown files. By default the CLI will use the tinyurl.com service to shorten the link to the diagram.

#### Encoding PUML Diagrams for the Web Service
The CLI will use the `plantuml-encoder` package to encode puml files. To support hyperlinking diagrams we need to parse
all hyperlinks in the puml files. A dependency graph is created for the files and a DFS is performed where we create
links for the leaf nodes first, then replace the links in the parent nodes with the links to the leaf nodes. The puml
files are not actually modified, only the puml files content in memory is modified. By default the tinyurl free service
is used to shorten the links.

In order to support `!include` we parse puml files and replace any `!include` with the contents of the file referenced.

#### Parsing Markdown
The markdown files are then parsed for markdown comments. If the comments reference a PlantUML file, a link to the web
service url will be added next to the comment. Because these links contain the full PlantUML diagram encoding in it,
there are no issues using them in private repositories.

### Testing
Currently there is no TDD, for now I've just been using the example diagrams to test. The examples are pretty extensive
though.

### Other Helpful Links
* [C4-Puml](https://github.com/plantuml-stdlib/C4-PlantUML): A collection of PlantUML diagrams for use in C4, you'll see me using this in my examples

### Known Issues
* Seems to be breaking on Windows, see [here](https://github.com/danielyaa5/puml-for-markdown/issues/6). I don't have a
Windows machine to test on so help here would be appreciated.

### More Examples
[![ERD](https://tinyurl.com/2amb263t)](https://tinyurl.com/2amb263t)<!--![ERD](./puml/level_4_erd.puml)-->



[![Container View](https://tinyurl.com/284kg5h5)](https://tinyurl.com/284kg5h5)<!--![Container View](./puml/level_2_container_view.puml)-->



[![Component View - Label Retrieval Job](https://tinyurl.com/262ys7bk)](https://tinyurl.com/262ys7bk)<!--![Component View - Label Retrieval Job](./puml/level_3_component_view_label_retrieval_job.puml)-->



[![Component View - Pipeline Component](https://tinyurl.com/2xlmr44t)](https://tinyurl.com/2xlmr44t)<!--![Component View - Pipeline Component](./puml/level_3_component_view_pipeline.puml)-->



[![Activity Diagram - Sampler A](https://tinyurl.com/26j5s2fw)](https://tinyurl.com/26j5s2fw)<!--![Activity Diagram - Sampler A](./puml/level_4_activity_diagram_sampler_a.puml)-->



[![Activity Diagram - Sampler B](https://tinyurl.com/2cqvdekn)](https://tinyurl.com/2cqvdekn)<!--![Activity Diagram - Sampler B](./puml/level_4_activity_diagram_sampler_b.puml)-->


### Reliability and operational notes

- Fatal errors return a nonzero exit status, suitable for CI. Watch mode logs errors
  and retries on the next interval; it runs immediately on startup.
- Local `!include` files are expanded recursively relative to the file containing
  the directive. Remote, standard-library, and macro-based includes remain for the
  renderer to evaluate. This is not a complete PlantUML preprocessor: conditional
  includes and `!include_once` / `!include_many` are not expanded locally.
- Unrelated Markdown links, fenced/indented code, inline code, and line endings
  are preserved. Unchanged Markdown files are not rewritten.
- All Markdown references are checked before documents are written. Image exports
  complete before Markdown is updated, but an export failure can leave earlier
  successfully exported images updated; the operation is not a multi-file transaction.
- Export overwrites the matching generated image files but never clears the output
  directory. Stale images are retained. Ambiguous output names and symlinks inside
  the output path are rejected.
- Renderer and shortener requests time out after 30 seconds. If TinyURL fails,
  a warning is printed and the direct PlantUML URL is used. Large URLs can still
  exceed renderer/proxy limits; shortening does not remove the renderer's limit.
- **Diagram privacy:** encoded diagram URLs contain recoverable source text.
  The default shortener receives that URL, and the renderer receives the diagram
  when someone opens it or when images are exported. For private diagrams, use
  your own renderer with `--puml-server-url` and disable shortening with `-t`.


### Local images and offline viewing

```sh
puml-for-markdown --local-images --image-formats svg
```

This implies `--output-images` and produces relative Markdown links to files in
`dist_puml`. For example, `<!--![Diagram](puml/a.puml)-->` becomes
`![Diagram](dist_puml/puml/a.svg)<!--![Diagram](puml/a.puml)-->`.
Paths are relative to each Markdown file and URL-encoded, including spaces.
Both `.puml` and `.plantuml` sources work.

SVG diagrams link to other exported SVG diagrams using relative paths. Open the
SVG directly in a browser or serve the export folder to navigate between them.
Markdown hosts may disable links inside embedded SVG images. PNG previews cannot
contain clickable elements. With `--image-formats both`, Markdown uses SVG.

Add `--interactive-links` to wrap a local preview in a link to the online renderer.
That renderer link uses separate source with online diagram hyperlinks, while
exported SVGs retain their local hyperlinks. Local-only mode skips URL shortening.
Rendering still contacts the configured PlantUML server; use `--puml-server-url`
with your own renderer when the source must remain private.

### Check or preview changes without modifying files

```sh
puml-for-markdown --dry-run -t
puml-for-markdown --check -t
puml-for-markdown --local-images --image-formats svg --check
```

Both commands are offline and never write Markdown, images, or cache files.
`--dry-run` lists planned changes and exits successfully; `--check` exits with 1
if documentation is stale, otherwise 0. Invalid inputs still exit with 1.
Neither can be combined with `--hot-reload`.

A check that uses shortened URLs or exported images needs the cache from a prior
successful generation with the same settings. If it is missing, the check reports
that generation is needed rather than contacting a shortener or claiming the files
are current. Direct-URL Markdown checks (`--check -t` without image export) do not
require a cache. For CI, use that deterministic mode or restore the generation
cache with the exported images.

### Persistent cache and incremental watch mode

Successful runs save `.puml-cache.json` at the project root. Add it to your
`.gitignore`: encoded URLs contain recoverable source text, even for private diagrams.
The cache contains no Polr API key. Renderer/provider settings and a hash of the key
separate cache entries when configuration changes.

The CLI reuses encodings, shortened URLs, and verified image files. Watch mode
checks inputs each interval and only rebuilds affected content. Local include
changes invalidate their parent diagrams; remote diagram links invalidate parents
when their target URL changes. Local links stay stable when only a child changes.
Missing or externally modified images are rendered again.

```sh
puml-for-markdown --hot-reload
puml-for-markdown --no-cache
```

`--no-cache` forces regeneration without reading or writing the cache. Use it to
refresh remote includes, renderer upgrades at the same URL, or expired short links:
those external changes cannot be detected from local file content. Failed shortening
attempts are not cached, allowing the next run to retry. Stale generated images are
retained; the CLI never clears the destination directory.

### Private Polr URL shortening

```sh
# Set POLR_APIKEY in your shell or CI secret environment first.
puml-for-markdown --puml-server-url https://uml.example.com/plantuml \
  --polr-url https://short.example.com
```

This adapts the provider idea from [PR #8](https://github.com/danielyaa5/puml-for-markdown/pull/8)
by @mzagar. The implementation uses the [Polr v2 API](https://docs.polrproject.org/en/latest/developer-guide/api/):
POST `/api/v2/action/shorten`, with URL-encoded `url`, `key`, and `response_type`
fields. JSON and plain-text responses are accepted and validated. Credentials are
never written into generated links or the cache. A failed Polr request falls back
to the direct renderer URL, never TinyURL. `--polr-url` cannot be combined with `-t`.

To avoid a shortener entirely, use your own renderer with `-t`. This is also the
simplest setup for private diagrams when URLs are short enough for your renderer.
