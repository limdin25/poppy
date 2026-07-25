// ErrorBoundary — stops one broken component from white-screening the whole
// app. Before this, the CRM had ZERO error boundaries, so any render-time
// throw (e.g. a null-deref at call-end) unmounted the entire React tree and
// left a blank page with the sidebar gone (Hugo 2026-07-22).
//
// It also CAPTURES the exact error + component stack to the console and to
// localStorage ('elsie_last_crash'), so the precise root cause can be read
// back after a reproduction instead of guessed at.

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Short context label (e.g. "page", "softphone") — shown in the fallback
   *  and stored with the crash so we know WHERE it blew up. */
  label?: string;
  /** Silent boundaries (e.g. the floating softphone) render a tiny corner
   *  pill instead of a full-width card, so a widget crash doesn't take over
   *  the screen — it just isolates the widget. */
  silent?: boolean;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const label = this.props.label ?? 'app';
    // Full detail to the console for live debugging.
    console.error(`[ErrorBoundary:${label}] caught`, error, info.componentStack);
    // Persist the last crash so it can be read back after a reproduction
    // (via Kimi/DevTools: localStorage.getItem('elsie_last_crash')).
    try {
      localStorage.setItem(
        'elsie_last_crash',
        JSON.stringify({
          label,
          message: error?.message ?? String(error),
          stack: error?.stack ?? null,
          componentStack: info?.componentStack ?? null,
          url: typeof window !== 'undefined' ? window.location.href : null,
          at: new Date().toISOString(),
        }),
      );
    } catch {
      /* localStorage full / unavailable — the console log still has it */
    }
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Silent widgets (softphone): a tiny recoverable pill, not a takeover.
    if (this.props.silent) {
      return (
        <button
          onClick={this.reset}
          title={error.message}
          className="fixed bottom-5 right-5 z-[120] bg-white border border-[#FCA5A5] text-[#B91C1C] rounded-full shadow px-3 py-2 text-[11px] font-medium hover:bg-[#FEF2F2]"
        >
          Softphone hiccuped — tap to reload it
        </button>
      );
    }

    return (
      <div className="h-full w-full flex items-center justify-center p-6 bg-[#F3F3EE]">
        <div className="max-w-md w-full bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] p-6 text-center">
          <div className="text-[15px] font-bold text-[#1A1A1A] mb-1.5">
            This panel hit a snag
          </div>
          <p className="text-[13px] text-[#6B7280] leading-relaxed mb-4">
            Something on this screen stopped responding, but your call and the
            rest of the app are still running. Try again, or reload the page.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={this.reset}
              className="text-[13px] font-semibold text-white bg-[#3C5A87] hover:bg-[#33507a] rounded-lg px-4 py-2 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="text-[13px] font-semibold text-[#3C5A87] border border-[#3C5A87] bg-white hover:bg-[#EEF2F8] rounded-lg px-4 py-2 transition-colors"
            >
              Reload page
            </button>
          </div>
          <p className="mt-4 text-[10px] text-[#9CA3AF] break-words">
            {error.message}
          </p>
        </div>
      </div>
    );
  }
}
