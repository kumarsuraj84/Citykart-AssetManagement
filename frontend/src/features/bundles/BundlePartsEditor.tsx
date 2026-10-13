import { Trash2 } from "lucide-react";
import type { Item } from "../items/types";
import { yesNo } from "../../lib/serial-rule";
import { itemOptions, type NameLookup } from "@/lib/option-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { MAX_BUNDLE_PARTS } from "../../lib/limits";
import { blankPart, desktopExample, shareTotal, sharesAddUp, type DraftPart } from "./bundle-parts";

function lookup(map: NameLookup | undefined, id: number | null | undefined): string | undefined {
  if (!map || id == null) return undefined;
  return map instanceof Map ? map.get(id) : map[id];
}

/**
 * The parts of a set (bundle): one row per part (part name, the Item it is,
 * its share of the price) plus the running total, which must be exactly 100%.
 * Shared by the Bundles screen and the Item form's "Comes as a set".
 */
export function BundlePartsEditor({
  parts,
  onChange,
  items,
  categories,
  subcategories,
  onNewItem,
  idPrefix = "part",
  showExample = false,
}: {
  parts: DraftPart[];
  onChange: (parts: DraftPart[]) => void;
  /** Items a part may be: single things only (never an Item that is itself a set). */
  items: Item[];
  categories?: NameLookup;
  subcategories?: NameLookup;
  /** Offered as "New Item…" in each part's Item picker (only to someone who may create Items). */
  onNewItem?: (index: number) => void;
  /** Prefix of the element ids (part-name-0, part-item-0, part-share-0). */
  idPrefix?: string;
  /** Shows the "Use the Desktop example" helper above the parts. */
  showExample?: boolean;
}) {
  const options = itemOptions(items, { categories, subcategories });
  const classOf = (itemId: string) => {
    const it = items.find((i) => i.id === Number(itemId));
    if (!it) return "";
    return [lookup(categories, it.category_id), lookup(subcategories, it.subcategory_id)].filter(Boolean).join(" › ");
  };
  const setPart = (i: number, patch: Partial<DraftPart>) =>
    onChange(parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const total = shareTotal(parts);
  const totalOk = sharesAddUp(parts);

  return (
    <div className="flex flex-col gap-2">
      {showExample && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Each part becomes its own asset; its share splits the price.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(desktopExample())}>
            Use the Desktop example
          </Button>
        </div>
      )}
      {parts.map((p, i) => (
        <div key={i} className="grid grid-cols-12 items-end gap-2 rounded-md border p-2">
          <div className="col-span-12 flex flex-col gap-1 sm:col-span-3">
            <Label htmlFor={`${idPrefix}-name-${i}`} className="text-xs">Part name</Label>
            <Input id={`${idPrefix}-name-${i}`} value={p.name} onChange={(e) => setPart(i, { name: e.target.value })} />
          </div>
          <div className="col-span-12 flex flex-col gap-1 sm:col-span-4">
            <Label htmlFor={`${idPrefix}-item-${i}`} className="text-xs">Item</Label>
            <SearchableSelect
              id={`${idPrefix}-item-${i}`}
              value={p.itemId || undefined}
              onValueChange={(v) => setPart(i, { itemId: v })}
              options={options}
              placeholder="Choose the Item"
              onCreateNew={onNewItem ? () => onNewItem(i) : undefined}
              createLabel="New Item…"
            />
            <p className="text-xs text-muted-foreground">{classOf(p.itemId)}</p>
          </div>
          <div className="col-span-5 flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-share-${i}`} className="text-xs">Share %</Label>
            <Input
              id={`${idPrefix}-share-${i}`}
              type="number"
              min={0}
              step="0.01"
              value={p.share}
              onChange={(e) => setPart(i, { share: e.target.value })}
            />
          </div>
          {/* Not chosen here: it is the part's own Item setting. */}
          <p className="col-span-5 pb-2 text-xs text-muted-foreground sm:col-span-2" title="Set on the Item, not on the set">
            Serial: {p.itemId ? yesNo(items.find((it) => it.id === Number(p.itemId))?.serial_required !== false) : "—"}
          </p>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="col-span-2 sm:col-span-1"
            aria-label={`Remove ${p.name || `part ${i + 1}`}`}
            disabled={parts.length === 1}
            onClick={() => onChange(parts.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            type="button" variant="outline" size="sm" disabled={parts.length >= MAX_BUNDLE_PARTS}
            onClick={() => onChange([...parts, blankPart()])}
          >
            + Add part
          </Button>
          {parts.length >= MAX_BUNDLE_PARTS && (
            <span className="text-xs text-muted-foreground">A set can have at most {MAX_BUNDLE_PARTS} parts.</span>
          )}
        </div>
        <p className={`text-sm tabular-nums ${totalOk ? "text-muted-foreground" : "text-destructive"}`} role="status">
          Total {Math.round(total * 100) / 100}% {totalOk ? "" : "(must be exactly 100%)"}
        </p>
      </div>
    </div>
  );
}
