import Image from "next/image";
import { CalendarClock, Megaphone, TriangleAlert } from "lucide-react";
import { formatSaoPaulo } from "@/lib/timezone";
import type { MyCampaignStatus } from "@/lib/data/campaigns";
import type { PostMediaType, Profile } from "@/types/database";
import { CopyLinkButton } from "./CopyLinkButton";

const TIERS = [
  {
    name: "Starter",
    threshold: 0,
    products: [{ alt: "ScanPlates", logo: "/brands/scanplates.svg" }],
  },
  {
    name: "Growth",
    threshold: 10,
    products: [
      { alt: "Florê", logo: "/brands/flore.svg" },
      { alt: "Raízes", logo: "/brands/raizes.svg" },
      { alt: "Aurora", logo: "/brands/aurora.svg" },
    ],
  },
  {
    name: "Professional",
    threshold: 50,
    products: [
      { alt: "Pet Lar", logo: "/brands/petlar.svg" },
      { alt: "Casa Viva", logo: "/brands/casaviva.svg" },
      { alt: "Bem Leve", logo: "/brands/bemleve.svg" },
      { alt: "Studio Fit", logo: "/brands/studiofit.svg" },
    ],
  },
  {
    name: "VIP",
    threshold: 200,
    products: [
      { alt: "Nike", logo: "/brands/nike.svg" },
      { alt: "Adidas", logo: "/brands/adidas.svg" },
      { alt: "Puma", logo: "/brands/puma.svg" },
      { alt: "Samsung", logo: "/brands/samsung.svg" },
      { alt: "Sony", logo: "/brands/sony.svg" },
    ],
  },
];

export interface InstagramData {
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profilePictureUrl?: string;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
  accountType: string;
  isConnected: boolean;
  // Outstand's basic API doesn't expose follower/post counts; hide the stat row then.
  statsAvailable?: boolean;
}

interface DashboardHomeProps {
  profile: Profile;
  instagram: InstagramData | null;
  connectUrl?: string;
  shareLink: string | null;
  /** The bare tag ("maria-silva") — doubles as a typeable code at checkout. */
  referralTag?: string | null;
  clicks: number;
  sales: number;
  earnings: number;
  campaignStatus: MyCampaignStatus | null;
  // Their referral link isn't in the Instagram bio yet (checked via the API).
  bioLinkMissing?: boolean;
  /** When false every Instagram card is hidden (see lib/flags.ts). */
  instagramEnabled?: boolean;
}

const MEDIA_TYPE_LABELS: Record<PostMediaType, string> = {
  feed: "Feed",
  story_image: "Story",
  story_video: "Story",
  reel: "Reel",
  carousel: "Carousel",
};

function CampaignStatusCard({ status }: { status: MyCampaignStatus | null }) {
  if (!status) {
    return (
      <div className="flex items-start gap-4 rounded-2xl border border-border p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
          <Megaphone className="h-5 w-5 text-warning" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Campaign</h2>
          <p className="mt-1 text-sm text-foreground-secondary">
            Your account is not in the campaign yet. You will join automatically as soon
            as the administrator adds your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 rounded-2xl border border-border p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
        <Megaphone className="h-5 w-5 text-success" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-foreground">{status.campaign.name}</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          {`You have been in the campaign since ${formatSaoPaulo(status.added_at)}`}
        </p>
        {status.next_post ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <CalendarClock className="h-4 w-4 shrink-0 text-success" />
            {`Next post: ${MEDIA_TYPE_LABELS[status.next_post.media_type]} on ${formatSaoPaulo(status.next_post.scheduled_at)}`}
          </p>
        ) : (
          <p className="mt-2 text-sm text-foreground-secondary">
            No posts scheduled at the moment.
          </p>
        )}
      </div>
    </div>
  );
}

