/**
 * Purpose: Pure image-processing utilities for the Layout Editor.
 *
 * Downstream impact: consumed by the LayoutEditor toolbar for floor-plan image
 *   ingestion and rotation (ingestImage, rotateImage90).
 */

/**
 * Purpose: Downsample an image data-URL to at most 2 400 px on its longest edge.
 *
 * Formula: scale = MAX / max(widthPx, heightPx); new dimensions = round(original × scale).
 *
 * Inputs:
 *   @param dataUrl  — Base-64 encoded image data-URL.
 *   @param widthPx  — Original image width in pixels.
 *   @param heightPx — Original image height in pixels.
 *
 * Downstream impact: drives the LayoutEditor image store; large originals slow
 *   the workspace serialisation and inflate the offline HTML artefact size.
 *
 * @returns Resized image data-URL and final pixel dimensions.
 */
export async function resizeDataUrl(
  dataUrl: string,
  widthPx: number,
  heightPx: number,
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const MAX = 2400;
  if (Math.max(widthPx, heightPx) <= MAX) return { dataUrl, widthPx, heightPx };
  const scale = MAX / Math.max(widthPx, heightPx);
  const nw = Math.round(widthPx * scale);
  const nh = Math.round(heightPx * scale);
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d')!;
  await new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { ctx.drawImage(im, 0, 0, nw, nh); res(); };
    im.src = dataUrl;
  });
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), widthPx: nw, heightPx: nh };
}

/**
 * Purpose: Rotate a floor-plan image 90° clockwise and re-encode as JPEG.
 *   Resets calibration because the pixel-to-metre mapping changes after rotation.
 *
 * Inputs:
 *   @param dataUrl  — Source image data-URL.
 *   @param widthPx  — Original width in pixels.
 *   @param heightPx — Original height in pixels.
 *
 * Downstream impact: written back to the active FloorPlan.image; the
 *   LayoutEditor calibration state is cleared and must be redone by the user.
 *
 * @returns New data-URL with swapped width/height dimensions.
 */
export async function rotateDataUrl90(
  dataUrl: string,
  widthPx: number,
  heightPx: number,
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = heightPx;
  canvas.height = widthPx;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(Math.PI / 2);
  await new Promise<void>((res) => {
    const im = new Image();
    im.onload = () => { ctx.drawImage(im, -widthPx / 2, -heightPx / 2); res(); };
    im.src = dataUrl;
  });
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), widthPx: heightPx, heightPx: widthPx };
}
