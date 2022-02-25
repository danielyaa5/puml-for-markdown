# puml-for-markdown

## Goal
The goal is to make PlantUML diagrams easily accessible from markdown, specifically GitHub flavored.
* Should work with both private and public repositories
* Should not have to use tokens to get it to work with private repositories
* Should support hyperlinking to other diagrams
* Should support PlantUML `!include`
* Should support PlantUML [sprites](https://crashedmind.github.io/PlantUMLHitchhikersGuide/PlantUMLSpriteLibraries/plantuml_sprites.html) (small graphic images)
* Any time you make changes to diagrams you should be able to run the CLI tool to update the markdown links

## Examples
The following examples are of a project I worked on, **yellow components will link you to another diagram**. Obviously the
diagram content has been obfuscated.

### Example With Link Only

[Only Link](https://tinyurl.com/y847en68)<!--[Only Link](./puml/level_1_system_view.puml)-->

### Example with Image, Click to Open Interactive Diagram

[![Example With Graph Image](https://tinyurl.com/y847en68)](https://tinyurl.com/y847en68)<!--![Example With Graph Image](./puml/level_1_system_view.puml)-->

## Background
[PlantUML](https://plantuml.com) allows you to create diagrams that are defined using a simple and intuitive language.
PlantUML diagrams are great for designing new projects but they don't work very well in Github markdown preview. There
are some [workarounds](https://stackoverflow.com/questions/32203610/how-to-integrate-uml-diagrams-into-gitlab-or-github),
but I found these to be unstable and they have a lot of caveats.

Update: Github released support for embeddable Mermaid diagrams, but PlantUML is still unsupported,
[see here](https://github.blog/2022-02-14-include-diagrams-markdown-files-mermaid/) for more info.

### Installation
`npm i -g puml-for-markdown`

### Basic Usage
Whenever you run the CLI it will add a tinyurl link to the rendered SVG next to the markdown comments referencing a
puml diagram. E.g. `<!--[Example With Only Link](./puml/level_1_system_view.puml)-->` will be replaced with
```
[Example With Only Link](https://tinyurl.com/yfpclfpp)<!--[Example With Only Link](./puml/level_1_system_view.puml)-->
```

When `!` is included in front of the markdown link, it will render the diagram image in the markdown. If the image is
clicked it will open up the diagram. E.g. `<!--![Example With Graph Image](./puml/level_1_system_view.puml)-->` will be
replaced with
```
[![Example With Graph Image](https://tinyurl.com/yfpclfpp)](https://tinyurl.com/yfpclfpp)<!--![Example With Graph Image](./puml/level_1_system_view.puml)-->
```

If you want to update the link text or switch it between image and link, just update the comment and rerun the CLI. You
don't need to delete the rendered image or link.

Optionally you can specify the CLI to output the diagram images as png and/or svg.

### Simple CLI Usage
Just run `puml-for-markdown` in any directory where you have markdown files and it will update the links in all markdown
files, automatically ignoring anything in the gitignore file. The CLI has a lot of options for customization. See the
section below for more details.

### CLI Usage
```
Usage: puml-for-markdown [options]

An application to add interactive PUML diagrams to your github markdown files. If running with default arguments, run in project root directory.

Options:
  -x, --root-directory <path>      The path to your project (default: CWD)
  -r, --hot-reload                 Rerun markdown generator every `interval` seconds, determined by interval option
  -v, --interval-seconds <number>  If --hot-reload is set, how often should it reload (default: 2)
  -p, --puml-directory <path>      Path to directory containing puml files which are referenced in markdown files (default: rootDirectory)
  -m, --markdown-directory <path>  Path to directory containing markdown files referencing puml files (default: rootDirectory)
  -g, --respect-gitignore          Automatically ignore MD files in .gitignore paths (default: true)
  -i, --gitignore-path <path>      If --respect-gitignore is set, use set this as path to .gitignore file. (default: rootDirectory/.gitignore)
  -d, --output-images              If set, will output images of diagrams to the dist directory
  -b, --dist-directory <path>      If --output-images is set, path to output diagram images (default: rootDirectory/dist_puml)
  -f, --image-formats <format>     If --output-images is set, sets the output image format (choices: "png", "svg", "both", default: "png")
  -t, --turn-off-link-shortening   Use the full puml server link instead of the tiny url, if your diagrams are too big this won't work
  -h, --help                       display help for command
```

### Notes
- Comments within inline or multiline code styling will be ignored
- Currently doesn't support cyclic graph references, i.e. a diagram can't reference any diagrams which reference back
to it
- See the [pre-commit hook](./.husky/pre-commit) to see how to add a git hook
- If you are saving diagram images and have puml files which only define constants/settings
(i.e. [example](./puml/constants.puml)) these aren't renderable on their own (since there is nothing to render)
and you'll see a warning in the console saying it failed to save the image to file.

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

### More Examples
[![ERD](https://tinyurl.com/ya6qvr7r)](https://tinyurl.com/ya6qvr7r)<!--![ERD](./puml/level_4_erd.puml)-->



[![Container View](https://tinyurl.com/yblre3m4)](https://tinyurl.com/yblre3m4)<!--![Container View](./puml/level_2_container_view.puml)-->



[![Component View - Label Retrieval Job](https://tinyurl.com/y8egw3wt)](https://tinyurl.com/y8egw3wt)<!--![Component View - Label Retrieval Job](./puml/level_3_component_view_label_retrieval_job.puml)-->



[![Component View - Pipeline Component](https://tinyurl.com/y9j7twkz)](https://tinyurl.com/y9j7twkz)<!--![Component View - Pipeline Component](./puml/level_3_component_view_pipeline.puml)-->



[![Activity Diagram - Sampler A](https://tinyurl.com/ybp8ju9x)](https://tinyurl.com/ybp8ju9x)<!--![Activity Diagram - Sampler A](./puml/level_4_activity_diagram_sampler_a.puml)-->



[![Activity Diagram - Sampler B](https://tinyurl.com/ya3cqxkv)](https://tinyurl.com/ya3cqxkv)<!--![Activity Diagram - Sampler B](./puml/level_4_activity_diagram_sampler_b.puml)-->
