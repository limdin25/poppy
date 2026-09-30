import { sequencePosition, type FollowupConfig, type SequenceLead } from '@/core/hostunicoFollowup';
export function hostunicoFlowGraph(config: FollowupConfig, leads: SequenceLead[], now = Date.now()) {
  const entries = [{ id: 'sent', label: 'Report sent' }, ...config.steps.flatMap((s) => [
    { id: `wait_${s.id}`, label: `Wait ${s.waitHours} hours` },
    { id: s.id, label: `${s.label} due${s.approved ? '' : ' (copy draft)'}` },
  ]), { id: 'cold', label: 'Cold. Stop following up' }];
  const nodes = [...entries, { id: 'replied', label: 'Replied. Pedro takes over' }].map((entry, i) => ({
    id: entry.id, position: entry.id === 'replied' ? { x: 340, y: 160 } : { x: 20, y: i * 115 },
    data: { label: entry.label, leads: leads.filter((l) => sequencePosition(l, config, now).node === entry.id) }, type: 'hostunicoStage',
  }));
  const edges = entries.slice(1).map((entry, i) => ({ id: `${entries[i].id}-${entry.id}`, source: entries[i].id, target: entry.id }));
  for (const entry of entries.filter((e) => e.id !== 'cold')) for (const branch of config.branches) {
    edges.push({ id: `${entry.id}-${branch.intent}`, source: entry.id, target: branch.target, ...{ label: branch.label, style: { strokeDasharray: '4 4' } } });
  }
  return { nodes, edges };
}
