/**
 * 감사 로그
 */
import { restGet, restPost } from './rest';

export interface AuditLog {
  id: number;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function logAudit(
  actorId: string,
  action: string,
  opts: { tenantId?: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await restPost('audit_logs', {
      actor_id: actorId,
      tenant_id: opts.tenantId ?? null,
      action,
      target_type: opts.targetType ?? null,
      target_id: opts.targetId ?? null,
      metadata: opts.metadata ?? {},
      user_agent: navigator.userAgent.slice(0, 500),
    }, 'return=minimal');
  } catch (err) {
    console.warn('[audit] 기록 실패:', err);
  }
}

export async function listAuditLogs(tenantId: string, limit = 100): Promise<AuditLog[]> {
  return restGet<AuditLog[]>(
    `audit_logs?tenant_id=eq.${tenantId}&select=*&order=created_at.desc&limit=${limit}`
  );
}

export async function listAllAuditLogs(limit = 200): Promise<AuditLog[]> {
  return restGet<AuditLog[]>(`audit_logs?select=*&order=created_at.desc&limit=${limit}`);
}
