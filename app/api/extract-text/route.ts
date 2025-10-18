import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { PAPERS_BUCKET } from "@/lib/user-papers";

// Ensure Node runtime for pdf-parse
export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

function getSupabaseServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false
      }
    });
  } catch (error) {
    console.error("[extract-text] Failed to create Supabase service client", error);
    return null;
  }
}

async function blobToUint8Array(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const storagePath = formData.get("storagePath");
    const fileUrl = formData.get("fileUrl");

    let binary: Uint8Array | null = null;

    if (typeof storagePath === "string" && storagePath.trim().length > 0) {
      const supabase = getSupabaseServiceClient();

      if (supabase) {
        const { data, error } = await supabase.storage.from(PAPERS_BUCKET).download(storagePath.trim());
        if (error) {
          console.warn("[extract-text] Supabase download failed", error);
        } else if (data) {
          binary = await blobToUint8Array(data);
        }
      } else {
        console.warn("[extract-text] Supabase service client not configured; skipping storage download");
      }
    }

    if (!binary && typeof fileUrl === "string" && fileUrl.trim().length > 0) {
      try {
        const response = await fetch(fileUrl.trim(), { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Fetch failed with status ${response.status}`);
        }
        const blob = await response.blob();
        binary = await blobToUint8Array(blob);
      } catch (downloadError) {
        console.warn("[extract-text] Remote fetch fallback failed", downloadError);
      }
    }

    if (!binary) {
      if (!(file instanceof File)) {
        return NextResponse.json(
          {
            error: "No PDF data provided for extraction",
            hint: "Send a Supabase storage path, a reachable file URL, or include the PDF file contents."
          },
          { status: 400 }
        );
      }

      if (file.type !== "application/pdf") {
        return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 415 });
      }

      binary = await blobToUint8Array(file);
    }

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const loadingTask = pdfjsLib.getDocument({ data: binary, disableWorker: true });
    const doc = await loadingTask.promise;

    const metadata = await doc.getMetadata().catch(() => null);
    const info = metadata?.info ?? null;
    const numPages = doc.numPages ?? null;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const strings = content.items
        .map((item) => ("str" in item ? item.str : typeof item === "string" ? item : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pageTexts.push(strings);
    }

    await doc.cleanup();
    await doc.destroy();

    const text = pageTexts
      .map((pageText, index) => `--- Page ${index + 1} ---\n\n${pageText}`)
      .join("\n\n");

    return NextResponse.json({
      pages: numPages,
      info,
      text
    });
  } catch (err: any) {
    console.error("[extract-text] Error:", err);
    return NextResponse.json(
      { error: `Failed to extract text: ${err?.message || "Unknown error"}` },
      { status: 500 },
    );
  }
}
