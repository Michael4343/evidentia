import { type SupabaseClient } from "@supabase/supabase-js";

export const PAPERS_BUCKET = "papers";

export interface UserPaperRecord {
  id: string;
  user_id: string;
  doi: string | null;
  title: string;
  file_name: string;
  file_size: number;
  storage_path: string;
  uploaded_at: string;
  publicUrl?: string;
}

export interface PersistPaperInput {
  client: SupabaseClient;
  userId: string;
  file: File;
  doi: string | null;
  title: string;
}

export function createStoragePath(userId: string, fileName: string) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9-_]/g, "_");
  const [baseName, extension] = (() => {
    const trimmed = fileName.trim();
    const lastDotIndex = trimmed.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return [trimmed, "pdf"];
    }
    return [trimmed.slice(0, lastDotIndex), trimmed.slice(lastDotIndex + 1) || "pdf"];
  })();

  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeBase = slug.length > 0 ? slug : "paper";
  return `${safeUserId}/${safeBase}-${uniqueSuffix}.${extension || "pdf"}`;
}

export async function persistUserPaper({ client, userId, file, doi, title }: PersistPaperInput) {
  const storagePath = createStoragePath(userId, file.name);

  const uploadResult = await client.storage
    .from(PAPERS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: "application/pdf"
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const storage = client.storage.from(PAPERS_BUCKET);
  const publicUrlResult = storage.getPublicUrl(storagePath);
  let publicUrl = publicUrlResult?.data?.publicUrl ?? null;

  if (!publicUrl) {
    const signedUrlResult = await storage.createSignedUrl(storagePath, 60 * 60 * 24);
    if (signedUrlResult.error) {
      console.warn("Failed to create signed URL for paper", signedUrlResult.error);
    } else {
      publicUrl = signedUrlResult.data?.signedUrl ?? null;
    }
  }

  const insertResult = await client
    .from("user_papers")
    .insert({
      user_id: userId,
      doi,
      title,
      file_name: file.name,
      file_size: file.size,
      storage_path: storagePath
    })
    .select()
    .single();

  if (insertResult.error) {
    throw insertResult.error;
  }

  return {
    record: insertResult.data as UserPaperRecord,
    publicUrl
  };
}

export async function fetchUserPapers(client: SupabaseClient, userId: string) {
  const result = await client
    .from("user_papers")
    .select("id, doi, title, file_name, file_size, storage_path, uploaded_at")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });

  if (result.error) {
    throw result.error;
  }

  const papers = result.data as UserPaperRecord[];
  const storage = client.storage.from(PAPERS_BUCKET);

  const withUrls = await Promise.all(
    papers.map(async (paper) => {
      const publicUrlResult = storage.getPublicUrl(paper.storage_path);
      let fileUrl = publicUrlResult.data?.publicUrl ?? undefined;

      if (!fileUrl) {
        const signedUrlResult = await storage.createSignedUrl(paper.storage_path, 60 * 60 * 24);
        if (signedUrlResult.error) {
          console.warn("Failed to create signed URL for paper", signedUrlResult.error);
        } else {
          fileUrl = signedUrlResult.data?.signedUrl ?? undefined;
        }
      }

      return { ...paper, publicUrl: fileUrl };
    })
  );

  return withUrls;
}

export interface DeletePaperInput {
  client: SupabaseClient;
  userId: string;
  paperId: string;
  storagePath: string;
}

export async function deleteUserPaper({ client, userId, paperId, storagePath }: DeletePaperInput) {
  // Delete from storage bucket first
  const deleteStorageResult = await client.storage
    .from(PAPERS_BUCKET)
    .remove([storagePath]);

  if (deleteStorageResult.error) {
    console.warn("Failed to delete file from storage", deleteStorageResult.error);
    // Continue with DB deletion even if storage deletion fails
  }

  // Delete claims JSON if it exists
  const claimsPath = storagePath.replace(/\.pdf$/i, "-claims.json");
  const deleteClaimsResult = await client.storage
    .from(PAPERS_BUCKET)
    .remove([claimsPath]);

  if (deleteClaimsResult.error) {
    console.warn("Failed to delete claims from storage (may not exist)", deleteClaimsResult.error);
  }

  // Delete from database
  const deleteDbResult = await client
    .from("user_papers")
    .delete()
    .eq("id", paperId)
    .eq("user_id", userId);

  if (deleteDbResult.error) {
    throw deleteDbResult.error;
  }

  return { success: true };
}

export interface SaveClaimsInput {
  client: SupabaseClient;
  userId: string;
  paperId: string;
  storagePath: string;
  claimsData: any;
}

export async function saveClaimsToStorage({ client, userId, paperId, storagePath, claimsData }: SaveClaimsInput) {
  const claimsPath = storagePath.replace(/\.pdf$/i, "-claims.json");
  const claimsBlob = new Blob([JSON.stringify(claimsData, null, 2)], {
    type: "application/json"
  });

  const uploadResult = await client.storage
    .from(PAPERS_BUCKET)
    .upload(claimsPath, claimsBlob, {
      cacheControl: "3600",
      upsert: true,
      contentType: "application/json"
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  return { claimsPath };
}

export interface LoadClaimsInput {
  client: SupabaseClient;
  storagePath: string;
}

export async function loadClaimsFromStorage({ client, storagePath }: LoadClaimsInput) {
  const claimsPath = storagePath.replace(/\.pdf$/i, "-claims.json");

  const downloadResult = await client.storage
    .from(PAPERS_BUCKET)
    .download(claimsPath);

  if (downloadResult.error) {
    // File doesn't exist yet - this is OK
    return null;
  }

  const text = await downloadResult.data.text();
  const parsed = JSON.parse(text);

  return parsed;
}
