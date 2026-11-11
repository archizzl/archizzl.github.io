# archizzl.github.io

Personal site, served by GitHub Pages from the `main` branch (custom domain in `CNAME`). There is no `master` branch any more.

Before adding or restyling a page, read `STYLE.md`.

## npm scripts

The root `package.json` only wraps `blog/build.py` (no dependencies): `npm run dev` (watch + preview server + Vite builds), `npm run dev:blog` (same without Vite builds), `npm run build` (one-shot blog build). Extra flags pass through: `npm run dev -- --port=9000`.

## Portfolio galleries

`hpi/gallery/gallery.js` is the viewer; `_gallery-editor/README.md` explains the data. Every build (`npm run build`, and `npm run dev` whenever a `hpi/gallery/*.json` changes) runs `blog/gallery_pages.py`, which writes `<gallery>/index.html` and one `<gallery>/<item>/index.html` per item with link-preview meta tags. It reads the live Cloudinary tag list, so it needs the network (it falls back to `photos.json`). Commit the generated pages; don't hand-edit them. Item keys and order in `gallery_pages.py` must match `arrange()` in `gallery.js`. `404.html` forwards `/<gallery>/<key>/` with no page yet to `/<gallery>/?item=<key>`.

## Vite projects (set-splitter, zine-formatter)

Each app has its source in `_<name>/` (Vite + TypeScript). The site serves the built copy in `projects/<name>/`.

**How they deploy:** run `npm run dev` (same as `python3 blog/build.py --watch`). That starts the local preview server at http://localhost:8000. It also builds every project listed in `VITE_PROJECTS` into `projects/<name>/`, and rebuilds one whenever its source changes. Commit the built `projects/<name>/` files along with the source. Pushing to `main` then publishes them.

- To add a new app, create `_<name>/` (copy `_zine-formatter/` as a template, keeping `base: "./"` in `vite.config.ts`) and add `<name>` to `VITE_PROJECTS` in `blog/build.py`.
- Every blog build, including `--watch` on startup, rewrites `blog/feed.xml` and the date in `blog/src/template.txt`. Don't commit `feed.xml` or `template.txt` changes you didn't intend to make.
- Blog drafts live in `blog/drafts/`, which is gitignored so unpublished posts never reach the public repo. Anything in `blog/src/` is committed and published. A post's `status:` line decides which folder it's in: every build moves `status: live` drafts to `blog/src/` and `status: draft` posts back to `blog/drafts/` (`template.txt` starts as `status: draft`).
- `--watch` builds drafts into `blog/.preview/` (gitignored) and its server serves that folder over `blog/`, so drafts appear in the preview but never in the tracked `blog/posts/`, `posts.json` or `feed.xml`. It's safe to commit while it runs. Before this, drafts were built into `blog/posts/` and got committed and published by accident (they stay in git history).
- `.github/workflows/<name>.yml` is a fallback GitHub Action that builds an app and commits the result. It only runs when started by hand from the Actions tab; running it on push would add a bot commit to `main` and make local pushes fail.
- To build an app once without the server: `npm run build` in `_<name>/`, then copy `dist/` over `projects/<name>/`.

## Pushing

Git in Claude sessions has no GitHub login, so pushes fail. Commit locally and ask the user to push:

```bash
cd ~/dev/archizzl.github.io && git push
```
