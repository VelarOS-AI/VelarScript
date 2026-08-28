# VelarScript brand assets

## Names

**VelarScript** is the language; **Velar** is the platform; `Vel` is the
written short form of the language. English never says "Velar Framework".
The reasoning is [D105](../../docs/decisions/D105-PLATFORM-NAME-AND-PRONUNCIATION.md).

Pronunciation is custom, not dictionary: `V` sounds like a `W` and the ending
rhymes with *well*, not *car*.

| Written | Said |
| --- | --- |
| `Vel` | *well* `/wɛl/` |
| `Velar` | *WAI-ler* `/ˈwaɪ.lɛr/` |
| `VelarScript` | *WAI-ler-script* `/ˈwaɪ.lɛr.skrɪpt/` |
| `VelarOS` | *WAI-ler-oss* `/ˈwaɪ.lɛr.ɒs/`, one word, not spelled out |

## The mark

`velarscript-mark.svg` is the canonical VelarScript language mark. Consumer
repositories may carry byte-for-byte copies because Workbench, Website, and the
language toolchain release independently.

The mark is the standalone V/S symbol:

- no enclosing tile, frame, border, or badge;
- `V` is the primary silhouette and `S` is formed by negative space;
- canonical brand ink is `#181818` on light brand surfaces;
- editor and file-type surfaces may render the shape with `currentColor` for
  accessible light/dark-theme contrast;
- preserve the view box, geometry, and negative space when exporting raster
  assets.

The PNG beside the SVG is a 512 × 512 transparent export for raster-only
surfaces. `create-velar` projects the same SVG into generated project `public/`
directories, and `packages/desktop/native/macos/VelarScript.icns` is the derived
macOS application export. The SVG remains the design source.

## Derived exports

These three are generated from the SVG above — never hand-edited:

```sh
node scripts/render-brand-assets.mjs
```

| File | Size | Where it goes |
| --- | --- | --- |
| `velarscript-avatar.png` | 512 × 512 | the `VelarOS-AI` organization avatar |
| `velarscript-social-preview-dark.png` | 1280 × 640 | the repository social preview |
| `velarscript-social-preview-light.png` | 1280 × 640 | light-surface alternate of the same card |

The avatar is ink on white rather than a dark tile, so that on a light surface
no tile is visible at all and the rule above still holds; a dark surface is the
one place the white ground becomes a tile, and that is unavoidable.

The social preview card carries the positioning sentence, so **re-render it
whenever the positioning changes** — that is why the card is a script rather
than a checked-in design file.

Both are uploaded by hand: GitHub exposes neither the organization avatar nor
the repository social preview through its API. Avatar lives in the
organization's *Settings → Profile*; the preview in the repository's
*Settings → General → Social preview*.
