# Brand assets

Generated from the marks already in the site's CSS, so these stay consistent
with what a visitor sees rather than introducing a second identity.

- **Coral** `#ff5d73` — the accent, and the "Me" in the wordmark
- **Plum** `#241f30` — the ink, and the header background

`logo-mark.svg` is the source. Its three round corners and one sharp-ish
bottom-left match `.logo-mark` in `css/styles.css`; it reads as a message
bubble, which is the right cue for an SMS-first product.

| File | Use |
|---|---|
| `logo-horizontal-1200.png` | Affiliate network profiles, partner pages — anywhere the name should be readable |
| `logo-mark-512.png` | Square/avatar slots |
| `logo-mark-200.png` | Small square slots |
| `*.svg` | Source. Re-render at any size (see below) |

PNGs are transparent, so they sit on white or light backgrounds. Re-render with:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --default-background-color=00000000 --window-size=512,512 \
  --screenshot=out.png file:///absolute/path/to/logo-mark.svg
```
