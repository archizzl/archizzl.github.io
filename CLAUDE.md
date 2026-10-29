# archizzl.github.io

Personal site, served by GitHub Pages from the `master` branch (custom domain in `CNAME`). The local branch is `main`, and it tracks `origin/master`.

Before adding or restyling a page, read `STYLE.md`.

## Vite projects (set-splitter, zine-formatter)

Each app has its source in `_<name>/` (Vite + TypeScript). The site serves the built copy in `projects/<name>/`.

**How they deploy:** run `python3 blog/build.py --watch`. That starts the local preview server at http://localhost:8000. It also builds every project listed in `VITE_PROJECTS` into `projects/<name>/`, and rebuilds one whenever its source changes. Commit the built `projects/<name>/` files along with the source. Pushing to `master` then publishes them.

- To add a new app, create `_<name>/` (copy `_zine-formatter/` as a template, keeping `base: "./"` in `vite.config.ts`) and add `<name>` to `VITE_PROJECTS` in `blog/build.py`.
- Every blog build, including `--watch` on startup, rewrites `blog/feed.xml` and the date in `blog/src/template.txt`, and `--watch` also builds draft posts. Stopping `--watch` with Ctrl+C runs a clean build that drops the drafts again. If you stop it any other way (for example by killing a background job), run `python3 blog/build.py` yourself. Don't commit `feed.xml` or `template.txt` changes you didn't intend to make.
- `.github/workflows/<name>.yml` is a fallback GitHub Action that's meant to build on push. It's set to run on `main`, but the site deploys from `master`, so in practice it never runs. Don't rely on it.
- To build an app once without the server: `npm run build` in `_<name>/`, then copy `dist/` over `projects/<name>/`.

## Pushing

Git in Claude sessions has no GitHub login, so pushes fail. Commit locally and ask the user to push:

```bash
cd ~/dev/archizzl.github.io && git push origin main:master main:main
```
