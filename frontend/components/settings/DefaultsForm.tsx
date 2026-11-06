"use client";

/**
 * DefaultsForm — operator-tuned defaults the Dashboard "Create accounts"
 * CTA reads before showing its dialog.
 *
 * Persisted shape in localStorage['adspower-defaults']:
 *
 *   {
 *     "name_prefix":   "TikTok Acc",
 *     "birth_year":    1998,
 *     "rotate_between": true
 *   }
 *
 * Fields mirror the backend `CreateAccountsRequest` payload (see
 * `lib/types.ts`), so the Dashboard can spread this object straight into
 * its mutation body with only `proxy_ids` supplied at call time.
 *
 * Why localStorage and not a backend endpoint:
 *   - Single-operator tool (DESIGN_SPEC § Non-goals: "no auth / multi-user").
 *   - The agent lives on the operator's machine; the defaults are a
 *     per-browser preference, not server-side state.
 *   - Keeps the backend .env the single source of truth for secrets and
 *     this form the single source of truth for UX defaults.
 *
 * Validation rules:
 *   - name_prefix: non-empty after trim, at most 48 characters so the
 *     derived profile name ("TikTok Acc #42") stays in AdsPower's
 *     display width.
 *   - birth_year: integer in [1970, currentYear - 18] — matches TikTok's
 *     age gate.
 *   - rotate_between: boolean, no constraint.
 *
 * Save writes a canonical, normalized object; a bad field blocks Save
 * and highlights the offending input via `aria-invalid`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";

export const DEFAULTS_STORAGE_KEY = "adspower-defaults";

const DEFAULT_NAME_PREFIX = "TikTok Acc";
const DEFAULT_ROTATE_BETWEEN = true;
const NAME_PREFIX_MAX = 48;
const MIN_BIRTH_YEAR = 1970;

/**
 * Pick the tightest reasonable birth year. 18 years back from the
 * current year — matches TikTok's minimum signup age. Computed on the
 * client so the UI stays correct as the year rolls over, with a safe
 * fallback to the DESIGN-SPEC reference year (1998) when a very old
 * runtime refuses `Date.now()`.
 */
function getDefaultBirthYear(): number {
  try {
    return new Date().getFullYear() - 18;
  } catch {
    return 1998;
  }
}

export interface OperatorDefaults {
  name_prefix: string;
  birth_year: number;
  rotate_between: boolean;
}

function readDefaults(): OperatorDefaults {
  const fallback: OperatorDefaults = {
    name_prefix: DEFAULT_NAME_PREFIX,
    birth_year: getDefaultBirthYear(),
    rotate_between: DEFAULT_ROTATE_BETWEEN,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(DEFAULTS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<OperatorDefaults> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      name_prefix:
        typeof parsed.name_prefix === "string" && parsed.name_prefix.trim()
          ? parsed.name_prefix.trim().slice(0, NAME_PREFIX_MAX)
          : fallback.name_prefix,
      birth_year:
        typeof parsed.birth_year === "number" &&
        Number.isFinite(parsed.birth_year)
          ? Math.round(parsed.birth_year)
          : fallback.birth_year,
      rotate_between:
        typeof parsed.rotate_between === "boolean"
          ? parsed.rotate_between
          : fallback.rotate_between,
    };
  } catch {
    return fallback;
  }
}

function writeDefaults(value: OperatorDefaults): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked — ignore (private window, strict CSP).
  }
}

interface FieldErrors {
  name_prefix: string | null;
  birth_year: string | null;
}

function validate(draft: {
  name_prefix: string;
  birth_year: string;
}): { errors: FieldErrors; parsedYear: number | null } {
  const trimmedName = draft.name_prefix.trim();
  const nameError =
    trimmedName.length === 0
      ? "Name prefix is required."
      : trimmedName.length > NAME_PREFIX_MAX
      ? `Keep the prefix under ${NAME_PREFIX_MAX} characters.`
      : null;

  const now = new Date().getFullYear();
  const maxYear = now - 18;
  const asNumber = Number.parseInt(draft.birth_year, 10);
  let yearError: string | null = null;
  let parsedYear: number | null = null;
  if (!Number.isFinite(asNumber)) {
    yearError = "Enter a 4-digit year.";
  } else if (asNumber < MIN_BIRTH_YEAR || asNumber > maxYear) {
    yearError = `Birth year must be between ${MIN_BIRTH_YEAR} and ${maxYear}.`;
  } else {
    parsedYear = asNumber;
  }

  return {
    errors: { name_prefix: nameError, birth_year: yearError },
    parsedYear,
  };
}

