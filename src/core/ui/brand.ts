/* HeyElsie brand tokens — the VSL page is the reference.
 *
 * Hugo 2026-07-26: "redesign our sign up and sign in with same colour blue and
 * white, also change the feeling to be same as the clients vsl page" — and the
 * landing page with them. The per-lead VSL page (api/vsl/page.ts) is the
 * surface that actually converts, so it is the source of truth: white ground,
 * Google blue, one heavy neutral display face, and a single blue button that
 * carries the offer.
 *
 * This lives in src/core because three separate features render it (landing,
 * auth, registration) and features never import each other.
 *
 * The values are kept in lockstep with api/vsl/page.ts and video/src/theme.ts.
 * If the blue changes there, change it here.
 */

/** Google blue — every primary action on every surface. */
export const BLUE = '#1a73e8'
/** Pressed/hover state for the blue. */
export const BLUE_DARK = '#1557b0'
/** The palest blue wash — section backgrounds, icon chips. Never grey. */
export const BLUE_WASH = '#F8FAFD'
/** Body text. */
export const INK = '#1A1A1A'
/** Secondary text. */
export const GREY = '#6B7280'
/** Body text one step darker than GREY, for paragraphs. */
export const GREY_DARK = '#4B5563'
/** Hairline borders. */
export const BORDER = '#E5E7EB'
/** Google's own star gold. Stars stay gold — that is what a review looks like. */
export const STAR = '#FBBC04'

/** Display type: heavy, neutral, never a serif (Inter 900). */
export const DISPLAY = 'font-black tracking-tight'

/** White card, hairline border, soft lift — the VSL page's card recipe. */
export const CARD =
  'border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_6px_18px_rgba(0,0,0,0.06)]'

/** The primary button. Radius 14 and the blue glow are lifted from .cta. */
export const BTN_BLUE =
  'rounded-[14px] bg-[#1a73e8] text-white font-extrabold transition hover:bg-[#1557b0] active:scale-[0.985] shadow-[0_6px_18px_rgba(26,115,232,0.30)] disabled:opacity-40 disabled:hover:bg-[#1a73e8] disabled:active:scale-100'

/** Secondary button — blue text on white, same geometry. */
export const BTN_GHOST =
  'rounded-[14px] border border-[#E5E7EB] bg-white text-[#1A1A1A] font-bold transition hover:border-[#1a73e8] hover:text-[#1a73e8] active:scale-[0.985]'

/** Form field. Focus ring is blue, matching the buttons. */
export const FIELD =
  'h-12 w-full rounded-[14px] border border-[#E5E7EB] bg-white pl-11 pr-4 text-[15px] text-[#1A1A1A] outline-none transition placeholder:text-gray-400 focus:border-[#1a73e8] focus:ring-4 focus:ring-[#1a73e8]/12'

/** Small uppercase section label (.prooflabel on the VSL page). */
export const LABEL =
  'text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-[#6B7280]'
