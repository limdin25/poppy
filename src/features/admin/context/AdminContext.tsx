import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'

interface AdminContextValue {
  isAdmin: boolean
  impersonating: { businessId: string; businessName: string } | null
  startImpersonation: (businessId: string, businessName: string) => void
  stopImpersonation: () => void
}

const AdminContext = createContext<AdminContextValue>({
  isAdmin: true,
  impersonating: null,
  startImpersonation: () => {},
  stopImpersonation: () => {},
})

export function AdminProvider({ children }: { children: ReactNode }) {
  const { impersonating, startImpersonation, stopImpersonation } = useAuth()

  return (
    <AdminContext.Provider value={{ isAdmin: true, impersonating, startImpersonation, stopImpersonation }}>
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  return useContext(AdminContext)
}
