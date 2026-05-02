import { cn } from "@/core/lib/cn";

interface AvatarProps {
  src?: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
};

export function Avatar({ src, name = "?", size = "md", className }: AvatarProps) {
  const initials = name
    .split(/\s+|\./)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return (
    <div
      className={cn(
        "rounded-full bg-brand-50 text-brand-700 font-semibold flex items-center justify-center overflow-hidden border border-border shrink-0",
        sizeMap[size],
        className
      )}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{initials || "?"}</span>
      )}
    </div>
  );
}
