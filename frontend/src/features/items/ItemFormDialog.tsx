import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../lib/api-client";
import {
  blankPart, draftPartsFromBundle, partsPayload, partsReady, type Bundle, type DraftPart,
} from "../bundles/bundle-parts";
import { BundlePartsEditor } from "../bundles/BundlePartsEditor";
import type { Item } from "./types";
import { ItemLinksDialog } from "./ItemLinksDialog";
import {
  autoSubcategory, parseTypeValue, typeOfAssetOptions, typeValueFor,
  type TypeCategory, type TypeSubcategory,
} from "./type-of-asset";
import { NewBrandDialog, NewSubcategoryDialog, useCanCreateMasters } from "@/components/quick-create/masters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AsyncButton } from "@/components/shared/AsyncButton";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { brandOptions, nameOptions, namesById } from "@/lib/option-labels";
import { workAreaLabel } from "@/lib/labels";

interface Named {
  id: number;
  name: string;
}

/** The three serial behaviours, in plain words. The Item is the only place this lives. */
export type SerialMode = "has" | "none" | "later";

export const SERIAL_MODES: { value: SerialMode; label: string; hint: string }[] = [
  { value: "has", label: "Has serial number", hint: "Typed or scanned when the goods arrive." },
  { value: "none", label: "No serial number", hint: "Saved as N/A; nobody is asked for one." },
  { value: "later", label: "Serial will be entered later", hint: "The asset waits on the Serial Pending list until it is filled in." },
];

/** SerialMode -> the Item's two stored flags (unchanged API fields). */
export function serialFlags(mode: SerialMode): { serial_required: boolean; serial_later: boolean } {
  if (mode === "none") return { serial_required: false, serial_later: false };
  if (mode === "later") return { serial_required: true, serial_later: true };
  return { serial_required: true, serial_later: false };
}

export function serialModeOf(item: Pick<Item, "serial_required" | "serial_later">): SerialMode {
  if (item.serial_required === false) return "none";
  return item.serial_later ? "later" : "has";
}

/** Thrown when the set (bundle) was saved but the Item itself then failed. */
class ItemAfterSetError extends Error {}
/** Thrown when the set itself was refused (nothing was saved). */
class SetStepError extends Error {}

interface Draft {
  name: string;
  categoryId: string;
  subcategoryId: string;
  serial: SerialMode;
  brandId: string;
  warranty: string;
  isSet: boolean;
  /** The set this Item uses / edits (blank = a new set is made on Save). */
  setBundleId: string;
}

const BLANK: Draft = {
  name: "", categoryId: "", subcategoryId: "", serial: "has", brandId: "", warranty: "", isSet: false, setBundleId: "",
};

/**
 * The Item form -- ONE dialog for Settings › Catalogue › Items and for every screen that needs an Item
 * it does not have yet (Add Asset, a PO line, the ERP review, a set's part, ERP Mapping), so nobody has to
 * leave what they were doing.
 *
 * Asks for two things and one choice: Name, Type of asset (Category › Sub-category as one pick) and how the
 * serial number works. Everything else (default brand, warranty, "Comes as a set", ERP codes) is under More.
 */
