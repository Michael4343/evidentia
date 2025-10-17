"use client";

import { useAuthModal } from "@/components/auth-modal-provider";

export function UploadDropzone() {
  const { open, user, isAuthReady } = useAuthModal();

  const handleAction = () => {
    if (!user) {
      open("signup");
      return;
    }
    console.info("Upload pipeline coming soon — authenticated user detected.");
  };

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-6 text-center">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">
          Validate Publication
        </h1>
        <p className="text-base text-slate-600">
          Drop a paper (PDF please!) to start processing. We detect the DOI and compile similar papers, patents and PhD thesis (with data if available) to better understand if this work is reproducible!
        </p>
      </header>
      <button
        type="button"
        onClick={handleAction}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleAction();
        }}
        disabled={!isAuthReady}
        className="flex w-full max-w-xl flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-slate-200 bg-white/70 p-10 text-center transition-colors hover:border-primary/60 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-xl text-primary">
          ⬆️
        </span>
        <div className="space-y-1">
          <p className="text-base font-medium text-slate-900">Drop your Paper here (PDF please!)</p>
          <p className="text-sm text-slate-500">or click to browse your computer.</p>
        </div>
        {user ? (
          <p className="text-xs text-slate-400">Uploads process automatically once the pipeline is wired up.</p>
        ) : (
          <p className="text-xs text-slate-400">We will prompt you to create an account before processing.</p>
        )}
      </button>
    </div>
  );
}
