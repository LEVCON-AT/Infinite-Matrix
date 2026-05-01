// Webhooks (Welle C.2). CRUD ueber SECURITY DEFINER-RPCs.
//
// Direkter INSERT/UPDATE/DELETE auf workspace_webhooks ist policy-
// blockiert — alles laeuft ueber create/update/delete_workspace_
// webhook-RPCs. signing_secret ist nicht in der Safe-View; es wird
// einmalig beim Anlegen als hex zurueckgegeben (User-Display zum
// Copy/Paste in das externe System), danach NIE mehr ausgegeben.

import { isNetworkError } from './mutation-queue';
import { markCacheFallback } from './offline-state';
import { supabase } from './supabase';

export type WorkspaceEventKind =
  | 'member.invited'
  | 'member.joined'
  | 'member.left'
  | 'member.role_changed'
  | 'workspace.created'
  | 'workspace.renamed'
  | 'workspace.deleted'
  | 'workspace.transferred'
  | 'task.created'
  | 'task.completed'
  | 'task.deleted'
  | 'cell.created'
  | 'cell.deleted';

export type Webhook = {
  id: string;
  workspace_id: string;
  name: string;
  target_url: string;
  event_types: WorkspaceEventKind[];
  enabled: boolean;
  last_status_code: number | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  fail_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function listWebhooks(workspaceId: string): Promise<Webhook[]> {
  try {
    const { data, error } = await supabase
      .from('workspace_webhooks_safe')
      .select(
        'id, workspace_id, name, target_url, event_types, enabled, last_status_code, last_attempt_at, last_success_at, fail_count, created_by, created_at, updated_at',
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Webhook[];
  } catch (err) {
    if (isNetworkError(err)) {
      markCacheFallback();
      return [];
    }
    throw err;
  }
}

export type CreateWebhookInput = {
  workspaceId: string;
  name: string;
  targetUrl: string;
  eventTypes: WorkspaceEventKind[];
};

export type CreateWebhookResult = {
  id: string;
  signing_secret_hex: string;
};

export async function createWebhook(input: CreateWebhookInput): Promise<CreateWebhookResult> {
  const { data, error } = await supabase.rpc('create_workspace_webhook', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_target_url: input.targetUrl,
    p_event_types: input.eventTypes,
  });
  if (error) throw error;
  return data as CreateWebhookResult;
}

export type UpdateWebhookInput = {
  id: string;
  name: string;
  targetUrl: string;
  eventTypes: WorkspaceEventKind[];
  enabled: boolean;
};

export async function updateWebhook(input: UpdateWebhookInput): Promise<void> {
  const { error } = await supabase.rpc('update_workspace_webhook', {
    p_id: input.id,
    p_name: input.name,
    p_target_url: input.targetUrl,
    p_event_types: input.eventTypes,
    p_enabled: input.enabled,
  });
  if (error) throw error;
}

export async function deleteWebhook(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_workspace_webhook', { p_id: id });
  if (error) throw error;
}

// Public-Liste der unterstuetzten Event-Types fuer das UI-Multi-Select.
// Single-Source — wenn DB ein neues ENUM-Value bekommt, hier ergaenzen.
export const EVENT_KIND_LABELS: Record<WorkspaceEventKind, string> = {
  'member.invited': 'Mitglied eingeladen',
  'member.joined': 'Mitglied beigetreten',
  'member.left': 'Mitglied verlassen',
  'member.role_changed': 'Rolle geaendert',
  'workspace.created': 'Workspace angelegt',
  'workspace.renamed': 'Workspace umbenannt',
  'workspace.deleted': 'Workspace geloescht',
  'workspace.transferred': 'Eigentum uebertragen',
  'task.created': 'Task angelegt',
  'task.completed': 'Task erledigt',
  'task.deleted': 'Task geloescht',
  'cell.created': 'Zelle angelegt',
  'cell.deleted': 'Zelle geloescht',
};

export const EVENT_KINDS: WorkspaceEventKind[] = Object.keys(
  EVENT_KIND_LABELS,
) as WorkspaceEventKind[];