export function DefaultsForm() {
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState<OperatorDefaults>({
    name_prefix: DEFAULT_NAME_PREFIX,
    birth_year: getDefaultBirthYear(),
    rotate_between: DEFAULT_ROTATE_BETWEEN,
  });
  const [namePrefix, setNamePrefix] = useState<string>(DEFAULT_NAME_PREFIX);
  const [birthYear, setBirthYear] = useState<string>(
    String(getDefaultBirthYear()),
  );
  const [rotateBetween, setRotateBetween] = useState<boolean>(
    DEFAULT_ROTATE_BETWEEN,
  );
  const [justSaved, setJustSaved] = useState<boolean>(false);

  useEffect(() => {
    const current = readDefaults();
    setSaved(current);
    setNamePrefix(current.name_prefix);
    setBirthYear(String(current.birth_year));
    setRotateBetween(current.rotate_between);
    setHydrated(true);
  }, []);

  const { errors, parsedYear } = useMemo(
    () => validate({ name_prefix: namePrefix, birth_year: birthYear }),
    [birthYear, namePrefix],
  );

  const isDirty =
    hydrated &&
    (namePrefix.trim() !== saved.name_prefix ||
      String(saved.birth_year) !== birthYear.trim() ||
      rotateBetween !== saved.rotate_between);

  const canSave =
    hydrated &&
    !errors.name_prefix &&
    !errors.birth_year &&
    parsedYear !== null &&
    isDirty;

  const handleSave = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!canSave || parsedYear === null) return;
      const next: OperatorDefaults = {
        name_prefix: namePrefix.trim(),
        birth_year: parsedYear,
        rotate_between: rotateBetween,
      };
      writeDefaults(next);
      setSaved(next);
      setJustSaved(true);
    },
    [canSave, namePrefix, parsedYear, rotateBetween],
  );

  // Clear the "Saved" micro-copy on the next edit.
  useEffect(() => {
    if (!justSaved) return;
    if (isDirty) setJustSaved(false);
  }, [isDirty, justSaved]);

  const onNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setNamePrefix(e.target.value);
    setJustSaved(false);
  };
  const onYearChange = (e: ChangeEvent<HTMLInputElement>) => {
    setBirthYear(e.target.value);
    setJustSaved(false);
  };
  const onRotateChange = (e: ChangeEvent<HTMLInputElement>) => {
    setRotateBetween(e.target.checked);
    setJustSaved(false);
  };

  return (
    <form
      className="flex flex-col"
      style={{ gap: "16px" }}
      onSubmit={handleSave}
      noValidate
    >
      <Field
        htmlFor="defaults-name-prefix"
        label="Default name prefix"
        help={`Appended with "#N" to form profile names, e.g. "${
          namePrefix.trim() || DEFAULT_NAME_PREFIX
        } #42".`}
        error={errors.name_prefix}
      >
        <Input
          id="defaults-name-prefix"
          value={namePrefix}
          onChange={onNameChange}
          maxLength={NAME_PREFIX_MAX + 8}
          placeholder={DEFAULT_NAME_PREFIX}
          aria-invalid={errors.name_prefix ? true : undefined}
          aria-describedby="defaults-name-prefix-help"
        />
      </Field>

      <Field
        htmlFor="defaults-birth-year"
        label="Default birth year"
        help="Used to fill TikTok's age gate during signup. Must leave the account at least 18."
        error={errors.birth_year}
      >
        <div style={{ maxWidth: "180px" }}>
          <Input
            id="defaults-birth-year"
            variant="mono"
            inputMode="numeric"
            pattern="[0-9]*"
            value={birthYear}
            onChange={onYearChange}
            maxLength={4}
            placeholder={String(getDefaultBirthYear())}
            aria-invalid={errors.birth_year ? true : undefined}
            aria-describedby="defaults-birth-year-help"
          />
        </div>
      </Field>

      <Field
        htmlFor="defaults-rotate-between"
        label="Rotate proxies between accounts"
        help="When on, the run triggers each proxy's rotation URL before reusing it for the next account. Turn off for sticky-IP residential pools."
        error={null}
        // Checkbox is its own labelled control — no implicit label needed.
        renderLabel={false}
      >
        <Checkbox
          id="defaults-rotate-between"
          checked={rotateBetween}
          onChange={onRotateChange}
          label="Rotate between accounts by default"
        />
      </Field>

      <div className="flex items-center" style={{ gap: "12px" }}>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSave}
          aria-label="Save default run settings"
        >
          Save defaults
        </Button>
        {justSaved && !isDirty ? (
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: "12px",
              color: "var(--accent)",
              lineHeight: 1.4,
            }}
          >
            Saved — new runs will use these values.
          </span>
        ) : null}
      </div>
    </form>
  );
}

interface FieldProps {
  htmlFor: string;
  label: string;
  help: string;
  error: string | null;
  renderLabel?: boolean;
  children: ReactNode;
}

/**
 * Local layout primitive — keeps every row visually identical without
 * dragging in a shared FormField component the rest of the app doesn't
 * need yet.
 */
function Field({
  htmlFor,
  label,
  help,
  error,
  renderLabel = true,
  children,
}: FieldProps) {
  return (
    <div className="flex flex-col" style={{ gap: "6px" }}>
      {renderLabel ? (
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: "12px",
            lineHeight: 1.4,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          {label}
        </label>
      ) : null}
      {children}
      <p
        id={`${htmlFor}-help`}
        style={{
          fontSize: "12px",
          lineHeight: 1.4,
          color: error ? "var(--error)" : "var(--text-muted)",
          margin: 0,
          maxWidth: "72ch",
        }}
      >
        {error ?? help}
      </p>
    </div>
  );
}

export default DefaultsForm;
