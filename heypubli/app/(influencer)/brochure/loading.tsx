/**
 * The brochure's own skeleton, so it does not borrow the dashboard's four-tile
 * one from app/(influencer)/loading.tsx. This page is slow on purpose, it waits
 * on an Instagram metrics call, so what shows during that wait has to look like
 * the page that is coming: paper, a masthead, a column of prose.
 */
export default function BrochureLoading() {
  return (
    <div className="min-h-screen animate-pulse" style={{ backgroundColor: "#FAF7F2" }}>
      <div className="mx-auto w-full max-w-[44rem] px-5 pb-28 pt-10 sm:px-10 sm:pt-16">
        <div className="h-3 w-28 rounded-full bg-[#E5E7EB]" />
        <div className="mt-5 h-11 w-64 rounded-2xl bg-[#E5E7EB] sm:h-16" />
        <div className="mt-5 h-4 w-full max-w-sm rounded-full bg-[#E5E7EB]" />
        <div className="mt-2 h-4 w-3/4 max-w-xs rounded-full bg-[#E5E7EB]" />
        <div className="mt-8 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-1.5 flex-1 rounded-full bg-[#E5E7EB]" />
          ))}
        </div>

        {[0, 1].map((i) => (
          <div key={i} className="mt-14 space-y-4">
            <div className="h-14 w-20 rounded-2xl bg-[#E5E7EB]" />
            <div className="h-8 w-56 rounded-2xl bg-[#E5E7EB]" />
            <div className="h-4 w-full rounded-full bg-[#E5E7EB]" />
            <div className="h-4 w-5/6 rounded-full bg-[#E5E7EB]" />
            <div className="h-40 w-full rounded-2xl bg-[#E5E7EB]" />
          </div>
        ))}
      </div>
    </div>
  );
}
