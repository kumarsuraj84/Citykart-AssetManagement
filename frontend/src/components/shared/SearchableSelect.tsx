import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Context shown after the label in muted text ("Laptop · IT Fixed Assets",
   * "CS6872 · Ankur Pahwa · Head Office"), so two similar names can be told
   * apart in the list. Also searchable. Built by src/lib/option-labels.ts. */
  detail?: string;
  /** Extra terms matched when searching (e.g. an Asset User's code/email) --
   * never displayed, only `label` is shown. Lets someone find "Ankur Pahwa"
   * by typing his code (CS6872) or email, not just his name. */
  keywords?: string[];
}

interface SearchableSelectProps {
  id?: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** When given (only pass it to someone allowed to create the record), the list
   * ends with a "+ <createLabel>" entry that stays visible while searching, so a
   * missing choice can be created right here instead of in another screen. */
  onCreateNew?: () => void;
  createLabel?: string;
}

/** The full text of an option, as read and searched ("label · detail"). */
function optionText(option: SearchableSelectOption): string {
  return option.detail ? `${option.label} · ${option.detail}` : option.label;
}

/**
 * A type-to-filter dropdown -- the same value/onValueChange contract as the
 * plain Radix `<Select>` this replaces, but with a search box, for every
 * dropdown whose option list is long enough that scrolling to find one by
 * hand is the actual problem (Company/Location/Category/Vendor/Brand/Cost
 * Centre/Asset User pickers, first rolled out to Add Asset, Purchase
 * Orders, Asset Movement, Print Labels, and Record PI).
 *
 * Built on the existing shadcn Command+Popover primitives (already vendored
 * in components/ui, unused elsewhere until now) rather than a new
 * dependency. cmdk's own fuzzy filter matches against each CommandItem's
 * `value` prop, which is intentionally the human-readable label here (what
 * someone actually types), while the real id keyed to the form is only
 * ever passed to `onValueChange` on selection.
 */
export function SearchableSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  disabled,
  className,
  "aria-label": ariaLabel,
  onCreateNew,
  createLabel = "Create new…",
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const selectedText = selected ? optionText(selected) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          // Only set when explicitly given -- an unconditional aria-label
          // would override the FormField <label htmlFor={id}> association
          // every existing caller already relies on for its accessible name.
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            // Matches SelectTrigger's own quiet-filled-field treatment (AM-14)
            // so a searchable field looks identical to an ordinary one at rest.
            "flex h-10 w-full items-center justify-between whitespace-nowrap rounded-sm border border-transparent bg-muted/50 px-3 py-2 text-sm font-normal shadow-none ring-offset-background hover:bg-muted focus-visible:bg-background focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="line-clamp-1 text-left" title={selectedText}>
            {selected ? (
              <>
                {selected.label}
                {selected.detail && (
                  <>
                    {" "}
                    <span className="text-muted-foreground">· {selected.detail}</span>
                  </>
                )}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={optionText(option)}
                  keywords={option.keywords}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("h-4 w-4", option.value === value ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span>
                    {option.label}
                    {option.detail && (
                      <>
                        {" "}
                        <span className="text-muted-foreground">· {option.detail}</span>
                      </>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreateNew && (
              <CommandGroup>
                <CommandItem
                  forceMount
                  value={`__create__ ${createLabel}`}
                  onSelect={() => {
                    setOpen(false);
                    onCreateNew();
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {createLabel}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
