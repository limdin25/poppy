import type { ReactNode } from 'react'

export default function AdminGuard({ children }: { children: ReactNode }) {
  // TODO: Wire to real admin check via Supabase
  // For now, always allow access during development
  return <>{children}</>
}
