# puml-for-markdown

### Background
PlantUML diagrams are great for designing new projects but they don't work very well in Github markdown preview.
With PlantUML diagrams you are able to create links to other diagrams, but Github preview will remove these links from
your generated SVGs. Also every time you make changes to your diagrams, you have to recreate the PlantUML images which
is tedious.

### Goal
The goal is to make local PlantUML diagrams accessible from markdown. These diagrams should be allowed to reference on
another and be clickable. Any time you make changes to diagrams you should be able to run `puml4md` to update the
diagrams.

### Example

### Installation
`npm i -g puml-for-markdown`

### CLI Usage
```
Usage: puml4md [options] <docsDirPath>

Arguments:
  docsDirPath              Where to output generated markdown files and diagrams. Make sure all your diagrams are within `docsDir`/source/diagrams and all markdown is in `docsDir`/source`

Options:
  -r, --reload [interval]  Rerun markdown generator every `interval` seconds (defaults to 2 seconds if interval not specified)
  -h, --help               display help for command
```
