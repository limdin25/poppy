// lucide-react v1 dropped every brand icon, so there is no Instagram export to import
// (`grep "declare const Instagram" node_modules/lucide-react/dist/lucide-react.d.ts`
// returns nothing). This is the glyph, hand rolled, drawn to match lucide's 24px grid and
// stroke conventions so it sits correctly next to the lucide icons around it.
export function InstagramGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
