import type { Pipeline, PipelineColumn } from '../types';

const cols: PipelineColumn[] = [
  {
    id: 'col-interested',
    pipelineId: 'pl-landlord',
    name: 'Interested',
    colour: '#1E9A80',
    icon: 'Sparkles',
    position: 1,
    automation: {
      sendSms: true,
      smsTemplateId: 'tpl-thanks',
      createTask: true,
      taskTitle: 'Send rent guide PDF',
      taskDueInHours: 24,
      retryDial: false,
      addTag: true,
      tag: 'warm',
    },
  },
  {
    id: 'col-callback',
    pipelineId: 'pl-landlord',
    name: 'Callback',
    colour: '#F59E0B',
    icon: 'Clock',
    position: 2,
    automation: {
      sendSms: true,
      smsTemplateId: 'tpl-callback',
      createTask: false,
      retryDial: true,
      retryInHours: 2,
      addTag: false,
    },
  },
  {
    id: 'col-no-pickup',
    pipelineId: 'pl-landlord',
    name: 'No pickup',
    colour: '#3B82F6',
    icon: 'PhoneMissed',
    position: 3,
    isDefaultOnTimeout: true,
    automation: {
      sendSms: true,
      smsTemplateId: 'tpl-missed',
      createTask: false,
      retryDial: true,
      retryInHours: 2,
      addTag: false,
    },
  },
  {
    id: 'col-not-interested',
    pipelineId: 'pl-landlord',
    name: 'Not interested',
    colour: '#EF4444',
    icon: 'X',
    position: 4,
    automation: {
      sendSms: false,
      createTask: false,
      retryDial: false,
      addTag: true,
      tag: 'cold',
    },
  },
  {
    id: 'col-voicemail',
    pipelineId: 'pl-landlord',
    name: 'Voicemail',
    colour: '#9CA3AF',
    icon: 'Voicemail',
    position: 5,
    automation: {
      sendSms: true,
      smsTemplateId: 'tpl-voicemail',
      createTask: false,
      retryDial: true,
      retryInHours: 24,
      addTag: false,
    },
  },
  {
    id: 'col-wrong-number',
    pipelineId: 'pl-landlord',
    name: 'Wrong number',
    colour: '#525252',
    icon: 'Ban',
    position: 6,
    automation: {
      sendSms: false,
      createTask: false,
      retryDial: false,
      addTag: true,
      tag: 'wrong-number',
    },
  },
];

export const MOCK_PIPELINES: Pipeline[] = [
  {
    id: 'pl-landlord',
    name: 'Landlord acquisition',
    scope: 'workspace',
    columns: cols,
  },
];

export const ACTIVE_PIPELINE = MOCK_PIPELINES[0];
