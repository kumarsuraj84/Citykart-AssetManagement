import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

interface Named {
  id: number;
  name: string;
  code?: string | null;
}

/** Where a person or place is: an existing Place of the company, or the name of a new one. */
export interface PlaceChoice {
  /** An existing place's id, NEW_PLACE (type a name), or "" (none chosen / the default). */
  pick: string;
  newName: string;
}

export const NEW_PLACE = "__new_place__";
export const EMPTY_PLACE: PlaceChoice = { pick: "", newName: "" };

/** The place part of a request: `location_id`, `location_name`, or nothing (left to the server). */
export function placeBody(p: PlaceChoice): { location_id?: number; location_name?: string } {
  if (p.pick === NEW_PLACE) return p.newName.trim() ? { location_name: p.newName.trim() } : {};
  if (p.pick) return { location_id: Number(p.pick) };
  return {};
}

/** A place is given (an existing one, or a typed new name). */
export const placeGiven = (p: PlaceChoice) => (p.pick === NEW_PLACE ? p.newName.trim() !== "" : p.pick !== "");

/**
 * The company's places to pick from, plus "A new place (type its name)"; the
 * server reuses a place of that name or makes it (S5 `location_name`). With no
 * place yet, the name is asked straight away. `optionalLabel` adds a first
 * choice that leaves the place to the server (a store's own place).
 */
export function PlacePicker({
  id, companyId, value, onChange, required = false, optionalLabel, helperText,
}: {
  id: string;
  companyId: number | null;
  value: PlaceChoice;
  onChange: (next: PlaceChoice) => void;
  required?: boolean;
  /** Shown as the first choice when the place may be left to the server. */
  optionalLabel?: string;
  helperText?: string;
}) {
  const placesQ = useQuery({
    queryKey: ["masters", "locations", companyId],
    queryFn: () => apiClient.get<Named[]>(`/masters/locations?company_id=${companyId}`),
    enabled: companyId != null,
  });
  const places = Array.isArray(placesQ.data) ? placesQ.data : [];
  const noPlaces = placesQ.isSuccess && places.length === 0;
  const typing = value.pick === NEW_PLACE || (noPlaces && !optionalLabel);
  const options = [
    ...(optionalLabel ? [{ value: "", label: optionalLabel }] : []),
    ...places.map((p) => ({ value: String(p.id), label: p.name, keywords: p.code ? [p.code] : undefined })),
    { value: NEW_PLACE, label: "A new place (type its name)" },
  ];
  return (
    <>
      {!(noPlaces && !optionalLabel) && (
        <FormField
          htmlFor={id} label="Place" required={required}
          helperText={helperText ?? "Pick the place, or choose “A new place” and type its name."}
        >
          <SearchableSelect
            id={id}
            aria-label="Place"
            value={value.pick === "" && !optionalLabel ? undefined : value.pick}
            onValueChange={(v) => onChange({ pick: v, newName: v === NEW_PLACE ? value.newName : "" })}
            options={options}
            placeholder={companyId == null ? "Choose the company first" : "Where it is"}
            disabled={companyId == null}
          />
        </FormField>
      )}
      {typing && (
        <FormField
          htmlFor={`${id}-new`} label="New place name" required={required || value.pick === NEW_PLACE}
          helperText={noPlaces ? "This company has no place yet; it is added with this record." : "Added with this record (an existing place of that name is used)."}
        >
          <Input
            id={`${id}-new`} aria-label="New place name" value={value.newName}
            onChange={(e) => onChange({ pick: NEW_PLACE, newName: e.target.value })}
          />
        </FormField>
      )}
    </>
  );
}
