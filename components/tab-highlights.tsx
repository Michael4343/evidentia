import { TabHighlightItem } from "@/lib/mock-data";

interface TabHighlightsProps {
  heading: string;
  description: string;
  items: TabHighlightItem[];
  emptyMessage: string;
}

export function TabHighlights({ heading, description, items, emptyMessage }: TabHighlightsProps) {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">{heading}</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </header>
      {items.length ? (
        <ul className="space-y-6">
          {items.map((item) => (
            <li key={item.title} className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
              <p className="text-sm text-slate-600">{item.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">{emptyMessage}</p>
      )}
    </section>
  );
}
