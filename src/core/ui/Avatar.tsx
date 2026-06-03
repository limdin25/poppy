import { cn } from "@/core/lib/cn";

interface AvatarProps {
  src?: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg";
  channel?: "whatsapp" | "email" | "sms" | "voice" | "instagram";
  className?: string;
}

const sizeMap = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
};

const badgeMap = { xs: "h-3 w-3", sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" };
const badgeIcon = { xs: 7, sm: 9, md: 10, lg: 13 };

function WhatsAppIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="#25D366">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function MailIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

export function Avatar({ src, name = "?", size = "md", channel, className }: AvatarProps) {
  const initials = name
    .split(/\s+|\./)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  // Channel badge overlays the bottom-right of the photo/initials (waslo motif).
  const badge =
    channel === "whatsapp" ? (
      <span className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-white ring-2 ring-white", badgeMap[size])}>
        <WhatsAppIcon size={badgeIcon[size]} />
      </span>
    ) : channel === "email" ? (
      <span className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-white ring-2 ring-white", badgeMap[size])}>
        <MailIcon size={badgeIcon[size]} />
      </span>
    ) : null;

  return (
    <div className={cn("relative shrink-0", sizeMap[size], className)}>
      <div
        className={cn(
          "h-full w-full rounded-full font-semibold flex items-center justify-center overflow-hidden",
          channel === "whatsapp"
            ? "bg-[#e7fce6] text-[#0f5132] border border-[#25D366]/30"
            : channel === "email"
              ? "bg-indigo-50 text-indigo-700 border border-indigo-200/50"
              : "bg-brand-50 text-brand-700 border border-border",
        )}
      >
        {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : <span>{initials || "?"}</span>}
      </div>
      {badge}
    </div>
  );
}