function InstagramCard({ ig }: { ig: InstagramData }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-3">
        <div className="flex items-center gap-2 text-white/90">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
          </svg>
          <span className="text-sm font-medium">Instagram</span>
          <span className="ml-auto rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium">
            {ig.accountType === "BUSINESS" ? "Business" : "Creator"}
          </span>
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-start gap-4">
          {ig.profilePictureUrl ? (
            <Image
              src={ig.profilePictureUrl}
              alt={ig.username}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full border-2 border-border object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-background-secondary text-xl font-bold text-foreground-secondary">
              {ig.username[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-foreground truncate">
              {ig.name ?? ig.username}
            </h3>
            <p className="text-sm text-foreground-secondary">@{ig.username}</p>
            {ig.biography && (
              <p className="mt-1 text-xs text-foreground-secondary line-clamp-2 whitespace-pre-line">
                {ig.biography}
              </p>
            )}
          </div>
        </div>

        {ig.statsAvailable !== false && (
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">
                {ig.followersCount.toLocaleString("en-GB")}
              </div>
              <div className="text-xs text-foreground-secondary">Followers</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">
                {ig.followsCount.toLocaleString("en-GB")}
              </div>
              <div className="text-xs text-foreground-secondary">Following</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-foreground">
                {ig.mediaCount.toLocaleString("en-GB")}
              </div>
              <div className="text-xs text-foreground-secondary">Posts</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectAccountCard({ connectUrl }: { connectUrl: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border-2 border-dashed border-border p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background-secondary">
        <svg
          className="h-5 w-5 text-foreground-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-foreground">Add more profiles</h3>
        <p className="text-xs text-foreground-secondary">
          The more profiles, the more you earn
        </p>
      </div>
      <a
        href={connectUrl}
        className="shrink-0 rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-4 py-2 text-xs font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25"
      >
        Add
      </a>
    </div>
  );
}

function ConnectFirstCard({ connectUrl }: { connectUrl: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border p-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background-secondary">
        <svg
          className="h-6 w-6 text-foreground-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </div>
      <h3 className="font-medium text-foreground">Connect Instagram</h3>
      <p className="mt-1 text-sm text-foreground-secondary">
        Connect to receive posts from brands
      </p>
      <a
        href={connectUrl}
        className="mt-4 rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-2 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25"
      >
        Connect my Instagram
      </a>
    </div>
  );
}

function LinkStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-foreground">{value}</div>
      <div className="text-xs text-foreground-secondary">{label}</div>
    </div>
  );
}

// Shown while the influencer's referral link is missing from their IG bio.
// The bio can only be edited by the person in the Instagram app, so the best
// we can do is hand them the link ready to paste.
function BioLinkReminderCard({ shareLink }: { shareLink: string | null }) {
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/5 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TriangleAlert size={16} className="shrink-0 text-warning" />
        <span>Your link is missing from your bio!</span>
      </h2>
      <p className="mt-1 text-sm text-foreground-secondary">
        Your sales only count when people click your link. Copy and paste it into the
        &quot;Website&quot; field on your Instagram profile (Edit profile, then Website).
      </p>
      {shareLink && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-white p-2 pl-3">
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {shareLink}
          </span>
          <CopyLinkButton url={shareLink} />
        </div>
      )}
    </div>
  );
}

function TrackingLinkCard({
  shareLink,
  referralTag,
  clicks,
  sales,
  earnings,
}: {
  shareLink: string | null;
  referralTag: string | null;
  clicks: number;
  sales: number;
  earnings: number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-5 py-3">
        <h2 className="text-sm font-semibold text-white">Your share link</h2>
      </div>

      <div className="space-y-4 p-5">
        <p className="text-sm text-foreground-secondary">
          Share this link in your stories and posts. Every sale earns you commission.
          The amount becomes available for withdrawal 21 days after the sale is
          confirmed.
        </p>

        {shareLink ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 p-2 pl-3">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {shareLink}
            </span>
            <CopyLinkButton url={shareLink} />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-foreground-secondary">
            Your link will be ready in a moment.
          </p>
        )}

        {referralTag && (
          <div className="space-y-2">
            <p className="text-sm text-foreground-secondary">
              Or share your code. Anyone who prefers can type it straight into the site
              at checkout:
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary p-2 pl-3">
              <span className="min-w-0 flex-1 truncate text-base font-bold tracking-wide text-foreground">
                {referralTag}
              </span>
              <CopyLinkButton url={referralTag} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 border-t border-border pt-4">
          <LinkStat label="Clicks" value={clicks.toLocaleString("en-GB")} />
          <LinkStat label="Sales" value={sales.toLocaleString("en-GB")} />
          <LinkStat
            label="Earnings"
            value={`R$ ${earnings.toFixed(2).replace(".", ",")}`}
          />
        </div>
      </div>
    </div>
  );
}

function TiersSection({ sales }: { sales: number }) {
  const currentSales = sales;

  const nextLocked = TIERS.find((t) => currentSales < t.threshold);
  const nextThreshold = nextLocked?.threshold ?? 200;
  const remaining = Math.max(nextThreshold - currentSales, 0);
  const progressPercent =
    nextThreshold > 0 ? Math.min((currentSales / nextThreshold) * 100, 100) : 100;

  return (
    <div className="rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-secondary">
          Your products
        </h2>
        <span className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-3 py-1 text-xs font-bold text-white">
          {currentSales} sales
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-foreground-secondary">
          <span>
            {nextLocked ? `Next tier: ${nextLocked.name}` : "All unlocked!"}
          </span>
          <span className="font-medium">
            {currentSales}/{nextThreshold}
          </span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-background-secondary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {remaining > 0 && (
          <p className="mt-2 text-xs text-foreground-secondary">
            Only <span className="font-bold text-accent">{remaining} more sales</span> to
            unlock {nextLocked?.name}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-5">
        {TIERS.map((tier) => {
          const isUnlocked = currentSales >= tier.threshold;

          return (
            <div key={tier.name}>
              <div className="flex items-center gap-2.5">
                {isUnlocked ? (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success">
                    <svg
                      className="h-3.5 w-3.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  </div>
                ) : (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10">
                    <svg
                      className="h-3 w-3 text-accent/40"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                      />
                    </svg>
                  </div>
                )}
                <span
                  className={`text-sm font-semibold ${isUnlocked ? "text-foreground" : "text-foreground-secondary"}`}
                >
                  {tier.name}
                </span>
                {tier.name === "VIP" && (
                  <span className="rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-2 py-0.5 text-[10px] font-bold text-white">
                    EXCLUSIVE
                  </span>
                )}
                <span
                  className={`ml-auto text-xs ${isUnlocked ? "font-semibold text-success" : "text-foreground-secondary"}`}
                >
                  {isUnlocked ? "Unlocked" : `${tier.threshold} sales`}
                </span>
              </div>

              <div className="ml-8 mt-2 flex flex-wrap gap-2">
                {tier.products.map((product) => (
                  <div
                    key={product.alt}
                    className={`overflow-hidden rounded-lg border bg-white px-1.5 py-1 transition-all ${
                      isUnlocked
                        ? "border-border shadow-sm"
                        : "border-border/40 opacity-35 grayscale"
                    }`}
                  >
                    <Image
                      src={product.logo}
                      alt={product.alt}
                      width={140}
                      height={40}
                      className="h-9 w-auto"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardHome({
  profile,
  instagram,
  connectUrl = "/api/instagram/connect",
  shareLink,
  referralTag = null,
  clicks,
  sales,
  earnings,
  campaignStatus,
  bioLinkMissing = false,
  instagramEnabled = true,
}: DashboardHomeProps) {
  return (
    <div className="space-y-5 p-6">
      <h1 className="text-2xl font-bold">
        Hello, {profile.first_name}! Welcome to NextPubli
      </h1>

      {instagramEnabled && bioLinkMissing && (
        <BioLinkReminderCard shareLink={shareLink} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          <CampaignStatusCard status={campaignStatus} />

          {instagramEnabled &&
            (instagram?.isConnected ? (
              <>
                <InstagramCard ig={instagram} />
                <ConnectAccountCard connectUrl={connectUrl} />
              </>
            ) : (
              <ConnectFirstCard connectUrl={connectUrl} />
            ))}

          <TrackingLinkCard
            shareLink={shareLink}
            referralTag={referralTag}
            clicks={clicks}
            sales={sales}
            earnings={earnings}
          />
        </div>

        {/* Right column — Gamification */}
        <div>
          <TiersSection sales={sales} />
        </div>
      </div>
    </div>
  );
}
