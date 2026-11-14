// The widget's size (shared, byte for byte, by anywidget-vector and anywidget-graph): with no size given it fills
// the width and takes a 16:10 height, at least what the toolbar and the controls need and at most 80% of the screen,
// so it works from a phone to a 4K monitor. An explicit width or height wins.

/** The smallest height without a size given: the toolbar, the controls card and a usable canvas */
export const MIN_HEIGHT = 360;

/** Inline styles for the widget's frame; 0 (or less) means "not given". */
export function wrapperSize(width: number, height: number): Record<string, string> {
  const w = width > 0 ? `${width}px` : "100%";
  if (height > 0) return { width: w, height: `${height}px` };
  return { width: w, aspectRatio: "16 / 10", minHeight: `${MIN_HEIGHT}px`, maxHeight: "80vh" };
}
