import { Eye, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'

export function ImpersonationBanner() {
  const { impersonating, stopImpersonation } = useAuth()
  const navigate = useNavigate()
  if (!impersonating) return null

  return (
    <div className="flex items-center justify-between bg-amber-500 px-4 py-2 text-[13px] font-medium text-black">
      <div className="flex items-center gap-2">
        <Eye size={14} />
        <span>Viewing as: {impersonating.businessName}</span>
      </div>
      <button
        onClick={() => {
          stopImpersonation()
          navigate('/admin')
        }}
        className="flex items-center gap-1 rounded-md bg-black/10 px-2 py-0.5 text-[12px] hover:bg-black/20"
      >
        <X size={12} />
        Exit
      </button>
    </div>
  )
}
