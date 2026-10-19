# portfolios: how tagging works

The homepage has two portfolios, **photo** and **design**. Each one is a
thumbnail that opens its own gallery. What's in each gallery comes from
**Cloudinary tags**.

| portfolio | Cloudinary tag     | sections file                      |
|-----------|--------------------|------------------------------------|
| photo     | `photo-portfolio`  | `hpi/gallery/photo/sections.json`  |
| design    | `design-portfolio` | `hpi/gallery/design/sections.json` |

## tags vs collections

A **tag** is a label on an image. An image can have any number of tags.
Cloudinary publishes a list of every image with a given tag, and the site
reads that list each time someone opens the homepage.

A **collection** is a folder-like grouping that only exists inside the
Cloudinary console. **The site never looks at collections.** Adding an image
to the Design Portfolio collection does nothing on its own. It has to be
tagged `design-portfolio`. Collections are still handy for keeping things
organised and for tagging lots of images at once.

## adding images

1. Upload the image to Cloudinary.
2. Give it the tag:
   - **one image:** open it in the Media Library. In the panel on the right,
     type the tag into **Tags** and press Enter.
   - **lots of images:** select them (tick one, then use the arrow next to
     the checkbox to choose *Select All Assets on Page*). Then:
     - in a **collection**, click the tag icon in the bar at the top
     - in **Assets**, click the *Metadata* icon → *Edit Tags*

     Type the tag, press Enter, then click **Update**.

You don't need to run or commit anything. The image appears on the live site
straight away, at the end of that gallery's grid in an untitled group.
Cloudinary caches the list briefly, so it can take a minute or so.

The same box has a **Remove tags** section, so you can swap one tag for
another in a single step.

## removing images

Remove the tag from the image (same places as above). It disappears from
the site straight away, even if a section still lists it. The next time you
open the editor, it takes the image out of its section and saves. Commit
`sections.json` if you want the file itself tidied up too.

To move an image from one portfolio to the other, swap its tag.

## sections (titles and descriptions)

Sections are optional. They live in each gallery's `sections.json`, which you
edit with the local editor. Run either of these:

    python3 blog/build.py --watch        # then open localhost:8000/gallery-editor/
    python3 _gallery-editor/editor.py    # opens localhost:8124/

There's a tab for each portfolio. Drag images into sections and give each
section a title and description. Changes save a few seconds after you stop
editing. **Commit and push the `sections.json` file** to publish them.
Sections are the only part that needs a commit.

"preview grid" opens the homepage straight to that gallery's grid.

## links to the galleries

Each portfolio has its own page, which opens straight onto its grid:
**`archizzl.com/photo`** and **`archizzl.com/design`**. Closing the
gallery there (× or Esc) goes to the homepage. These are the links to share.
The pages are `photo/index.html` and `design/index.html`.

`archizzl.com/?gallery=photo` (or `=design`) also works. It opens the
gallery on top of the homepage instead.

## embeds (album players, articles)

A section can also hold things that aren't Cloudinary images. In the editor,
click **+ embed** on a section and paste a link:

- **Bandcamp album or track page, Spotify link, or YouTube video:** this
  becomes a **player** that plays inside the gallery. The editor finds the
  title and cover art itself. For Bandcamp, use the album's own page
  (`…bandcamp.com/album/…`), not the artist's front page.
- **Instagram post or reel:** this becomes the post's own Instagram embed.
  Use the post's link (… → *Copy link*), not your profile. Instagram won't
  share post details with the editor, so type a title and set the
  thumbnail yourself. The Cloudinary copy of the photo works well.
- **Anything else, e.g. an article:** this becomes a **link card**: a
  picture, the title, and a "read on nytimes.com ↗" link. Most news sites
  won't let themselves be embedded, so a card is the reliable option.
- **Embed code:** you can also paste a site's `<iframe …>` embed code, and
  the editor reads the player from it.

Some sites (the NYT, for example) block the editor from reading their page.
You then fill in the title and thumbnail yourself. The thumbnail can be any
image URL or the public ID of an image in Cloudinary, such as one of your
photos that the article used.

Embeds live only in the sections file, not in Cloudinary. They don't need
tags, they can't go in unsorted, and deleting one is permanent. Hover a tile
and click ✎ to edit one or × to delete it. Drag them around like images. In
the grid they show their thumbnail; link cards get a small ↗ badge.
Leaving a player stops it.

## the backup lists

`hpi/gallery/<id>/photos.json` is a saved copy of each tag's image list. The
site only uses it if Cloudinary's list fails to load. It doesn't update
itself, so don't worry if it's out of date.

The live tag lists only work because **Resource list** is unticked in
Cloudinary under Settings → Security → Restricted media types. If that's
ever ticked again, the site falls back to the backup lists and stops picking
up new images.

## adding a third portfolio

1. Pick a tag (e.g. `video-portfolio`) and tag the images with it.
2. Add an entry to `hpi/gallery/galleries.json`:
   `{ "id": "video", "label": "video portfolio", "tag": "video-portfolio" }`
3. Create `hpi/gallery/video/sections.json` containing `{ "sections": [] }`.
4. For an `archizzl.com/video` link, copy `photo/index.html` to
   `video/index.html` and change `photo` to `video` in it (the title and
   `data-gallery-page="photo"`).

The homepage thumbnail, gallery and editor tab all come from that list.
Only image files work, not Cloudinary videos.
