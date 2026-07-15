import type { DialerLeg } from '../types';

export const MOCK_DIALER_LEGS: DialerLeg[] = [
  {
    id: 'leg-1',
    line: 1,
    contactId: 'c-tom-r',
    contactName: 'Tom Richards',
    phone: '+44 7700 900222',
    status: 'ringing',
    startedAt: Date.now() - 8000,
  },
  {
    id: 'leg-2',
    line: 2,
    contactId: 'c-aisha-c',
    contactName: 'Aisha Chowdhury',
    phone: '+44 7700 900333',
    status: 'ringing',
    startedAt: Date.now() - 8000,
  },
  {
    id: 'leg-3',
    line: 3,
    contactId: 'c-david-p',
    contactName: 'David Parker',
    phone: '+44 7700 900444',
    status: 'connecting',
    startedAt: Date.now() - 6000,
  },
];
