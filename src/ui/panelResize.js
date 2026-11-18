// Pure resize geometry for floating panels; PanelPositionControls wires the DOM.

const EDGE_MARGIN_PX = 6;
export const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'sw', 'se'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Edges named in `dir` follow the pointer (dx, dy since gesture start) and the
 * opposite edge stays put. Minimum size and the viewport margin win.
 */
export function resizeBox(
  box,
  dir,
  dx,
  dy,
  {
    minWidth,
    minHeight,
    viewportWidth = Infinity,
    viewportHeight = Infinity,
    margin = EDGE_MARGIN_PX,
    bounds = {
      left: margin,
      top: margin,
      right: viewportWidth - margin,
      bottom: viewportHeight - margin,
    },
  } = {},
) {
  const maxWidth = bounds.right - bounds.left;
  const maxHeight = bounds.bottom - bounds.top;
  minWidth = Math.min(minWidth, maxWidth);
  minHeight = Math.min(minHeight, maxHeight);

  // A rail window can start outside new bounds, or below its floating minimum.
  let width = clamp(box.width, minWidth, maxWidth);
  let height = clamp(box.height, minHeight, maxHeight);
  let left = clamp(box.left, bounds.left, bounds.right - width);
  let top = clamp(box.top, bounds.top, bounds.bottom - height);
  const right = left + width;
  const bottom = top + height;
  if (dir.includes('e'))
    width = clamp(box.width + dx, minWidth, bounds.right - left);
  if (dir.includes('s'))
    height = clamp(box.height + dy, minHeight, bounds.bottom - top);
  if (dir.includes('w')) {
    width = clamp(box.width - dx, minWidth, right - bounds.left);
    left = right - width;
  }
  if (dir.includes('n')) {
    height = clamp(box.height - dy, minHeight, bottom - bounds.top);
    top = bottom - height;
  }
  return { left, top, width, height };
}
