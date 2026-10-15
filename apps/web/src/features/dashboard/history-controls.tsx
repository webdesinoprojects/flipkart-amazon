"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Check,
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useTransition } from "react";
import styles from "./dashboard.module.css";

const periodOptions = [
  ["all", "All time"],
  ["today", "Today"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
] as const;

const marketplaceOptions = [
  ["all", "All marketplaces"],
  ["flipkart", "Flipkart"],
  ["amazon", "Amazon"],
  ["meesho", "Meesho"],
  ["unknown", "Unknown / generic"],
] as const;

const sizeOptions = [
  ["all", "Any PDF size"],
  ["under_1mb", "Under 1 MB"],
  ["1_to_5mb", "1–5 MB"],
  ["over_5mb", "5 MB or larger"],
] as const;

const sortOptions = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["largest", "Largest PDF first"],
  ["smallest", "Smallest PDF first"],
  ["labels_desc", "Most labels first"],
] as const;

const limitOptions = [
  ["10", "10 per page"],
  ["20", "20 per page"],
  ["50", "50 per page"],
] as const;

export function HistoryControls({ total }: { readonly total: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    update(params);
    params.delete("offset");
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `/dashboard/history?${query}` : "/dashboard/history");
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get("q") ?? "").trim();
    navigate((params) => {
      if (query) params.set("q", query);
      else params.delete("q");
    });
  }

  const activeFilters = ["q", "period", "marketplace", "size", "sort"].some(
    (key) => searchParams.has(key),
  );

  return (
    <div className={styles.historyControls} data-pending={pending}>
      <form className={styles.historySearch} onSubmit={submitSearch}>
        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
        <input
          aria-label="Search saved batches"
          defaultValue={searchParams.get("q") ?? ""}
          key={searchParams.get("q") ?? ""}
          maxLength={80}
          name="q"
          placeholder="Search batch ID"
          type="search"
        />
        <button type="submit">SEARCH</button>
      </form>

      <div className={styles.historyFilters}>
        <SlidersHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
        <FilterMenu
          label="Range"
          options={periodOptions}
          value={searchParams.get("period") ?? "all"}
          onChange={(value) =>
            navigate((params) => setOptional(params, "period", value, "all"))
          }
        />
        <FilterMenu
          label="Marketplace"
          options={marketplaceOptions}
          value={searchParams.get("marketplace") ?? "all"}
          onChange={(value) =>
            navigate((params) =>
              setOptional(params, "marketplace", value, "all"),
            )
          }
        />
        <FilterMenu
          label="PDF size"
          options={sizeOptions}
          value={searchParams.get("size") ?? "all"}
          onChange={(value) =>
            navigate((params) => setOptional(params, "size", value, "all"))
          }
        />
        <FilterMenu
          label="Sort"
          options={sortOptions}
          value={searchParams.get("sort") ?? "newest"}
          onChange={(value) =>
            navigate((params) => setOptional(params, "sort", value, "newest"))
          }
        />
        <FilterMenu
          label="Rows"
          options={limitOptions}
          value={searchParams.get("limit") ?? "20"}
          onChange={(value) =>
            navigate((params) => setOptional(params, "limit", value, "20"))
          }
        />
        {activeFilters ? (
          <button
            className={styles.clearFilters}
            type="button"
            onClick={() =>
              startTransition(() => router.push("/dashboard/history"))
            }
          >
            <RotateCcw aria-hidden="true" size={13} /> RESET
          </button>
        ) : null}
        <span className={styles.historyResultCount}>
          {total.toLocaleString("en-IN")} RESULTS
        </span>
      </div>
    </div>
  );
}

function FilterMenu({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: ReadonlyArray<readonly [string, string]>;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const selected =
    options.find(([option]) => option === value)?.[1] ??
    options[0]?.[1] ??
    label;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={styles.filterTrigger}>
        <span>{label}</span>
        <strong>{selected}</strong>
        <ChevronDown aria-hidden="true" size={13} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className={styles.filterMenu}
          sideOffset={7}
        >
          <DropdownMenu.Label className={styles.filterMenuLabel}>
            {label.toUpperCase()}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map(([optionValue, optionLabel]) => (
              <DropdownMenu.RadioItem
                className={styles.filterMenuItem}
                key={optionValue}
                value={optionValue}
              >
                <span className={styles.filterMenuIndicator}>
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden="true" size={14} />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span>{optionLabel}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function setOptional(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
) {
  if (value === defaultValue) params.delete(key);
  else params.set(key, value);
}
