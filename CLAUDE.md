# archizzl.github.io

Personal site, served by GitHub Pages from the `main` branch (custom domain in `CNAME`). There is no `master` branch any more.

Before adding or restyling a page, read `STYLE.md`.

## npm scripts

The root `package.json` only wraps `blog/build.py` (no dependencies): `npm run dev` (watch + preview server + Vite builds), `npm run dev:blog` (same without Vite builds), `npm run build` (one-shot blog build). Extra flags pass through: `npm run dev -- --port=9000`.

## Vite projects (set-splitter, zine-formatter)

Each app has its source in `_<name>/` (Vite + TypeScript). The site serves the built copy in `projects/<name>/`.

**How they deploy:** run `npm run dev` (same as `python3 blog/build.py --watch`). That starts the local preview server at http://localhost:8000. It also builds every project listed in `VITE_PROJECTS` into `projects/<name>/`, and rebuilds one whenever its source changes. Commit the built `projects/<name>/` files along with the source. Pushing to `main` then publishes them.

- To add a new app, create `_<name>/` (copy `_zine-formatter/` as a template, keeping `base: "./"` in `vite.config.ts`) and add `<name>` to `VITE_PROJECTS` in `blog/build.py`.
- Every blog build, including `--watch` on startup, rewrites `blog/feed.xml` and the date in `blog/src/template.txt`, and `--watch` also builds draft posts. Stopping `--watch` with Ctrl+C runs a clean build that drops the drafts again. If you stop it any other way (for example by killing a background job), run `npm run build` (`python3 blog/build.py`) yourself. Don't commit `feed.xml` or `template.txt` changes you didn't intend to make.
- Blog drafts live in `blog/drafts/`, which is gitignored so unpublished posts never reach the public repo. To publish one, move it to `blog/src/`. Anything in `blog/src/` is committed and published.
- `.github/workflows/<name>.yml` is a fallback GitHub Action that builds an app and commits the result. It only runs when started by hand from the Actions tab; running it on push would add a bot commit to `main` and make local pushes fail.
- To build an app once without the server: `npm run build` in `_<name>/`, then copy `dist/` over `projects/<name>/`.

## Pushing

Git in Claude sessions has no GitHub login, so pushes fail. Commit locally and ask the user to push:

```bash
cd ~/dev/archizzl.github.io && git push
```
