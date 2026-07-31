// Deterministic in-memory backend. Every Playwright spec runs against this
// (VITE_UGC_API_MODE=mock): jobs complete on a short timer with fake assets,
// credits debit for real against an in-memory balance, and nothing costs a
// penny. Determinism matters more than realism: same actions, same ids, same
// results, every run.

import { PACK_CREDITS } from '../pricing';
import type { AssetRef, GraphDoc, OutputRecord } from '../graph/types';
import type {
  JobInfo,
  ProjectSummary,
  PutGraphResult,
  SubmitJobArgs,
  UgcBackend,
  VoiceInfo,
} from './backend';

const JOB_COMPLETE_AFTER_MS = 600;

function svgDataUrl(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="480"><rect width="100%" height="100%" fill="hsl(${hue},40%,92%)"/><text x="50%" y="50%" font-family="sans-serif" font-size="20" text-anchor="middle" fill="hsl(${hue},50%,30%)">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// One second of silence, wav, base64 (validly playable in every browser).
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

const CURATED_VOICES: VoiceInfo[] = [
  { id: 'v-amelia', name: 'Amelia', kind: 'curated', vibe: 'Warm', previewUrl: SILENT_WAV },
  { id: 'v-jack', name: 'Jack', kind: 'curated', vibe: 'Upbeat', previewUrl: SILENT_WAV },
  { id: 'v-sofia', name: 'Sofia', kind: 'curated', vibe: 'Calm', previewUrl: SILENT_WAV },
  { id: 'v-marcus', name: 'Marcus', kind: 'curated', vibe: 'Deep', previewUrl: SILENT_WAV },
];

interface MockJob {
  info: JobInfo;
  settlesAtMs: number;
  args: SubmitJobArgs;
}

export class MockBackend implements UgcBackend {
  private projects = new Map<string, ProjectSummary>();
  private graphs = new Map<string, GraphDoc>();
  private jobs = new Map<string, MockJob>();
  private voices: VoiceInfo[] = [...CURATED_VOICES];
  private balance = PACK_CREDITS;
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.projects.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async createProject(title: string): Promise<ProjectSummary> {
    const project: ProjectSummary = {
      id: this.nextId('p'),
      title,
      updatedAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getGraph(projectId: string): Promise<GraphDoc | null> {
    return this.graphs.get(projectId) ?? null;
  }

  async putGraph(doc: GraphDoc, ifUpdatedAt: string): Promise<PutGraphResult> {
    const existing = this.graphs.get(doc.projectId);
    if (existing && existing.updatedAt !== ifUpdatedAt) return { conflict: true };
    const updatedAt = new Date().toISOString();
    this.graphs.set(doc.projectId, { ...doc, updatedAt });
    return { updatedAt };
  }

  async uploadAsset(_projectId: string, file: Blob, name: string): Promise<AssetRef> {
    const assetId = this.nextId('upload');
    return {
      assetId,
      mime: file.type || 'image/png',
      url: svgDataUrl(name || assetId, 210),
    };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    // Clones first, newest first, then curated (the "Yours" pill sits on top).
    return [...this.voices].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'cloned' ? -1 : 1));
  }

  async cloneVoice(_sample: Blob, name: string): Promise<VoiceInfo> {
    const voice: VoiceInfo = {
      id: this.nextId('v-clone'),
      name,
      kind: 'cloned',
      vibe: 'Yours',
      previewUrl: SILENT_WAV,
    };
    this.voices.push(voice);
    return voice;
  }

  async submitJob(args: SubmitJobArgs): Promise<{ jobId: string }> {
    if (args.estimatedCredits > this.balance) {
      throw new Error(`Not enough credits: need ${args.estimatedCredits}, have ${this.balance}`);
    }
    this.balance -= args.estimatedCredits;
    const jobId = this.nextId('job');
    this.jobs.set(jobId, {
      info: { jobId, nodeId: args.nodeId, status: 'queued' },
      settlesAtMs: Date.now() + JOB_COMPLETE_AFTER_MS,
      args,
    });
    return { jobId };
  }

  async getJob(jobId: string): Promise<JobInfo> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    if (job.info.status === 'succeeded' || job.info.status === 'failed') return job.info;

    if (Date.now() < job.settlesAtMs) {
      job.info = { ...job.info, status: 'running' };
      return job.info;
    }

    const output = this.buildOutput(job);
    job.info = { ...job.info, status: 'succeeded', output };
    return job.info;
  }

  private buildOutput(job: MockJob): OutputRecord {
    const { args } = job;
    const assetId = this.nextId('asset');
    let assetRef: AssetRef;
    let category: OutputRecord['category'];

    if (args.kind === 'voice') {
      const script = String(args.config['script'] ?? '');
      // Deterministic duration: ~15 chars a second, floor 4s.
      const durationSec = Math.max(4, Math.round(script.length / 15));
      assetRef = { assetId, mime: 'audio/wav', url: SILENT_WAV, durationSec };
      category = 'audio';
    } else if (args.kind === 'video') {
      const audio = args.resolvedInputs.audio;
      assetRef = {
        assetId,
        mime: 'video/mp4',
        url: svgDataUrl('Video ready', 140),
        durationSec: audio?.durationSec ?? 30,
      };
      category = 'video';
    } else {
      assetRef = { assetId, mime: 'image/png', url: svgDataUrl('Scene', 30) };
      category = 'image';
    }

    return {
      assetRef,
      category,
      producedAt: new Date().toISOString(),
      jobId: job.info.jobId,
      creditsSpent: args.estimatedCredits,
      inputsHash: args.inputsHash,
    };
  }

  async getCredits(): Promise<{ balance: number }> {
    return { balance: this.balance };
  }

  async approveAsset(_assetId: string): Promise<void> {
    // Mock approval is doc-only; the http backend calls ugc_approve_asset.
  }
}
