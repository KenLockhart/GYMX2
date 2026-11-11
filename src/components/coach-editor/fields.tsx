"use client";

import { useId, useState, type ReactNode } from "react";
import { T, useTr } from "@/i18n/t";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">
        <T>{label}</T>
      </label>
      {children}
      {hint && (
        <p className="text-xs text-muted">
          <T>{hint}</T>
        </p>
      )}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  max,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="field-input"
      />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  max,
  rows = 4,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  rows?: number;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={
        <span className="flex justify-between gap-3">
          <span>
            <T>{hint}</T>
          </span>
          <span className="tabular-nums">
            {value.length}/{max}
          </span>
        </span>
      }
    >
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="field-input"
      />
    </Field>
  );
}

// Short tags typed one at a time: Enter or comma adds, × removes.
export function ChipInput({
  label,
  values,
  onChange,
  max,
  maxLength,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  maxLength: number;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const tr = useTr();
  const id = useId();
  const [draft, setDraft] = useState("");
  function add() {
    const value = draft.trim().slice(0, maxLength);
    if (!value || values.includes(value) || values.length >= max) return;
    onChange([...values, value]);
    setDraft("");
  }
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={
        <>
          <T>{hint}</T> {values.length}/{max}
        </>
      }
    >
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {values.map((value) => (
            <li
              key={value}
              className="flex items-center gap-1 rounded-full border border-border bg-surface-raised py-1 pl-3 pr-1 text-sm"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                aria-label={tr("Remove {value}", { value })}
                className="grid size-6 cursor-pointer place-items-center rounded-full text-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {values.length < max && (
        <div className="flex gap-2">
          <input
            id={id}
            value={draft}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                add();
              }
            }}
            className="field-input"
          />
          <button
            type="button"
            onClick={add}
            className="btn-secondary shrink-0 px-4"
          >
            <T>Add</T>
          </button>
        </div>
      )}
    </Field>
  );
}

export function CheckboxGroup<T extends string>({
  legend,
  options,
  values,
  onChange,
  hint,
  columns = 2,
}: {
  legend: string;
  options: readonly T[] | readonly { value: T; label: string }[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  hint?: ReactNode;
  columns?: 1 | 2;
}) {
  const items = options.map((option) =>
    typeof option === "string"
      ? { value: option as T, label: option as string }
      : option,
  );
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        <T>{legend}</T>
      </legend>
      {hint && (
        <p className="text-xs text-muted">
          <T>{hint}</T>
        </p>
      )}
      <div className={`grid gap-2 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
        {items.map((item) => {
          const checked = values.includes(item.value);
          return (
            <label
              key={item.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${checked ? "border-accent bg-accent/5" : "border-border hover:bg-surface-raised"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? values.filter((v) => v !== item.value)
                      : [...values, item.value],
                  )
                }
                className="accent-[var(--accent)]"
              />
              <T>{item.label}</T>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RadioCards<T extends string>({
  legend,
  options,
  value,
  onChange,
  hint,
}: {
  legend: string;
  options: readonly { value: T; label: string; description?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">
        <T>{legend}</T>
      </legend>
      {hint && (
        <p className="text-xs text-muted">
          <T>{hint}</T>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${checked ? "border-accent bg-accent/5" : "border-border hover:bg-surface-raised"}`}
            >
              <input
                type="radio"
                name={name}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">
                  <T>{option.label}</T>
                </span>
                {option.description && (
                  <span className="block text-xs text-muted">
                    <T>{option.description}</T>
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  options,
  onChange,
  emptyLabel,
  hint,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | null) => void;
  emptyLabel?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value ? (event.target.value as T) : null)
        }
        className="field-input"
      >
        {emptyLabel !== undefined && (
          <option value="">
            <T>{emptyLabel}</T>
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            <T>{option.label}</T>
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-border bg-surface-raised p-3 text-sm text-muted">
      {children}
    </p>
  );
}
