"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { PAPERS_BUCKET } from "@/lib/user-papers";

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
  source: "local" | "remote";
  storagePath?: string;
  className?: string;
}

function ensurePdfBlob(blob: Blob) {
  if (blob.type === "application/pdf") {
    return blob;
  }
  return new Blob([blob], { type: "application/pdf" });
}

function withViewerParams(url: string) {
  const stripped = url.trim();
  if (!stripped) {
    return stripped;
  }
  const separator = stripped.includes("#") ? (stripped.endsWith("#") || stripped.endsWith("&") ? "" : "&") : "#";
  const params = "toolbar=0&navpanes=0&scrollbar=0";
  return `${stripped}${separator}${params}`;
}

export function PdfViewer({ fileUrl, fileName, source, storagePath, className }: PdfViewerProps) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    const revokeObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    const setFromBlob = (blob: Blob) => {
      revokeObjectUrl();
      const nextUrl = URL.createObjectURL(ensurePdfBlob(blob));
      objectUrlRef.current = nextUrl;
      setObjectUrl(nextUrl);
      setIsLoading(false);
      setError(null);
    };

    const loadRemotePdf = async () => {
      if (!fileUrl) {
        setError("Missing PDF location.");
        setIsLoading(false);
        setObjectUrl(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      const tryFetchDirect = async () => {
        try {
          const response = await fetch(fileUrl, { credentials: "include" });
          if (!response.ok) {
            throw new Error(`Fetch failed with status ${response.status}`);
          }
          const blob = await response.blob();
          if (isCancelled) {
            return false;
          }
          setFromBlob(blob);
          return true;
        } catch (fetchError) {
          console.warn("Direct PDF fetch failed", fetchError);
          return false;
        }
      };

      const tryDownloadViaSupabase = async () => {
        if (!supabase || !storagePath) {
          return false;
        }
        try {
          const { data, error: downloadError } = await supabase.storage.from(PAPERS_BUCKET).download(storagePath);
          if (downloadError) {
            throw downloadError;
          }
          if (!data) {
            throw new Error("No data returned from Supabase storage download");
          }
          if (isCancelled) {
            return false;
          }
          setFromBlob(data);
          return true;
        } catch (downloadError) {
          console.error("Supabase storage download failed", downloadError);
          return false;
        }
      };

      const resolved = (await tryFetchDirect()) || (await tryDownloadViaSupabase());

      if (!resolved && !isCancelled) {
        setIsLoading(false);
        setObjectUrl(null);
        setError("Your browser can't preview this PDF. Please download it instead.");
      }
    };

    if (source === "remote") {
      void loadRemotePdf();
    } else {
      setIsLoading(false);
      setError(null);
      if (fileUrl) {
        setObjectUrl(fileUrl);
      } else {
        setObjectUrl(null);
      }
      revokeObjectUrl();
    }

    return () => {
      isCancelled = true;
      revokeObjectUrl();
    };
  }, [fileUrl, source, storagePath, supabase]);

  if (isLoading) {
    return (
      <div className={`flex h-[70vh] w-full flex-col items-center justify-center gap-3 bg-slate-50 ${className ?? ""}`}>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <p className="text-sm text-slate-500">Loading preview…</p>
      </div>
    );
  }

  const viewerUrl = objectUrl ? withViewerParams(objectUrl) : null;

  if (!viewerUrl) {
    return (
      <div className={`flex h-[70vh] w-full items-center justify-center bg-slate-50 p-6 text-sm text-slate-600 ${className ?? ""}`}>
        <p>
          {error ?? "Your browser was unable to display this PDF."}
          <a href={fileUrl || "#"} download={fileName} className="ml-2 text-primary underline">
            Download the file instead.
          </a>
        </p>
      </div>
    );
  }

  return (
    <object
      data={viewerUrl}
      type="application/pdf"
      className={className ?? "h-[70vh] w-full"}
      aria-label={`Preview of ${fileName}`}
    >
      <p className="p-4 text-sm text-slate-600">
        Your browser was unable to display this PDF.
        <a href={fileUrl || objectUrl} download={fileName} className="ml-2 text-primary underline">
          Download the file instead.
        </a>
      </p>
    </object>
  );
}
