"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, ExternalLink, GraduationCap } from "lucide-react";
import { TUTORIALS } from "./data";

/**
 * The admin shortcut list. Its job is not to teach, it is to get Hugo to any
 * class in one click and to hand him the Skool post copy without opening the
 * class itself, because the Skool blurb is marketing for people who have not
 * taken the class and does not belong on the student page.
 */
export function TutorialIndex({ baseUrl }: { baseUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (slug: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(slug);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  return (
    <div className="flex flex-col gap-8 p-6 lg:p-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-accent">
          <GraduationCap size={20} />
          <span className="text-xs font-semibold uppercase tracking-widest">Skool course</span>
        </div>
        <h1 className="text-3xl font-bold text-foreground">Tutorials</h1>
        <p className="max-w-2xl text-foreground-secondary">
          Five classes teaching Seedance 2.5, one per demo video, ordered by difficulty. Each page is
          public, so the link can go straight into a Skool class. Copy the description here and paste
          it under the uploaded video.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="pb-3 pr-4 text-[10px] font-semibold uppercase tracking-widest text-foreground-secondary">
                Class
              </th>
              <th className="pb-3 pr-4 text-[10px] font-semibold uppercase tracking-widest text-foreground-secondary">
                Upload this file
              </th>
              <th className="pb-3 pr-4 text-[10px] font-semibold uppercase tracking-widest text-foreground-secondary">
                Teaches
              </th>
              <th className="pb-3 pr-4 text-[10px] font-semibold uppercase tracking-widest text-foreground-secondary">
                Link
              </th>
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-foreground-secondary">
                Skool post
              </th>
            </tr>
          </thead>
          <tbody>
            {TUTORIALS.map((t) => (
              <tr key={t.slug} className="border-b border-border align-top">
                <td className="py-4 pr-4">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs text-accent">{t.classNumber}</span>
                    <Link href={`/${t.slug}`} className="font-semibold text-foreground hover:text-accent">
                      {t.title}
                    </Link>
                    <span className="text-xs text-foreground-secondary">
                      {t.seconds}s, {t.generations} generation{t.generations > 1 ? "s" : ""}
                    </span>
                  </div>
                </td>
                <td className="py-4 pr-4">
                  <code className="rounded bg-background-secondary px-2 py-1 font-mono text-xs text-foreground">
                    {t.sourceFile}
                  </code>
                </td>
                <td className="py-4 pr-4 text-foreground-secondary">{t.newSkill}</td>
                <td className="py-4 pr-4">
                  <Link
                    href={`/${t.slug}`}
                    className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
                  >
                    /{t.slug}
                    <ExternalLink size={13} />
                  </Link>
                  <div className="mt-1 font-mono text-[11px] text-foreground-secondary">
                    {baseUrl}/{t.slug}
                  </div>
                </td>
                <td className="py-4">
                  <button
                    type="button"
                    onClick={() => copy(t.slug, t.skoolDescription)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                      copied === t.slug
                        ? "border-success text-success"
                        : "border-border text-foreground-secondary hover:border-accent hover:text-accent"
                    }`}
                  >
                    {copied === t.slug ? <Check size={13} /> : <Copy size={13} />}
                    {copied === t.slug ? "Copied" : "Copy"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-2xl text-sm text-foreground-secondary">
        <strong className="text-foreground">Watch the file column.</strong> The classes are ordered
        by difficulty, not by filename, so class 1 is v5.mp4 and class 5 is v4.mp4. Each class is the
        one before it plus a single new skill, so nobody meets the whip pans before they have made a
        locked off shot work.
      </p>
    </div>
  );
}
