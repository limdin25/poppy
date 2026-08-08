import React from 'react'
import { Composition } from 'remotion'
import { FlowVideo } from './FlowVideo'
import { PosterV } from './comps/PosterV'
import { VariantVideo } from './variants/VariantVideo'
import { DEFAULT_VARIANT_PROPS, variantSchema } from './variants/schema'
import { deriveRecipe, seedFor, totalFrames } from './variants/recipe'
import {
  DEFAULT_FLYWHEEL_PROPS,
  FLYWHEEL_FRAMES,
  FlywheelVsl,
  flywheelSchema,
} from './flywheel/FlywheelVsl'

// 1080x1920 @ 30fps. v12: 3rd HeyGen recording at 1.2x — 152.08s speech
// (4562f) + a 3s end-card hold on the CTA = 4650f.
export const FPS = 30

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FlowVideo"
        component={FlowVideo}
        durationInFrames={4650}
        fps={FPS}
        width={1080}
        height={1920}
      />
      {/* 16:9 page-preview still (worker renders --frame=120 for the actor pose) */}
      <Composition
        id="PosterV"
        component={PosterV}
        durationInFrames={246}
        fps={FPS}
        width={1280}
        height={720}
      />

      {/*
        The short-form variation factory. Independent of everything above it:
        it takes its data from inputProps and touches no part of the VSL tree,
        including data/lead-gen.json, which the VSL worker rewrites and reverts
        around every render.

        Duration is not a constant. It is the source length, minus the seeded
        head trim, plus the fixed ten second end card, so it differs per source
        AND per variant. That is also the cheapest end-to-end proof that props
        actually reached the composition: if they silently did not, every file
        would come out at the defaultProps length.
      */}
      <Composition
        id="VariantVideo"
        component={VariantVideo}
        schema={variantSchema}
        defaultProps={DEFAULT_VARIANT_PROPS}
        fps={FPS}
        width={1080}
        height={1920}
        calculateMetadata={({ props }) => ({
          durationInFrames: totalFrames(
            props.sourceId,
            deriveRecipe(
              seedFor(props.sourceId, props.variantIndex, props.recipeVersion),
              props.sourceId,
            ),
          ),
        })}
      />

      {/*
        The Flywheel sales video. 16:9 because it plays on a page, not in a feed.

        Duration is not a constant here either: it comes from the edit plan, so
        re-running scripts/flywheel-plan.mjs with different cut rules re-times
        the composition without anyone having to update a number by hand.
      */}
      <Composition
        id="FlywheelVsl"
        component={FlywheelVsl}
        schema={flywheelSchema}
        defaultProps={DEFAULT_FLYWHEEL_PROPS}
        durationInFrames={FLYWHEEL_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  )
}
