# media

Screenshots, GIFs and video referenced from `docs/*.md` and from `pcfhub.json`.

PCFHub mirrors these onto its own CDN while it compiles a doc page, and writes
the mirrored URL into the page. Anything it cannot mirror keeps pointing at
`raw.githubusercontent.com`, so a large file still renders — it is just served
from GitHub instead.

Two things follow from that:

- **Keep them small.** There is a per-file ceiling and a per-sync file count on
  the hub's side. Screenshots in the tens of kilobytes mirror; a 40 MB video
  does not.
- **Paths are repository-relative and permanent-ish.** The mirror key is derived
  from the path, so replacing an image at the same path replaces the mirrored
  object. Renaming it strands the old one until the next full sync.

Reference them from a doc page with the `image` and `video` directives, which
take repository-relative paths:

```markdown
::image{src=media/screenshot.png alt="What it shows" zoom}
::video{src=media/walkthrough.mp4 poster=media/walkthrough-poster.png}
```

A video without a poster renders as a blank box until it loads, so always ship
one.

`pcfhub.json` also names a `logo` and up to twelve `screenshots` from here.

## The logo

`logo.svg` is the source and `logo.png` is what the hub reads, at 256x256 RGBA.
Both here are the template's placeholder: the top face of the PCFHub mark, which
is deliberately generic, so a repo that still ships it looks in the catalogue
exactly like one nobody has finished.

The house style, in short. A 96 canvas. The PCFHub ramp verbatim, declared
`userSpaceOnUse` across the whole canvas so the mark reads as one object lit
from the top right. Two weights and no second hue: the ramp, and `#F8FAFC` on
it. One silhouette, and it has to differ from the other controls' marks in that
silhouette rather than only in what sits inside it.

**It is drawn for 32px.** Render every candidate at 80, 40, 32, 24 and
32-on-dark on one page and look, rather than judging it at full size. That is
what catches the readings that kill a mark — a pill with a dot in it is a toggle
switch, a tag with a label bar is a back arrow, two thin rules crossing a card
are a plus sign — and there is a table of the ones already found in *Drawing the
mark*, in the skill's `references/pcfhub-manifest.md`. Record what you rejected
in a comment at the top of `logo.svg`, as the shipped controls do, and keep
double hyphens out of that comment or the file stops parsing as XML.

Render the PNG with the same headless Chrome that takes the screenshots:

```bash
chrome --headless --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 \
  --screenshot=media/logo.png --window-size=256,256 file:///.../logo-256.html
```

where the page is one `<img src="logo.svg">` sized to 256 on a transparent body.
Without `--default-background-color=00000000` the logo ships on an opaque white
square, which is invisible until someone opens the hub's dark theme.
