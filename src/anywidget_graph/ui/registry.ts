// Categorical colours (shared, byte for byte, by anywidget-graph and anywidget-vector).
//
// The eight data colours go to the largest categories by count (ties by name); every other category is "Other".
// A category keeps its slot for the life of the registry (a widget instance): later batches, query results and
// reruns never repaint it, and a slot whose category disappears is not handed out again. Colours are looked up by
// slot, so a theme switch shows the same slot in the other theme's colour.

/** The colours of one theme: eight data slots in fixed order, Other, the background and the edge colour. */
export interface Palette {
  data: string[];
  other: string;
  background: string;
  edge: string;
}

export const SLOTS = 8;

export class CategoryRegistry {
  private slots = new Map<string, number>();
  private other = new Set<string>();
  private next = 0;

  /** Give the largest new categories the free slots, in descending count (ties by name); the rest become Other. */
  assign(counts: Map<string, number>): void {
    const fresh = [...counts.entries()]
      .filter(([category]) => !this.slots.has(category) && !this.other.has(category))
      .sort(([a, ca], [b, cb]) => cb - ca || (a < b ? -1 : a > b ? 1 : 0));
    for (const [category] of fresh) {
      if (this.next < SLOTS) this.slots.set(category, this.next++);
      else this.other.add(category);
    }
  }

  /** The category's slot (0 to 7), or null for Other and for a category never assigned. */
  slot(category: string): number | null {
    return this.slots.get(category) ?? null;
  }

  /** The category's colour in a theme: its slot's data colour, else Other. */
  colorFor(category: string, palette: Palette): string {
    const slot = this.slot(category);
    return slot === null ? palette.other : palette.data[slot];
  }
}

/** How often each key occurs, in first-seen order; items without a key are skipped. */
export function countBy<T>(items: Iterable<T>, key: (item: T) => string | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

type RGB = [number, number, number];

/** #rgb, #rrggbb (#rrggbbaa: its colour), rgb() or rgba(); null for anything else. */
function parsed(color: string): RGB | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.split("").map((d) => d + d).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
  }
  // The comma form rgb(r, g, b[, a]) or the space form rgb(r g b[ / a]), not a mix of the two
  const n = String.raw`(\d{1,3}(?:\.\d+)?)`;
  const rgb = new RegExp(String.raw`^rgba?\(\s*${n}\s*,\s*${n}\s*,\s*${n}\s*(?:,\s*[\d.]+%?\s*)?\)$`, "i").exec(c)
    ?? new RegExp(String.raw`^rgba?\(\s*${n}\s+${n}\s+${n}\s*(?:\/\s*[\d.]+%?\s*)?\)$`, "i").exec(c);
  return rgb ? (rgb.slice(1, 4).map((v) => Math.round(Math.min(255, Number(v)))) as RGB) : null;
}

const RESOLVED = new Map<string, RGB | null>();

/** A colour's channels: parsed directly, else (a CSS name, hsl()) through the browser's own colour parser. */
function channels(color: string): RGB | null {
  const direct = parsed(color);
  if (direct || typeof document === "undefined") return direct;
  if (!RESOLVED.has(color)) {
    const ctx = document.createElement("canvas").getContext("2d");
    let rgb: RGB | null = null;
    if (ctx) {
      // The canvas ignores a colour it cannot read and keeps the one before: read it over two different colours,
      // and only a colour that replaced both is real
      ctx.fillStyle = "#000000";
      ctx.fillStyle = color;
      const overBlack = String(ctx.fillStyle);
      ctx.fillStyle = "#ffffff";
      ctx.fillStyle = color;
      rgb = overBlack === String(ctx.fillStyle) ? parsed(overBlack) : null;
    }
    RESOLVED.set(color, rgb);
  }
  return RESOLVED.get(color) ?? null;
}

/**
 * `color` at `alpha` over `background`, as an opaque #rrggbb (so nothing behind shows through). Any CSS colour a
 * host passes works; one that cannot be read comes back unchanged (a solid fill rather than a broken one).
 */
export function mixOver(color: string, background: string, alpha: number): string {
  const c = channels(color);
  const b = channels(background);
  if (!c || !b) return color;
  return "#" + c.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i]).toString(16).padStart(2, "0")).join("");
}
