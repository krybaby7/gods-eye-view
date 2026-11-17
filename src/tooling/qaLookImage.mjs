import sharp from 'sharp';

/** Save the viewport and derive a pixel crop without another browser capture. */
export async function captureLookImage(
  page,
  fullPath,
  cropPath,
  target,
  viewport,
) {
  await page.screenshot({ path: fullPath, captureBeyondViewport: false });
  const image = sharp(fullPath);
  const { width, height } = await image.metadata();
  if (width !== viewport.width || height !== viewport.height)
    throw new Error(
      `Expected a ${viewport.width}x${viewport.height} screenshot at scale 1, got ${width}x${height}`,
    );
  if (!target) return null;

  const left = Math.max(0, Math.floor(target.left));
  const top = Math.max(0, Math.floor(target.top));
  const right = Math.min(width, Math.ceil(target.right));
  const bottom = Math.min(height, Math.ceil(target.bottom));
  if (!(right > left && bottom > top)) return null;
  const crop = { left, top, width: right - left, height: bottom - top };
  await image.extract(crop).png().toFile(cropPath);
  return crop;
}
