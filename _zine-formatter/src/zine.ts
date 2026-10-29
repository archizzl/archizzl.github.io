// Port of ~/Desktop/Designs/Zines/zine_formatter.py.
//
// The input is a 2-row × 4-column sheet of zine pages. It's cut into 8 tiles
// (numbered row-major, 0–7), tiles 0, 1, 6 and 7 are flipped 180°, and the
// tiles are re-laid in the order below so the printed sheet folds into an
// 8-page zine.

export const ROWS = 2;
export const COLS = 4;

/** Output slot (row-major) → input tile number. */
export const ORDER = [1, 0, 7, 6, 2, 3, 4, 5];

/** Input tiles that get rotated 180°. */
export const FLIPPED = new Set([0, 1, 6, 7]);

export function zineify(src: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  // Integer tile size like split_image; any leftover edge pixels are dropped.
  const tw = Math.floor(width / COLS);
  const th = Math.floor(height / ROWS);

  const out = document.createElement("canvas");
  out.width = tw * COLS;
  out.height = th * ROWS;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  ORDER.forEach((tile, slot) => {
    const sx = (tile % COLS) * tw;
    const sy = Math.floor(tile / COLS) * th;
    const dx = (slot % COLS) * tw;
    const dy = Math.floor(slot / COLS) * th;

    ctx.save();
    if (FLIPPED.has(tile)) {
      // Rotate about the centre of the destination slot.
      ctx.translate(dx + tw, dy + th);
      ctx.rotate(Math.PI);
      ctx.drawImage(src, sx, sy, tw, th, 0, 0, tw, th);
    } else {
      ctx.drawImage(src, sx, sy, tw, th, dx, dy, tw, th);
    }
    ctx.restore();
  });

  return out;
}