export function ItemFormDialog({
  open, onOpenChange, item, initialName, onSaved, allowSet = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null / undefined = a new Item. */
  item?: Item | null;
  /** Prefills the name of a new Item (for example the ERP product name). */
  initialName?: string;
  onSaved?: (saved: Item) => void;
  /** Offer "Comes as a set" (off for an Item created as a part of a set: a part is a single thing). */
  allowSet?: boolean;
}) {
  const qc = useQueryClient();
  const canCreate = useCanCreateMasters();
  const categoriesQ = useQuery({ queryKey: ["masters", "categories"], queryFn: () => apiClient.get<TypeCategory[]>("/masters/categories"), enabled: open });
  const subsQ = useQuery({ queryKey: ["masters", "subcategories"], queryFn: () => apiClient.get<TypeSubcategory[]>("/masters/subcategories"), enabled: open });
  const bundlesQ = useQuery({ queryKey: ["bundles"], queryFn: () => apiClient.get<Bundle[]>("/bundles"), enabled: open && allowSet });
  const brandsQ = useQuery({ queryKey: ["masters", "brands"], queryFn: () => apiClient.get<Named[]>("/masters/brands"), enabled: open });
  const itemsQ = useQuery({ queryKey: ["items"], queryFn: () => apiClient.get<Item[]>("/items"), enabled: open && allowSet });
  const asList = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
  const categories = asList<TypeCategory>(categoriesQ.data);
  const subs = asList<TypeSubcategory>(subsQ.data);
  const bundles = asList<Bundle>(bundlesQ.data);
  const brands = asList<Named>(brandsQ.data);

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [newType, setNewType] = useState(false);
  const [newBrand, setNewBrand] = useState(false);
  const [newPartItemFor, setNewPartItemFor] = useState<number | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  // A set created by an earlier Save whose Item then failed: the retry updates it, never makes a second one.
  const createdSetId = useRef<number | null>(null);
  const [partsLoadedFor, setPartsLoadedFor] = useState<string>("");
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (!open) return;
    saveMutation.reset();
    createdSetId.current = null;
    setPartsLoadedFor("");
    setParts([]);
    if (item) {
      setDraft({
        name: item.name,
        categoryId: String(item.category_id),
        subcategoryId: item.subcategory_id ? String(item.subcategory_id) : "",
        serial: serialModeOf(item),
        brandId: item.default_brand_id ? String(item.default_brand_id) : "",
        warranty: item.default_warranty_years != null ? String(item.default_warranty_years) : "",
        isSet: item.bundle_id != null,
        setBundleId: item.bundle_id ? String(item.bundle_id) : "",
      });
      setMoreOpen(item.default_brand_id != null || item.default_warranty_years != null || item.bundle_id != null);
    } else {
      setDraft({ ...BLANK, name: initialName ?? "" });
      setMoreOpen(false);
    }
    // Starts fresh each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  // The parts of the set being edited, once the sets have loaded.
  const editingSet = bundles.find((b) => String(b.id) === draft.setBundleId);
  if (editingSet && partsLoadedFor !== draft.setBundleId) {
    setPartsLoadedFor(draft.setBundleId);
    setParts(draftPartsFromBundle(editingSet));
  }

  // A stored Item without a Sub-category, or a Category picked with only one: use its only Sub-category.
  const effectiveSubId = draft.subcategoryId || (() => {
    const auto = autoSubcategory(draft.categoryId ? Number(draft.categoryId) : null, subs);
    return auto ? String(auto) : "";
  })();
  const typeValue = typeValueFor(
    draft.categoryId ? Number(draft.categoryId) : null,
    effectiveSubId ? Number(effectiveSubId) : null,
    subs,
  );
  const chosenCategory = categories.find((c) => String(c.id) === draft.categoryId);
  const categoryWithoutSub = draft.categoryId !== "" && effectiveSubId === "";

  function chooseType(value: string) {
    const parsed = parseTypeValue(value);
    if (!parsed) return;
    if (parsed.kind === "sub") {
      const sub = subs.find((s) => s.id === parsed.id);
      set({ categoryId: sub ? String(sub.category_id) : draft.categoryId, subcategoryId: String(parsed.id) });
      return;
    }
    set({ categoryId: String(parsed.id), subcategoryId: "" });
    // A group with no Sub-category yet: give it one right away.
    if (autoSubcategory(parsed.id, subs) === null && canCreate) setNewType(true);
  }

  function toggleSet(on: boolean) {
    set({ isSet: on });
    if (on && parts.length === 0) setParts([blankPart()]);
  }

  function startNewSet() {
    set({ setBundleId: "" });
    setPartsLoadedFor("");
    setParts([blankPart()]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const itemName = draft.name.trim();
      let bundleId: number | null = allowSet ? null : (item?.bundle_id ?? null);
      let setSaved = false;
      if (allowSet && draft.isSet) {
        const existingId = draft.setBundleId ? Number(draft.setBundleId) : createdSetId.current;
        try {
          if (existingId) {
            // Edits keep the same set; an existing set keeps its own name.
            const keepName = bundles.find((b) => b.id === existingId)?.name ?? itemName;
            await apiClient.put(`/bundles/${existingId}`, { name: keepName, parts: partsPayload(parts) });
            bundleId = existingId;
          } else {
            const created = await apiClient.post<Bundle>("/bundles", { name: itemName, parts: partsPayload(parts) });
            bundleId = created.id;
            createdSetId.current = created.id;
          }
        } catch (e) {
          throw new SetStepError(e instanceof Error ? e.message : "Could not save the set.");
        }
        setSaved = true;
      }
      const body = {
        name: itemName,
        category_id: Number(draft.categoryId),
        subcategory_id: Number(effectiveSubId),
        ...serialFlags(draft.serial),
        bundle_id: bundleId,
        default_brand_id: draft.brandId ? Number(draft.brandId) : null,
        default_warranty_years: draft.warranty !== "" ? Number(draft.warranty) : null,
      };
      try {
        return item ? await apiClient.put<Item>(`/items/${item.id}`, body) : await apiClient.post<Item>("/items", body);
      } catch (e) {
        if (setSaved) throw new ItemAfterSetError(e instanceof Error ? e.message : "Could not save the Item.");
        throw e;
      }
    },
    onSuccess: async (saved) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["items"] }),
        qc.invalidateQueries({ queryKey: ["bundles"] }),
      ]);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onSettled: () => {
      // A set made on this Save is now "the" set of this form, so a retry updates it.
      if (createdSetId.current !== null) qc.invalidateQueries({ queryKey: ["bundles"] });
    },
  });

  const missing: string[] = [];
  if (draft.name.trim() === "") missing.push("a name");
  if (draft.categoryId === "" || effectiveSubId === "") missing.push("the type of asset");
  if (allowSet && draft.isSet && !partsReady(parts)) missing.push("every part's name, Item and share (total 100%)");
  const canSave = missing.length === 0;

  // A part is a single thing: never an Item that is itself a set, nor this Item.
  const partItems = asList<Item>(itemsQ.data).filter((i) => i.bundle_id === null && i.id !== item?.id);
  const lookups = { categories: namesById(categories), subcategories: namesById(subs) };

  let errorText: string | null = null;
  if (saveMutation.isError) {
    const e = saveMutation.error;
    if (e instanceof ItemAfterSetError) {
      errorText = `The set (its parts) was saved, but the Item was not: ${e.message} Correct it and press Save again; the set is updated, not made twice.`;
    } else if (e instanceof SetStepError) {
      errorText = `Nothing was saved: the set was refused (${e.message}).${
        /already exists/i.test(e.message) ? " Pick it under “Or use a set that already exists”, or rename the Item." : ""
      }`;
    } else {
      errorText = e instanceof Error ? e.message : "Could not save the Item.";
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{item ? "Edit Item" : "New Item"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <FormField htmlFor="item-name" label="Item name" required>
              <Input id="item-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ceiling Fan" />
            </FormField>

            <FormField
              htmlFor="item-type" label="Type of asset" required
              helperText={
                chosenCategory && chosenCategory.asset_domain
                  ? `Work area: ${workAreaLabel(chosenCategory.asset_domain)} (from its Asset Group).`
                  : "The Asset Group and its Sub-category, chosen as one."
              }
            >
              <SearchableSelect
                id="item-type"
                value={typeValue}
                onValueChange={chooseType}
                options={typeOfAssetOptions(categories, subs)}
                placeholder="Choose the type of asset"
                searchPlaceholder="Search groups and sub-categories…"
                onCreateNew={canCreate ? () => setNewType(true) : undefined}
                createLabel="New type…"
              />
            </FormField>
            {categoryWithoutSub && (
              <p className="-mt-1 text-xs text-destructive" role="note">
                {canCreate
                  ? "This group has no Sub-category yet. Use “New type…” to add one."
                  : "This group has no Sub-category yet. Ask the head-office admin to add one (Settings › Catalogue › Asset Groups)."}
              </p>
            )}

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium leading-none">
                Serial number<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
              </legend>
              <RadioGroup
                value={draft.serial}
                onValueChange={(v) => set({ serial: v as SerialMode })}
                className="grid gap-1.5 sm:grid-cols-3"
                aria-label="Serial number"
              >
                {SERIAL_MODES.map((m) => (
                  <label
                    key={m.value}
                    htmlFor={`item-serial-${m.value}`}
                    className="flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5"
                  >
                    <RadioGroupItem id={`item-serial-${m.value}`} value={m.value} aria-label={m.label} className="mt-0.5" />
                    <span className="flex flex-col">
                      <span className="font-medium">{m.label}</span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </fieldset>

            <div className="border-t pt-2">
              <Button
                type="button" variant="ghost" size="sm" className="-ml-2 gap-1 text-muted-foreground"
                aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                More
              </Button>
              {moreOpen && (
                <div className="mt-2 flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField htmlFor="item-brand" label="Default brand">
                      <SearchableSelect
                        id="item-brand" value={draft.brandId || undefined} onValueChange={(v) => set({ brandId: v })}
                        options={[{ value: "", label: "None" }, ...brandOptions(brands)]}
                        placeholder="None"
                        onCreateNew={canCreate ? () => setNewBrand(true) : undefined} createLabel="New Brand…"
                      />
                    </FormField>
                    <FormField htmlFor="item-warranty" label="Default warranty (years)">
                      <Input id="item-warranty" type="number" min={0} step={1} value={draft.warranty} onChange={(e) => set({ warranty: e.target.value })} />
                    </FormField>
                  </div>

                  {allowSet && (
                    <div className="flex flex-col gap-2 rounded-md border p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="item-set" className="flex flex-col gap-0.5">
                          <span>Comes as a set</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            For a Desktop-style Item: each part (CPU, TFT, …) becomes its own asset.
                          </span>
                        </Label>
                        <Switch id="item-set" checked={draft.isSet} onCheckedChange={toggleSet} />
                      </div>
                      {draft.isSet && (
                        <>
                          {draft.setBundleId ? (
                            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              Parts of the set “{editingSet?.name ?? "…"}”.
                              {!item?.bundle_id && (
                                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={startNewSet}>
                                  Make a new set instead
                                </Button>
                              )}
                            </p>
                          ) : (
                            bundles.length > 0 && (
                              <FormField htmlFor="item-set-existing" label="Or use a set that already exists">
                                <SearchableSelect
                                  id="item-set-existing" value={undefined}
                                  onValueChange={(v) => { set({ setBundleId: v }); setPartsLoadedFor(""); }}
                                  options={nameOptions(bundles)}
                                  placeholder="A new set for this Item"
                                />
                              </FormField>
                            )
                          )}
                          <BundlePartsEditor
                            parts={parts}
                            onChange={setParts}
                            items={partItems}
                            categories={lookups.categories}
                            subcategories={lookups.subcategories}
                            onNewItem={canCreate ? setNewPartItemFor : undefined}
                            idPrefix="item-part"
                            showExample
                          />
                        </>
                      )}
                      {!draft.isSet && item?.bundle_id != null && (
                        <p className="text-xs text-muted-foreground">
                          On Save this Item stops coming as a set. The set itself is kept, not deleted.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      ERP codes:{" "}
                      {item ? `${item.map_count} linked` : "link them after saving (Items list, ERP links)."}
                    </span>
                    {item && (
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowLinks(true)}>
                        Open ERP links
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {errorText && (
            <p className="text-sm text-destructive" role="alert">{errorText}</p>
          )}
          {!canSave && draft.name.trim() !== "" && (
            <p className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <AsyncButton onClick={() => saveMutation.mutate()} disabled={!canSave} pending={saveMutation.isPending} pendingLabel="Saving…">
              Save
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewSubcategoryDialog
        open={newType}
        onOpenChange={setNewType}
        defaultCategoryId={draft.categoryId || undefined}
        onCreated={(row) => set({ categoryId: String(row.category_id), subcategoryId: String(row.id) })}
      />
      <NewBrandDialog open={newBrand} onOpenChange={setNewBrand} onCreated={(row) => set({ brandId: String(row.id) })} />
      {allowSet && newPartItemFor !== null && (
        <ItemFormDialog
          open
          allowSet={false}
          onOpenChange={(o) => !o && setNewPartItemFor(null)}
          initialName={parts[newPartItemFor]?.name}
          onSaved={(saved) => {
            const i = newPartItemFor;
            setParts((ps) => ps.map((p, idx) => (idx === i ? { ...p, itemId: String(saved.id) } : p)));
          }}
        />
      )}
      {showLinks && item && <ItemLinksDialog item={item} onClose={() => setShowLinks(false)} />}
    </>
  );
}
