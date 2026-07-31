"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { Profile } from "@/types/database";

interface AdminImpersonateProps {
  adminName: string;
  impersonatedProfile: Profile;
  children: React.ReactNode;
}

export function AdminImpersonate({
  adminName,
  impersonatedProfile,
  children,
}: AdminImpersonateProps) {
  return (
    <div>
      <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-warning bg-warning/10 px-6 py-3">
        <Link
          href="/admin/influenciadores"
          className="flex items-center gap-2 rounded-lg border border-warning px-3 py-1.5 text-sm font-medium text-warning hover:bg-warning/20"
        >
          <ArrowLeft size={14} />
          Voltar ao Admin
        </Link>
        <span className="text-sm">
          <span className="font-medium">{adminName}</span> está logado como{" "}
          <span className="font-semibold">
            {impersonatedProfile.first_name} {impersonatedProfile.last_name}
          </span>
        </span>
      </div>
      {children}
    </div>
  );
}
