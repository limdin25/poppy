import Image from "next/image";
import type { Shot } from "./shots";

/**
 * One picture in a step, or the words that replace it.
 *
 * A server component with no client JavaScript. The empty state is not an
 * apology and never says "image coming soon": it is a bordered plate carrying
 * the instruction in words, so a step with no screenshot still teaches itself.
 * When the picture lands it sits in the same slot and the caption underneath
 * is identical in both states.
 */
export function Plate({ shot, index }: { shot: Shot; index: number }) {
  return (
    <figure className="my-7">
      <div className="relative overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white">
        <span className="absolute left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[#1A1A1A] text-[11px] font-black tabular-nums text-white">
          {index}
        </span>

        {shot.src ? (
          <Image
            src={shot.src}
            alt={shot.alt}
            width={shot.width}
            height={shot.height}
            sizes="(min-width: 768px) 420px, 100vw"
            className="h-auto w-full"
          />
        ) : (
          <div
            data-testid={`plate-fallback-${shot.id}`}
            className="flex min-h-[128px] items-center px-5 py-6 pl-14"
          >
            <p className="text-[15px] leading-relaxed text-[#1A1A1A]">{shot.fallback}</p>
          </div>
        )}
      </div>

      <figcaption className="mt-2.5 pl-1 text-[13px] leading-snug text-[#6B7280]">
        {shot.caption}
      </figcaption>
    </figure>
  );
}
