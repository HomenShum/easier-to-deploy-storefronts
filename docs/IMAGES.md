# Images this template expects

The HTML references several image files at the repo root. The repo doesn't ship them — drop your own to make the site visually complete. Without them, the layout still works but you'll see broken-image icons in a few places.

## Required (visible above the fold)

| File | Used by | Recommended size | Notes |
|---|---|---|---|
| `hero.{avif,webp,jpg}` | Hero background on every landing page | 1600×1200 px | Photographed warm interior or business setting. Used as `<link rel="preload">` so it loads first. |
| `owner.{avif,webp,jpg}` | Host bio section on every landing page | 400×400 px | Square portrait of the owner. **Bake-in:** the alt text reads "the owner of your business" — replace with the owner's actual name when you ship. |
| `og.{jpg,webp}` | Open Graph card for social sharing (`og:image`, `twitter:image`) | 1200×630 px | The image people see when the URL is shared on Facebook, iMessage, etc. Cropped tight on the subject. |

## Nice-to-have (further down the page)

The English landing page references these in the JSON-LD `image` array; not strictly required for the layout to render but used by Google's rich-result preview:

| File | Recommended size |
|---|---|
| `couch.{avif,webp,jpg}` | 1200×900 |
| `pack.{avif,webp,jpg}` | 1200×900 |
| `nuzzle.{avif,webp,jpg}` | 1200×900 |
| `critters.{avif,webp,jpg}` | 1200×900 |
| `pet.{avif,webp,jpg}` | 1200×900 |
| `ride.{avif,webp,jpg}` | 1200×900 |

You can drop these and remove the corresponding entries from the JSON-LD `image` array in `index.html` if you don't have them.

## How to generate the three formats from one source

Each filename is a triple — `.avif` for newest browsers, `.webp` for most browsers, `.jpg` as the fallback. From a single source image (e.g. `original.jpg`):

```bash
# Using ffmpeg (cross-platform, no extra installs needed if you have it):
ffmpeg -i original.jpg -vf "scale=1600:-1" hero.jpg
ffmpeg -i original.jpg -vf "scale=1600:-1" -c:v libwebp -quality 80 hero.webp
ffmpeg -i original.jpg -vf "scale=1600:-1" -c:v libaom-av1 -still-picture 1 hero.avif

# Using ImageMagick + cwebp + avifenc:
convert original.jpg -resize 1600x hero.jpg
cwebp -q 80 hero.jpg -o hero.webp
avifenc --min 25 --max 35 hero.jpg hero.avif

# Using a hosted converter (zero local setup):
# Drop original.jpg into https://squoosh.app, export each format separately.
```

## Why three formats

The HTML uses `<picture>` / `<source>` to serve the smallest format the browser supports:

```html
<picture>
  <source srcset="owner.avif" type="image/avif" />  <!-- ~30-50% smaller than JPEG -->
  <source srcset="owner.webp" type="image/webp" /> <!-- ~25-35% smaller than JPEG -->
  <img src="owner.jpg" alt="..." />                <!-- universal fallback -->
</picture>
```

You can ship just `.jpg` (delete the `<source>` lines) if you want simplicity over bandwidth savings. For a solo-operator site at <100 visitors/day, the JPEG-only approach is fine.

## Privacy notes

- The original deployment shipped `yan.{avif,webp,jpg}` as the host portrait. We renamed the slot to `owner.*` in this template so forks don't accidentally reference the original portrait file path.
- Customer-facing photos (e.g. dogs the owner has cared for) are public-by-nature on a service business website, but consider written consent if your jurisdiction requires it. The template does not assume any release.
