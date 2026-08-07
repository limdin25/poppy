// TextBlock.tsx: display type that is guaranteed to fit its box.
//
// TWO MEASUREMENTS EXIST AND THEY DO DIFFERENT JOBS. estimateLines() in fonts.ts
// runs in node against a metrics table and decides which hooks are allowed into
// the bank at all. This one runs in the browser against the real loaded font and
// decides what actually gets drawn. The first has to work without a browser; the
// second has to be exact. Neither replaces the other.
//
// Every line is nowrap and the whole block is scaled down if the widest line
// overshoots, so the browser can never re-wrap into an extra line and push text
// out of its box. Scaling only ever shrinks, never grows.

import { useMemo } from 'react';
import { font, sizeForCap, type FontKey } from '../fonts';
import { estimateLines } from '../fonts';
import { useTextMeasurer } from './useVariantFont';

export interface TextBlockProps {
  readonly text: string;
  /**
   * Break here, instead of wrapping `text` automatically.
   *
   * The end card's three lines are written, not wrapped, and they have to share
   * ONE scale. Rendered as three separate blocks they each fit themselves, so a
   * long line quietly comes out smaller than the two above it and the end card
   * looks broken in exactly the faces where the copy is tightest. `text` is
   * still required, as the thing being measured and the thing a reader of this
   * call can see.
   */
  readonly lines?: readonly string[];
  readonly fontKey: FontKey;
  readonly capPx: number;
  readonly widthPx: number;
  readonly maxLines: number;
  readonly color: string;
  readonly align: 'left' | 'center';
  /**
   * Shrink the block to its widest line instead of holding the full width.
   *
   * Only needed when something is drawn BEHIND the text and has to hug it. A
   * full-width box with a background reads as a bar across the screen; a hugging
   * one reads as a caption. Measurement is unaffected either way, because the
   * fitting maths works off measured text and never off the element's width.
   */
  readonly fitContent?: boolean;
  /** Rendered per line, so callers can stagger an entrance. */
  readonly lineStyle?: (index: number) => React.CSSProperties;
}

export const TextBlock: React.FC<TextBlockProps> = ({
  text,
  lines: given,
  fontKey,
  capPx,
  widthPx,
  maxLines,
  color,
  align,
  fitContent,
  lineStyle,
}) => {
  const spec = font(fontKey);
  const measure = useTextMeasurer();

  const { lines, fontSize, scale } = useMemo(() => {
    const size = Math.max(spec.minSize, sizeForCap(spec, capPx));
    const upper = spec.transform === 'uppercase';
    const cased = upper ? text.toUpperCase() : text;
    let ls = given
      ? given.map((l) => (upper ? l.toUpperCase() : l))
      : estimateLines(cased, spec, size, widthPx);

    // The estimate can put too many lines on the page for a face narrower than
    // its metrics suggested. Merging back up is safe because the scale below
    // catches any overflow it causes.
    while (!given && ls.length > maxLines && ls.length > 1) {
      const merged: string[] = [];
      for (let i = 0; i < ls.length; i += 2) {
        merged.push([ls[i], ls[i + 1]].filter(Boolean).join(' '));
      }
      ls = merged;
    }

    const cssFont = `${spec.style} ${spec.weight} ${size}px "${spec.family}"`;
    const widest = Math.max(...ls.map((l) => measure(l, cssFont)), 1);
    // Tracking is applied in CSS, so account for it here or a tight face
    // measures wider than it draws and gets shrunk for no reason.
    const tracked = widest + spec.tracking * size * Math.max(...ls.map((l) => l.length), 1);
    return {
      lines: ls,
      fontSize: size,
      scale: Math.min(1, widthPx / Math.max(tracked, 1)),
    };
  }, [text, given, spec, capPx, widthPx, maxLines, measure]);

  return (
    <div
      style={{
        width: fitContent ? 'max-content' : widthPx,
        maxWidth: widthPx,
        textAlign: align,
        transform: `scale(${scale})`,
        transformOrigin: align === 'center' ? 'top center' : 'top left',
      }}
    >
      {lines.map((line, i) => (
        <div
          key={`${line}-${i}`}
          style={{
            fontFamily: `"${spec.family}"`,
            fontWeight: spec.weight,
            fontStyle: spec.style,
            fontSize,
            lineHeight: spec.lineHeight,
            letterSpacing: `${spec.tracking}em`,
            color,
            whiteSpace: 'nowrap',
            textAlign: align,
            ...(lineStyle?.(i) ?? {}),
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
};
