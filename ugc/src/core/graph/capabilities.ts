// The stage registry. Everything else reads this: the palette, the connect
// rules, the panel derivation, the credit estimates and the run plans. Adding
// a node type in phase 2 (Video Editor) is one new entry here plus a body
// renderer, nothing else changes.
//
// Deliberately absent, by construction: any model field. The user sees stage
// names ("Photo", "Voice", "Video"), never providers. Stage-to-model mapping
// lives server-side only (single-model directive).

import type { MediaType, SlotId, StageKind } from './types';

export interface SlotSpec {
  id: SlotId;
  label: string;
  accepts: MediaType[];
  // The numbered "reference images" family renders as windowed rows.
  group?: 'refImages';
  // A required slot must be bound (and its upstream fresh) before the node
  // can run.
  required?: boolean;
  // The hard gate: the upstream's current output must be explicitly approved.
  requiresApprovedUpstream?: boolean;
}

export interface FieldSpec {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  placeholder?: string;
  options?: string[];
  required?: boolean;
}

export interface StageCapability {
  kind: StageKind;
  displayName: string;
  outputType: MediaType | null;
  // null = not a generator (assets, text, notes): never in a run plan,
  // never billed.
  creditCategory: MediaType | null;
  approvalRequired: boolean;
  slots: SlotSpec[];
  fields: FieldSpec[];
}

const ASPECTS = ['9:16', '1:1', '16:9'];

export const CAPABILITIES: Record<StageKind, StageCapability> = {
  asset: {
    kind: 'asset',
    displayName: 'Image',
    outputType: 'image',
    creditCategory: null,
    approvalRequired: false,
    slots: [],
    fields: [],
  },
  photo: {
    kind: 'photo',
    displayName: 'Photo',
    outputType: 'image',
    creditCategory: 'image',
    approvalRequired: false,
    slots: [
      { id: 'refImage1', label: 'Reference 1', accepts: ['image'], group: 'refImages' },
      { id: 'refImage2', label: 'Reference 2', accepts: ['image'], group: 'refImages' },
    ],
    fields: [
      {
        id: 'prompt',
        label: 'Prompt',
        type: 'textarea',
        placeholder: 'A casual phone photo of the person holding the product, natural light',
        required: true,
      },
      { id: 'aspect', label: 'Aspect ratio', type: 'select', options: ASPECTS },
    ],
  },
  voice: {
    kind: 'voice',
    displayName: 'Voice',
    outputType: 'audio',
    creditCategory: 'audio',
    approvalRequired: true,
    slots: [],
    fields: [
      {
        id: 'script',
        label: 'Script',
        type: 'textarea',
        placeholder: 'What should they say?',
        required: true,
      },
      { id: 'voiceId', label: 'Voice', type: 'text', required: true },
    ],
  },
  video: {
    kind: 'video',
    displayName: 'Video',
    outputType: 'video',
    creditCategory: 'video',
    approvalRequired: false,
    slots: [
      { id: 'startImage', label: 'Start image', accepts: ['image'], required: true },
      { id: 'endImage', label: 'End image', accepts: ['image'] },
      { id: 'refImage1', label: 'Image 1', accepts: ['image'], group: 'refImages' },
      { id: 'refImage2', label: 'Image 2', accepts: ['image'], group: 'refImages' },
      { id: 'refImage3', label: 'Image 3', accepts: ['image'], group: 'refImages' },
      { id: 'refImage4', label: 'Image 4', accepts: ['image'], group: 'refImages' },
      {
        id: 'audio',
        label: 'Voice track',
        accepts: ['audio'],
        required: true,
        requiresApprovedUpstream: true,
      },
    ],
    fields: [
      {
        id: 'direction',
        label: 'Direction',
        type: 'textarea',
        placeholder: 'Hold the product at chest height, point at the label, smile on the last line',
      },
      { id: 'aspect', label: 'Aspect ratio', type: 'select', options: ASPECTS },
    ],
  },
  text: {
    kind: 'text',
    displayName: 'Text',
    outputType: 'text',
    creditCategory: null,
    approvalRequired: false,
    slots: [],
    fields: [{ id: 'content', label: 'Text', type: 'textarea' }],
  },
  note: {
    kind: 'note',
    displayName: 'Note',
    outputType: null,
    creditCategory: null,
    approvalRequired: false,
    slots: [],
    fields: [{ id: 'content', label: 'Note', type: 'textarea' }],
  },
};

export function capability(kind: StageKind): StageCapability {
  const cap = CAPABILITIES[kind];
  if (!cap) throw new Error(`Unknown stage kind: ${kind}`);
  return cap;
}

export function isGenerator(kind: StageKind): boolean {
  return capability(kind).creditCategory !== null;
}
