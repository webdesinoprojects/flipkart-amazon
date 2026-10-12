"use client";

import {
  describeOutputLayout,
  describeOutputVolume,
  OUTPUT_LAYOUTS,
  type OutputLayout,
} from "@label-normalizer/core";
import { LoaderCircle, Printer, Rows2 } from "lucide-react";
import type { ComponentType } from "react";

const ICONS: Readonly<Record<OutputLayout, ComponentType<{ size?: number }>>> =
  {
    label_100x150: Printer,
    a4_4up: Rows2,
  };

/**
 * Output layout picker.
 *
 * Built from native radio inputs inside a `fieldset`, which gives grouped
 * labelling, arrow-key movement, and `:checked` styling for free. A browser
 * `<select>` is deliberately avoided, and no dependency is added for a control
 * this small.
 */
export function OutputLayoutChoice({
  value,
  labelCount,
  status,
  errorMessage,
  onChange,
  onRetry,
}: {
  readonly value: OutputLayout;
  readonly labelCount: number;
  readonly status: "idle" | "generating" | "ready" | "failed";
  readonly errorMessage: string | null;
  readonly onChange: (layout: OutputLayout) => void;
  readonly onRetry: () => void;
}) {
  const generating = status === "generating";

  // The fieldset is never disabled: switching mid-generation must stay
  // possible, and the controller discards the superseded result.
  return (
    <fieldset className="output-layout">
      <legend className="eyebrow">OUTPUT LAYOUT</legend>
      <div className="output-layout-options">
        {OUTPUT_LAYOUTS.map((layout) => {
          const descriptor = describeOutputLayout(layout);
          const Icon = ICONS[layout];
          const inputId = `output-layout-${layout}`;
          return (
            <div className="output-layout-option" key={layout}>
              <input
                checked={value === layout}
                id={inputId}
                name="output-layout"
                onChange={() => onChange(layout)}
                type="radio"
                value={layout}
              />
              <label htmlFor={inputId}>
                <Icon aria-hidden="true" size={14} />
                <span className="output-layout-name">
                  {descriptor.shortLabel}
                </span>
                <span className="output-layout-hint">
                  {descriptor.description}
                </span>
              </label>
            </div>
          );
        })}
      </div>

      <p className="output-layout-volume" data-status={status} role="status">
        {generating ? (
          <>
            <LoaderCircle aria-hidden="true" className="spin" size={13} />
            {`GENERATING ${describeOutputLayout(value).shortLabel} OUTPUT`}
          </>
        ) : (
          describeOutputVolume(labelCount, value)
        )}
      </p>

      {status === "failed" && (
        <p className="output-layout-error" role="alert">
          {errorMessage ??
            "That output layout could not be generated. Try again."}
          <button onClick={onRetry} type="button">
            RETRY
          </button>
        </p>
      )}
    </fieldset>
  );
}
