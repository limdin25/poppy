type CallerContext = {
  signedInName: string;
  isAdmin: boolean;
  loading: boolean;
  viewAsId: string | null;
  viewAsName: string | null;
  assignedAgentId?: string;
  agents: ReadonlyMap<string, { name: string }>;
};

function firstName(name?: string | null) {
  const first = name?.trim().split(/\s+/)[0];
  return first && first !== 'Agent' && !first.includes('@') ? first : null;
}

// Hostunico only. The signed-in admin is viewing the seller's script.
export function hostunicoCallerName(context: CallerContext): string {
  if (context.loading) return 'Pedro';
  if (!context.isAdmin) return firstName(context.signedInName) || 'Pedro';
  if (context.viewAsId) {
    return firstName(context.agents.get(context.viewAsId)?.name)
      || firstName(context.viewAsName)
      || 'Pedro';
  }
  return firstName(context.agents.get(context.assignedAgentId || '')?.name) || 'Pedro';
}
