import { createContext, useContext, useState, type ReactNode } from 'react'

interface Impersonation {
  businessId: string
  businessName: string
}

interface AdminContextValue {
  isAdmin: boolean
  impersonating: Impersonation | null
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
  const [impersonating, setImpersonating] = useState<Impersonation | null>(null)

  function startImpersonation(businessId: string, businessName: string) {
    setImpersonating({ businessId, businessName })
  }

  function stopImpersonation() {
    setImpersonating(null)
  }

  return (
    <AdminContext.Provider value={{ isAdmin: true, impersonating, startImpersonation, stopImpersonation }}>
      {children}
    </AdminContext.Provider>
  )
}

export function useAdmin() {
  return useContext(AdminContext)
}
