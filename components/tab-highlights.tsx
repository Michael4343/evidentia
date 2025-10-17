import { TabHighlightItem } from "@/lib/mock-data";

interface TabHighlightsProps {
  heading: string;
  description: string;
  items: TabHighlightItem[];
  emptyMessage: string;
}

export function TabHighlights({ heading, description, items, emptyMessage }: TabHighlightsProps) {
  return (
    <section className="space-y-4 rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">{heading}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </header>
      {items.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.title}
              className="space-y-2 rounded-2xl border border-slate-100 bg-white/80 p-5"
            >
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="text-sm text-slate-600">{item.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}
