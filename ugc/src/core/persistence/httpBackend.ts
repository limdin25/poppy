// The real backend behind the same UgcBackend seam the mock implements.
// Browser -> Supabase directly under RLS for data; SECURITY DEFINER RPCs for
// anything that moves money; serverless /api routes only where a server
// secret is involved (Fish voice takes and clones).

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabaseClient';
import type { AssetRef, GraphDoc, OutputRecord } from '../graph/types';
import type {
  JobInfo,
  ProjectSummary,
  PutGraphResult,
  SubmitJobArgs,
  UgcBackend,
  VoiceInfo,
} from './backend';
import { uploadObjectPath } from '../storagePaths';

interface SubmitContext {
  nodeId: string;
  inputsHash: string;
  estimatedCredits: number;
}

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} is missing`);
  return value;
}

export class HttpBackend implements UgcBackend {
  private sb: SupabaseClient;
  // Inline voice takes settle inside submitJob; getJob answers from here.
  private inlineJobs = new Map<string, JobInfo>();
  // Queue jobs need their submit context back when the poll succeeds.
  private submitted = new Map<string, SubmitContext>();

  constructor() {
    this.sb = need(supabase(), 'Supabase client (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  }

  private async userId(): Promise<string> {
    const { data } = await this.sb.auth.getUser();
    return need(data.user?.id, 'Signed-in user');
  }

  private async token(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    return need(data.session?.access_token, 'Session token');
  }

  private async api(path: string, init: RequestInit): Promise<Response> {
    return fetch(path, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const { data, error } = await this.sb
      .from('ugc_projects')
      .select('id,title,updated_at')
      .eq('status', 'active')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
  }

  async createProject(title: string): Promise<ProjectSummary> {
    const { data, error } = await this.sb
      .from('ugc_projects')
      .insert({ title, user_id: await this.userId() })
      .select('id,title,updated_at')
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id, title: data.title, updatedAt: data.updated_at };
  }

  async getGraph(projectId: string): Promise<GraphDoc | null> {
    const { data, error } = await this.sb
      .from('ugc_projects')
      .select('graph')
      .eq('id', projectId)
      .single();
    if (error) throw new Error(error.message);
    return (data.graph as GraphDoc | null) ?? null;
  }

  async putGraph(doc: GraphDoc, ifUpdatedAt: string): Promise<PutGraphResult> {
    const updatedAt = new Date().toISOString();
    const { data, error } = await this.sb
      .from('ugc_projects')
      .update({ graph: { ...doc, updatedAt }, updated_at: updatedAt })
      .eq('id', doc.projectId)
      .eq('updated_at', ifUpdatedAt)
      .select('updated_at');
    if (error) throw new Error(error.message);
    if (data.length) return { updatedAt };

    // No row matched: either a real conflict, or the very first save (the
    // scaffold's local timestamp never matches the row's). First save wins
    // only while the stored graph is still empty.
    const { data: current, error: readError } = await this.sb
      .from('ugc_projects')
      .select('graph')
      .eq('id', doc.projectId)
      .single();
    if (readError) throw new Error(readError.message);
    if (current.graph) return { conflict: true };
    const { data: forced, error: forceError } = await this.sb
      .from('ugc_projects')
      .update({ graph: { ...doc, updatedAt }, updated_at: updatedAt })
      .eq('id', doc.projectId)
      .is('graph', null)
      .select('updated_at');
    if (forceError) throw new Error(forceError.message);
    return forced.length ? { updatedAt } : { conflict: true };
  }

  async uploadAsset(
    projectId: string,
    file: Blob,
    name: string,
    role: 'influencer' | 'product' = 'influencer',
  ): Promise<AssetRef> {
    const userId = await this.userId();
    const safeName = name.replace(/[^\w.-]/g, '_').slice(-60) || 'photo.png';
    const path = uploadObjectPath(userId, projectId, `${crypto.randomUUID().slice(0, 8)}-${safeName}`);
    const mime = file.type || 'image/png';
    const { error: uploadError } = await this.sb.storage
      .from('ugc-uploads')
      .upload(path, file, { contentType: mime });
    if (uploadError) throw new Error(uploadError.message);

    const { data: asset, error: insertError } = await this.sb
      .from('ugc_assets')
      .insert({
        project_id: projectId,
        user_id: userId,
        kind: role === 'product' ? 'product_photo' : 'influencer_photo',
        storage_path: path,
        mime,
        bytes: file.size,
        source: 'upload',
      })
      .select('id')
      .single();
    if (insertError) throw new Error(insertError.message);

    const { data: signed, error: signError } = await this.sb.storage
      .from('ugc-uploads')
      .createSignedUrl(path, 86400);
    if (signError) throw new Error(signError.message);
    return { assetId: asset.id, mime, url: signed.signedUrl };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const res = await this.api('/api/voice/list', { method: 'GET' });
    if (!res.ok) throw new Error(`Could not load voices (${res.status})`);
    const body = (await res.json()) as { voices: VoiceInfo[] };
    return body.voices;
  }

  async cloneVoice(sample: Blob, name: string, projectId?: string): Promise<VoiceInfo> {
    const bytes = new Uint8Array(await sample.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const res = await this.api('/api/voice/clone', {
      method: 'POST',
      body: JSON.stringify({
        name,
        project_id: need(projectId, 'Project for the voice clone'),
        sample_base64: btoa(binary),
        mime: sample.type || 'audio/wav',
        idempotency_key: `clone:${crypto.randomUUID()}`,
      }),
    });
    const body = (await res.json()) as { voice?: VoiceInfo; error?: string };
    if (!res.ok || !body.voice) throw new Error(body.error ?? `Clone failed (${res.status})`);
    return body.voice;
  }

  async submitJob(args: SubmitJobArgs): Promise<{ jobId: string }> {
    if (args.kind === 'voice') return this.submitVoiceTake(args);

    let stage: string;
    let input: Record<string, unknown>;
    if (args.kind === 'photo') {
      stage = 'composite';
      input = {
        influencer_asset_id: need(args.resolvedInputs.refImage1, 'Influencer photo').assetId,
        product_asset_id: need(args.resolvedInputs.refImage2, 'Product photo').assetId,
        prompt: String(args.config['prompt'] ?? ''),
        aspect: '9:16',
      };
    } else if (args.kind === 'video') {
      stage = 'lipsync';
      input = {
        audio_asset_id: need(args.resolvedInputs.audio, 'Approved voice track').assetId,
        composite_asset_id: need(args.resolvedInputs.startImage, 'Scene photo').assetId,
        direction: String(args.config['direction'] ?? ''),
      };
    } else {
      throw new Error(`Stage ${args.kind} is not enabled yet`);
    }

    const { data, error } = await this.sb.rpc('ugc_enqueue_job', {
      p_stage: stage,
      p_project_id: args.projectId,
      p_input: input,
      p_idempotency_key: `${args.nodeId}:${args.inputsHash}:${crypto.randomUUID().slice(0, 8)}`,
    });
    if (error) throw new Error(error.message);
    const [row] = data as Array<{ job_id: string; credits_debited: number }>;
    const jobId = need(row, 'Enqueue result').job_id;
    this.submitted.set(jobId, {
      nodeId: args.nodeId,
      inputsHash: args.inputsHash,
      estimatedCredits: row!.credits_debited,
    });
    return { jobId };
  }

  private async submitVoiceTake(args: SubmitJobArgs): Promise<{ jobId: string }> {
    const res = await this.api('/api/voice/take', {
      method: 'POST',
      body: JSON.stringify({
        project_id: args.projectId,
        script: String(args.config['script'] ?? ''),
        voice_id: String(args.config['voiceId'] ?? ''),
        idempotency_key: `${args.nodeId}:${args.inputsHash}:${crypto.randomUUID().slice(0, 8)}`,
      }),
    });
    const body = (await res.json()) as {
      asset_id?: string;
      job_id?: string;
      credits_debited?: number;
      duration_seconds?: number;
      url?: string | null;
      error?: string;
    };
    if (!res.ok || !body.job_id || !body.asset_id) {
      throw new Error(body.error ?? `Voice generation failed (${res.status})`);
    }
    const output: OutputRecord = {
      assetRef: {
        assetId: body.asset_id,
        mime: 'audio/wav',
        url: body.url ?? '',
        ...(body.duration_seconds ? { durationSec: body.duration_seconds } : {}),
      },
      category: 'audio',
      producedAt: new Date().toISOString(),
      jobId: body.job_id,
      creditsSpent: body.credits_debited ?? 0,
      inputsHash: args.inputsHash,
    };
    this.inlineJobs.set(body.job_id, {
      jobId: body.job_id,
      nodeId: args.nodeId,
      status: 'succeeded',
      output,
    });
    return { jobId: body.job_id };
  }

  async getJob(jobId: string): Promise<JobInfo> {
    const inline = this.inlineJobs.get(jobId);
    if (inline) return inline;

    const { data, error } = await this.sb
      .from('ugc_jobs')
      .select('id,status,error,credits_debited,output_asset_id')
      .eq('id', jobId)
      .single();
    if (error) throw new Error(error.message);
    const context = this.submitted.get(jobId);
    const base: JobInfo = {
      jobId,
      nodeId: context?.nodeId ?? '',
      status:
        data.status === 'succeeded'
          ? 'succeeded'
          : data.status === 'failed' || data.status === 'canceled'
            ? 'failed'
            : data.status === 'queued'
              ? 'queued'
              : 'running',
    };
    if (base.status === 'failed') {
      return { ...base, error: (data.error as string | null) ?? 'Generation failed (credits refunded)' };
    }
    if (base.status !== 'succeeded' || !data.output_asset_id) return base;

    const { data: asset, error: assetError } = await this.sb
      .from('ugc_assets')
      .select('id,mime,storage_path,duration_seconds')
      .eq('id', data.output_asset_id)
      .single();
    if (assetError) throw new Error(assetError.message);
    const { data: signed, error: signError } = await this.sb.storage
      .from('ugc-renders')
      .createSignedUrl(asset.storage_path, 86400);
    if (signError) throw new Error(signError.message);

    const assetRef: AssetRef = {
      assetId: asset.id,
      mime: asset.mime,
      url: signed.signedUrl,
      ...(asset.duration_seconds ? { durationSec: Number(asset.duration_seconds) } : {}),
    };
    const output: OutputRecord = {
      assetRef,
      category: asset.mime.startsWith('video') ? 'video' : asset.mime.startsWith('audio') ? 'audio' : 'image',
      producedAt: new Date().toISOString(),
      jobId,
      creditsSpent: data.credits_debited ?? context?.estimatedCredits ?? 0,
      inputsHash: context?.inputsHash ?? '',
    };
    return { ...base, output };
  }

  async getCredits(): Promise<{ balance: number }> {
    const { data, error } = await this.sb
      .from('ugc_credit_balances')
      .select('balance')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { balance: data?.balance ?? 0 };
  }

  async approveAsset(assetId: string): Promise<void> {
    const { error } = await this.sb.rpc('ugc_approve_asset', { p_asset_id: assetId });
    if (error) throw new Error(error.message);
  }
}
