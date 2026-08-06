"use client";

import { useEffect, useRef } from "react";

/**
 * The fireworks Hugo asked for when the last step goes green. Hand-rolled on a
 * canvas, about sixty lines, because a one-off celebration is not worth a
 * dependency.
 *
 * Fires ONCE per browser: the localStorage flag means finishing the funnel
 * celebrates, and every later visit to the completed page stays calm. Skipped
 * entirely under prefers-reduced-motion, where the finish heading has to carry
 * the moment on its own.
 */
const COLORS = ["#F56040", "#E1306C", "#C13584", "#10B981", "#F59E0B"];

export function Confetti({ celebrationKey }: { celebrationKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const key = `hp_onb_celebrated:${celebrationKey}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, new Date().toISOString());
    } catch {
      // Storage blocked (private mode): celebrate anyway, worst case twice.
    }
    // matchMedia is missing in jsdom and some old WebViews: no signal means
    // no reduced-motion preference, so celebrate.
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const W = window.innerWidth;
    const H = window.innerHeight;
    const particles = Array.from({ length: 140 }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 11,
      vy: -(4 + Math.random() * 9),
      size: 5 + Math.random() * 6,
      color: COLORS[i % COLORS.length],
      spin: Math.random() * Math.PI,
      spinV: (Math.random() - 0.5) * 0.3,
    }));

    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - started) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.spin += p.spinV;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.globalAlpha = Math.max(0, 1 - t / 2.8);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (t < 2.8) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [celebrationKey]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="funnel-confetti"
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
    />
  );
}
