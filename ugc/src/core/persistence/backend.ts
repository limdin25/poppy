// The seam between the canvas and the systems layer. The canvas only ever
// talks to this interface; VITE_UGC_API_MODE picks the implementation:
// 'mock' (deterministic in-memory, drives all e2e with zero spend) or 'http'
// (the real Supabase + serverless backend, step 12).
//
// The server re-enforces the approval gate and the balance on submitJob; the
// client-side checks are UX only.

import type { AssetRef, GraphDoc, OutputRecord, SlotId, StageKind, JsonValue } from '../graph/types';

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  kind: 'curated' | 'cloned';
  vibe?: string;
  previewUrl?: string;
}

export type BackendJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobInfo {
  jobId: string;
  nodeId: string;
  status: BackendJobStatus;
  error?: string;
  output?: OutputRecord;
}

export interface SubmitJobArgs {
  projectId: string;
  nodeId: string;
  kind: StageKind;
  config: Record<string, JsonValue>;
  resolvedInputs: Partial<Record<SlotId, AssetRef>>;
  estimatedCredits: number;
  inputsHash: string;
}

export type PutGraphResult = { updatedAt: string } | { conflict: true };

export interface UgcBackend {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(title: string): Promise<ProjectSummary>;
  getGraph(projectId: string): Promise<GraphDoc | null>;
  putGraph(doc: GraphDoc, ifUpdatedAt: string): Promise<PutGraphResult>;
  uploadAsset(projectId: string, file: Blob, name: string): Promise<AssetRef>;
  listVoices(): Promise<VoiceInfo[]>;
  cloneVoice(sample: Blob, name: string): Promise<VoiceInfo>;
  submitJob(args: SubmitJobArgs): Promise<{ jobId: string }>;
  getJob(jobId: string): Promise<JobInfo>;
  getCredits(): Promise<{ balance: number }>;
  // Server-side approval (ugc_approve_asset). The doc's ApprovalRecord is the
  // instant UI mirror; this is the billing-safety truth.
  approveAsset(assetId: string): Promise<void>;
}
