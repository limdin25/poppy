// CtaCard.tsx: the fixed ten second end card.
//
// Copy is the same on every video, by Hugo's decision: the message and a link in
// bio instruction, nothing else. No wordmark, no handle, no URL. That is what
// lets any of these be posted from any account without a re-render, which
// matters far more at a thousand files than at sixteen.
//
// It draws its own background rather than sitting on the body's, so it can be
// rendered standalone. In the phase 2 fast path this becomes a short clip that
// is cached per style and concatenated, instead of being re-rendered per variant.

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { CANVAS, CTA_TEXT_AREA } from '../geometry';
import { CTA, offer, reveal } from '../hooks';
import { font } from '../fonts';
import { ON_ACCENT_HEX } from '../palettes';
import type { VariantPlan } from '../plan';
import { Background } from './Background';
import { TextBlock } from './TextBlock';

export const CtaCard: React.FC<{ plan: VariantPlan }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = font(plan.font);
  const lead = plan.recipe.ctaLeadFrames;

  const enter = (delay: number) =>
    spring({ frame: frame - lead - delay, fps, config: { damping: 20, stiffness: 110 } });

  const layout = plan.ctaLayout;
  const align = layout === 'centred' ? 'center' : 'left';

  const lines = offer(plan.offerId).lines;
  const pill = enter(lines.length * 4 + 10);
  // Tracks the variant's own end card size, or a small-type variant gets a pill
  // sized for a large one and the card stops reading as one piece of design.
  const pillSize = Math.round(plan.recipe.ctaCapPx * 0.62);

  return (
    <AbsoluteFill>
      <Background plan={plan} />

      <div
        style={{
          position: 'absolute',
          left: CTA_TEXT_AREA.x,
          // Nudged up or down per file. Small enough that the block stays well
          // inside the region the contrast gate sampled, big enough that two end
          // cards side by side are not stamped from the same die.
          top: CTA_TEXT_AREA.y + plan.ctaOffsetY,
          width: CTA_TEXT_AREA.w,
          // The block is centred WITHIN the sampled box, not anchored to its
          // top. Anchored, the content sat in the upper half with most of a
          // screen of dead space under it. CTA_TEXT_AREA is already centred on
          // the canvas and it is the region the contrast gate measures, so
          // centring inside it keeps the text where the gate looked.
          height: CTA_TEXT_AREA.h,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: align === 'center' ? 'center' : 'flex-start',
        }}
      >
        {/*
          THE REVEAL, and the only place in the whole video that says it is AI.
          It lands first, above the offer, after the viewer has watched the lot.
          Smaller than the offer on purpose: it is a statement of fact, and
          setting it at headline size turns it into a boast.
        */}
        <div
          style={{
            opacity: enter(0),
            transform: `translateY(${(1 - enter(0)) * 18}px)`,
            marginBottom: 30,
            // Set apart by SIZE and TRACKING rather than by colour, because the
            // accent is not a text colour: measured, ten of the fourteen
            // families never clear the end card floor with it. plan.revealInk
            // hands back the accent on the few that do and the gated ink on the
            // rest, so this reads as a kicker either way.
            letterSpacing: '0.08em',
          }}
        >
          <TextBlock
            text={reveal(plan.revealId).text}
            fontKey={plan.font}
            capPx={Math.round(plan.recipe.hookCapPx * 0.5)}
            widthPx={CTA_TEXT_AREA.w}
            maxLines={1}
            color={plan.revealInk}
            align={align}
          />
        </div>

        {/*
          ONE block, not one per line. Three separate blocks each fit themselves,
          so the longest line comes out at a smaller scale than the two above it
          and the end card looks broken in exactly the faces where the copy is
          tightest. Rendered together they share a single scale and stay a
          paragraph. The per-line entrance still staggers, via lineStyle.
        */}
        <TextBlock
          text={lines.join(' ')}
          lines={lines}
          fontKey={plan.font}
          capPx={plan.recipe.ctaCapPx}
          widthPx={CTA_TEXT_AREA.w}
          maxLines={lines.length}
          color={plan.ink}
          align={align}
          lineStyle={(i) => ({
            opacity: enter(6 + i * 4),
            transform: `translateY(${(1 - enter(6 + i * 4)) * 22}px)`,
          })}
        />

        {layout === 'lowRule' ? (
          <div
            style={{
              width: interpolate(enter(lines.length * 4 + 6), [0, 1], [0, CTA_TEXT_AREA.w * 0.42]),
              height: 6,
              marginTop: 34,
              background: plan.palette.accentFill,
              borderRadius: 3,
            }}
          />
        ) : null}

        {/*
          The action sits in an accent pill with near-black on it. The accent is
          never used as a text colour anywhere in this system (it measures at or
          below the readability floor on its own canvas); it carries text only
          as a FILL, where accentFill is forced light enough that a single
          near-black constant is provably readable on all fourteen families.
        */}
        <div
          style={{
            marginTop: 54,
            padding: `${Math.round(pillSize * 0.55)}px ${Math.round(pillSize * 1.25)}px`,
            borderRadius: 999,
            background: plan.palette.accentFill,
            opacity: pill,
            transform: `scale(${0.94 + pill * 0.06})`,
            fontFamily: `"${spec.family}"`,
            fontWeight: spec.weight,
            fontStyle: spec.style,
            fontSize: pillSize,
            letterSpacing: '0.06em',
            lineHeight: 1,
            color: ON_ACCENT_HEX,
            whiteSpace: 'nowrap',
          }}
        >
          {CTA.action}
        </div>
      </div>

      {/* A stacked layout gets a quiet accent bar at the very bottom. */}
      {layout === 'stacked' ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            width: CANVAS.w,
            height: interpolate(enter(20), [0, 1], [0, 12]),
            background: plan.palette.accentFill,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
