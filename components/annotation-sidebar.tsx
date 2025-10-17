import { PaperComment } from "@/lib/mock-data";

interface AnnotationSidebarProps {
  comments: PaperComment[];
}

export function AnnotationSidebar({ comments }: AnnotationSidebarProps) {
  return (
    <aside className="flex h-full flex-col gap-4 rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Annotations</h3>
        <p className="text-xs text-slate-500">
          Signed-in readers see their highlights and notes here.
        </p>
      </div>
      {comments.length ? (
        <ul className="space-y-3 text-sm text-slate-600">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
              <p className="text-xs font-semibold text-slate-500">{comment.author}</p>
              <p className="mt-1 text-sm text-slate-700">{comment.text}</p>
              <p className="mt-2 text-xs text-slate-400">
                Page {comment.page} · {comment.timestamp}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-500">
          No annotations yet. Sign in to leave the first note.
        </div>
      )}
      <button className="mt-auto rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900">
        Sign in to add annotations
      </button>
    </aside>
  );
}
