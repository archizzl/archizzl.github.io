# archizzl.com style guide

a short reference for anything new that goes on the site. it's descriptive, not prescriptive — capturing the look that's already here so future pages don't feel out of place.

## voice

- lowercase almost everything. sentence-case is fine mid-sentence for proper nouns; page-openers and headings stay lowercase ("hello!", "here's my website")
- short declarative sentences. contractions welcome ("here's", "you're")
- personal, direct address ("you can reach me", "if you're here for the silly games")
- no marketing tone. no "unlock", "seamless", "delight"
- links read like the thing they link to, not "click here" ("click click", "resume here")

## typography

- font stack: `'Calibri', 'Atkinson Hyperlegible', 'Helvetica'`. atkinson hyperlegible is loaded from google fonts, calibri is a common local fallback
- base size: `20px`. secondary text (dates, tags, metadata): `14–18px`
- `<h1>` is italic. that's the only styling — no size bump beyond browser default, no bold
- `<h2>` is bold, small top margin (`12px 0 4px`)
- no all-caps, no letter-spacing tricks
- line-height default; don't tighten

## color

- background: white
- text: black
- links: browser default blue. visited also blue (explicitly set that way — no purple)
- muted text: `#666` (headers/meta) or `#888` (tags, timestamps, secondary links)
- accent for warnings / drafts: `#b53a1a` (a rust red, small use)
- borders: `1px solid black` or `1px solid currentColor` — always hairline

no dark mode. the commented-out block in `index.css` is intentional; the site is white-on-black-text and stays that way.

## layout

- top-level: `flex-flow: column`, left-aligned, small margins (`5px` is common)
- content column widths: 400–900px depending on the piece. `#intro_paragraph` is 400px, `.sec` is 700px, `#balloons` is 900px
- iframes named `ventana` receive project content — projects nest inside the homepage, not the other way around
- viewport meta uses `initial-scale=0.7` — a deliberate zoom-out so more fits on mobile without a redesign
- no cards, no shadows, no gradients
- no full-width headers or footers
- corners: `3–5px` border-radius max on borders. most things have square corners

## interactive elements

**links**

```css
a:hover { text-decoration: underline; opacity: 0.5; }
```

- underline appears on hover (default underline stays or is removed inconsistently across the site — either is fine)
- opacity 0.5 on hover is a signature move — use it

**buttons**

two flavors:

1. `.project_link` — pill-ish tag: `1px solid black`, `5px` padding, `5px` border-radius, `#efefef` background. hover: `transform: scale(1.1); opacity: 0.5`
2. `.black_button` — fixed corner button, black bg, white text, `2–5px` padding, small font (`15px`). hover: `opacity: 0.8; cursor: pointer`

use `.project_link` for inline actions inside a list, `.black_button` for a persistent "back home" or utility action in a corner.

**form inputs**

no styled inputs on the site yet. when adding them: white background, `1px solid #888`, no border-radius or `3px` at most, browser default font. no floating labels, no focus glow — just the native focus ring.

## structural elements

- `<h1>` italic — page titles, post titles
- `<h2>` bold — section headings inside long content
- tags: `#tagname` as an `<a class="tag">`, muted gray (`#888`), no underline, hover underlines
- `.box`: `display: inline-block; border: 1px solid currentColor; padding: 1px 8px; border-radius: 3px` — for terse call-outs inline
- lists: `<ul>` with `list-style: none; padding: 0` (blog uses this). space rows with `2–5px` margin, not big padding
- dates: `<time>` with muted color and smaller font

## media

- images: `max-width: 100%; height: auto; display: block; margin: 8px 0`. inside `.blog` content they also get `cursor: zoom-in` and open in a modal
- video/audio: native controls. no custom skins
- iframes: no border. sized to the content (`#balloons` is 900px wide, `#salmon` uses aspect-ratio)

## the two-column-of-links pattern (`#home_links`)

```html
<div id="home_links">
  <div class="home_links_column"> … </div>
  <div class="home_links_column"> … </div>
</div>
```

use for grouped lists of small text links.

## how a new project should look

drop-in checklist for a project living at `archizzl.com/projects/thing/`:

- link the font stack (or accept the fallback)
- white background, black text, blue links
- lowercase headings and copy
- one column, left-aligned
- if you need chrome (rows, cards) — use `1px solid black` or `1px solid #ccc`, tiny padding, no shadows
- if you need a back-to-home link, use `.black_button` fixed in a corner
- if you need to add an entry to `projects/index.html`, follow the alphabetical order and use `class="project_link"`

## things that are ok to break

- the italic `<h1>` — some projects use a plain `<h1>` and that's fine
- the 20px base — projects with dense controls can drop to 14–16px inside their own scope
- the "no styled inputs" rule — projects that need forms are welcome to style them, just keep them hairline and monochrome

what shouldn't change: the voice (lowercase, plain), the color palette (white/black/blue/gray), the font stack.
