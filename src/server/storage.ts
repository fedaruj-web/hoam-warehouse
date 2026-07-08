import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export const DOCUMENT_BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET ?? "hoam-documents";

export function getStorageClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function ensureDocumentBucket(storage: SupabaseClient) {
  const { data } = await storage.storage.getBucket(DOCUMENT_BUCKET);
  if (data) return;
  await storage.storage.createBucket(DOCUMENT_BUCKET, {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
  });
}
