import type { Campaign, SmsTemplate, NumberRecord } from '../types';

export const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp-april-landlord',
    name: 'April landlord outreach',
    pipelineId: 'pl-landlord',
    ownerAgentId: 'a-tom',
    totalLeads: 160,
    doneLeads: 18,
    connectedLeads: 4,
    voicemailLeads: 11,
    pendingLeads: 127,
    dialingLeads: 0,
    missedLeads: 0,
    skippedLeads: 0,
    mode: 'parallel',
    parallelLines: 3,
    aiCoachEnabled: true,
    aiCoachPromptId: 'prompt-landlord',
    scriptMd:
      '# Landlord intro\n\nHi **{name}**, this is {agent} from Acme Sales. I noticed you signed up for our landlord guide last week.\n\n- Acknowledge their property\n- Ask about timeline\n- Avoid leading with price',
    autoAdvanceSeconds: 10,
    isActive: true,
  },
  {
    id: 'cmp-may-tenants',
    name: 'May tenants',
    pipelineId: 'pl-landlord',
    ownerAgentId: 'a-tom',
    totalLeads: 80,
    doneLeads: 0,
    connectedLeads: 0,
    voicemailLeads: 0,
    pendingLeads: 80,
    dialingLeads: 0,
    missedLeads: 0,
    skippedLeads: 0,
    mode: 'power',
    parallelLines: 1,
    aiCoachEnabled: false,
    autoAdvanceSeconds: 15,
    isActive: true,
  },
  {
    id: 'cmp-reengage',
    name: 'Re-engage paid',
    pipelineId: 'pl-landlord',
    ownerAgentId: 'a-tom',
    totalLeads: 42,
    doneLeads: 12,
    connectedLeads: 5,
    voicemailLeads: 3,
    pendingLeads: 22,
    dialingLeads: 0,
    missedLeads: 0,
    skippedLeads: 0,
    mode: 'parallel',
    parallelLines: 2,
    aiCoachEnabled: true,
    autoAdvanceSeconds: 8,
    isActive: true,
  },
];

export const MOCK_TEMPLATES: SmsTemplate[] = [
  {
    id: 'tpl-thanks',
    name: 'Thanks — Interested',
    bodyMd: 'Hi {name}, great chatting just now. Sending the rent guide PDF over now. — {agent}',
    mergeFields: ['name', 'agent'],
  },
  {
    id: 'tpl-callback',
    name: 'Callback later',
    bodyMd: 'Hi {name}, no worries — I\'ll call you back in 2 hours. — {agent}',
    mergeFields: ['name', 'agent'],
  },
  {
    id: 'tpl-missed',
    name: 'Missed call',
    bodyMd: 'Hi {name}, tried calling — when\'s a good time today? — {agent}',
    mergeFields: ['name', 'agent'],
  },
  {
    id: 'tpl-voicemail',
    name: 'Voicemail follow-up',
    bodyMd: 'Hi {name}, left you a voicemail. Quick question about your {property}. — {agent}',
    mergeFields: ['name', 'agent', 'property'],
  },
  {
    id: 'tpl-intro',
    name: 'Cold intro',
    bodyMd: 'Hi {name}, this is {agent} from Acme Sales — got a sec to chat about your property?',
    mergeFields: ['name', 'agent'],
  },
];

export const MOCK_NUMBERS: NumberRecord[] = [
  {
    id: 'num-1',
    e164: '+44 7380 308316',
    label: 'Main outbound',
    capabilities: ['voice', 'sms'],
    rotationPoolId: 'pool-uk',
    maxCallsPerMinute: 30,
    cooldownSecondsAfterCall: 5,
    recordingEnabled: true,
  },
  {
    id: 'num-2',
    e164: '+44 7380 308317',
    label: 'Tom direct',
    capabilities: ['voice', 'sms'],
    assignedAgentId: 'a-tom',
    maxCallsPerMinute: 20,
    cooldownSecondsAfterCall: 3,
    recordingEnabled: true,
  },
  {
    id: 'num-3',
    e164: '+44 7380 308318',
    label: 'Aisha direct',
    capabilities: ['voice', 'sms'],
    assignedAgentId: 'a-aisha',
    maxCallsPerMinute: 20,
    cooldownSecondsAfterCall: 3,
    recordingEnabled: true,
  },
];

export const COACH_PROMPTS = [
  {
    id: 'prompt-landlord',
    name: 'Landlord acquisition',
    body:
      '# Role\nYou are coaching a sales agent calling a UK property landlord.\n\n# Goal\nGet a meeting booked. Address objections about price, deposits, and timing.\n\n# Style\n- Concise, max 2 lines per suggestion\n- Always reframe price objections as "net vs gross"',
  },
  {
    id: 'prompt-tenant',
    name: 'Tenant onboarding',
    body: '# Role\nYou coach an agent onboarding a tenant…',
  },
  {
    id: 'prompt-payment',
    name: 'Payment chase',
    body: '# Role\nYou coach an agent chasing late payment respectfully…',
  },
];
