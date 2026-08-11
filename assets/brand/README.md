# VelarScript brand mark

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
