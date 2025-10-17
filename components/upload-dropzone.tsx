"use client";

import { useRef, useState } from "react";

interface UploadDropzoneProps {
  onUpload?: (file: File) => void;
  variant?: "default" | "compact";
  title?: string;
  description?: string;
  helperText?: string;
}

export function UploadDropzone({
  onUpload,
  variant = "default",
  title,
  description,
  helperText
}: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }
    if (file.type !== "application/pdf") {
      console.warn("Only PDF uploads are supported right now.");
      return;
    }
    onUpload?.(file);
  };

  const isCompact = variant === "compact";
  const resolvedTitle =
    title ?? (isCompact ? "Upload another paper" : "Drop your Paper here (PDF please!)");
  const resolvedDescription =
    description ?? (isCompact ? "or pick a new PDF to replace the active one." : "or click to browse your computer.");
  const resolvedHelper =
    helperText ??
    (isCompact
      ? "We will swap the reader to your newest upload."
      : "We will show your latest upload in the reader and add it to your sidebar list.");

  return (
    <div
      className={`w-full ${
        isCompact
          ? "flex flex-col items-center justify-center gap-4 text-center"
          : "mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center gap-6 text-center"
      }`}
    >
      {!isCompact && (
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">
            Validate Publication
          </h1>
          <p className="text-base text-slate-600">
            Drop a PDF to open it inside the reader. Each upload is saved to your sidebar library so you can jump back anytime.
          </p>
        </header>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          if (event.target.value) {
            event.target.value = "";
          }
        }}
      />
      <button
        type="button"
        onClick={() => {
          inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isDragging) {
            setIsDragging(true);
          }
        }}
        onDragLeave={() => {
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFiles(event.dataTransfer?.files ?? null);
        }}
        className={`flex w-full max-w-xl flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed bg-white/70 ${
          isCompact ? "px-6 py-8" : "p-10"
        } text-center transition-colors ${
          isDragging ? "border-primary/60 bg-white" : "border-slate-200 hover:border-primary/60 hover:bg-white"
        }`}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-xl text-primary">
          ⬆️
        </span>
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-900">{resolvedTitle}</p>
          <p className="text-sm text-slate-500">{resolvedDescription}</p>
        </div>
        <p className="text-xs text-slate-400">{resolvedHelper}</p>
      </button>
    </div>
  );
}
