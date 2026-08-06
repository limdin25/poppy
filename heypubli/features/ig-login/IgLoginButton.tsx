import { Camera } from "lucide-react";
import { igLoginCopy } from "./copy";

interface IgLoginButtonProps {
  label?: string;
}

// Single entry point for "Sign in / Sign up with Instagram". It's a plain link to
// the public start route, which kicks off the Outstand-managed Instagram OAuth.
export function IgLoginButton({ label = igLoginCopy.defaultLabel }: IgLoginButtonProps) {
  return (
    <a
      href="/api/auth/instagram/start"
      className="flex w-full items-center justify-center gap-3 rounded-lg px-6 py-3 text-base font-semibold text-white transition hover:opacity-90"
      style={{ background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)" }}
    >
      <Camera size={20} />
      {label}
    </a>
  );
}
