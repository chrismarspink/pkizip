/**
 * 조직 공용 주소록
 */
import { restGet, restPost, restPatch, restDelete } from './rest';

export type ContactCategory = 'member' | 'partner' | 'custom';
export type ContactSource = 'manual' | 'imported' | 'linked_user';

export interface OrgContact {
  id: string;
  tenant_id: string;
  category: ContactCategory;
  display_name: string;
  email?: string | null;
  organization?: string | null;
  job_title?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
  fingerprint?: string | null;
  cert_classic?: string | null;
  cert_kem?: string | null;
  cert_dsa?: string | null;
  enc_jwk_classic?: JsonWebKey | null;
  logotype?: string | null;
  linked_user_id?: string | null;
  source: ContactSource;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export type ContactDraft = Omit<OrgContact, 'id' | 'created_at' | 'updated_at' | 'tenant_id'> & {
  tenant_id?: string;
};

export async function listContacts(tenantId: string, category?: ContactCategory): Promise<OrgContact[]> {
  let q = `tenant_address_book?tenant_id=eq.${tenantId}&select=*&order=display_name.asc&limit=500`;
  if (category) q += `&category=eq.${category}`;
  return restGet<OrgContact[]>(q);
}

export async function searchContacts(tenantId: string, query: string): Promise<OrgContact[]> {
  const q = encodeURIComponent(`%${query.trim()}%`);
  const filter = `or=(display_name.ilike.${q},email.ilike.${q},organization.ilike.${q},job_title.ilike.${q})`;
  return restGet<OrgContact[]>(
    `tenant_address_book?tenant_id=eq.${tenantId}&${filter}&select=*&order=display_name.asc&limit=200`
  );
}

export async function getContact(id: string): Promise<OrgContact | null> {
  const rows = await restGet<OrgContact[]>(`tenant_address_book?id=eq.${id}&limit=1`);
  return rows[0] ?? null;
}

export async function createContact(tenantId: string, userId: string, draft: ContactDraft): Promise<OrgContact> {
  const body = {
    tenant_id: tenantId,
    created_by: userId,
    updated_at: new Date().toISOString(),
    tags: draft.tags ?? [],
    source: draft.source ?? 'manual',
    ...draft,
  };
  const rows = await restPost<OrgContact[]>('tenant_address_book', body);
  return rows[0];
}

export async function updateContact(id: string, patch: Partial<ContactDraft>): Promise<OrgContact> {
  const body = { ...patch, updated_at: new Date().toISOString() };
  const rows = await restPatch<OrgContact[]>(`tenant_address_book?id=eq.${id}`, body);
  return rows[0];
}

export async function deleteContact(id: string): Promise<void> {
  await restDelete(`tenant_address_book?id=eq.${id}`);
}
