import { Field, Input, Textarea } from "./ui";
import type { FieldDef, Profile, ProfileField } from "../lib/profile";

export function ProfileFields({
  fields, values, onChange,
}: { fields: FieldDef[]; values: Partial<Profile>; onChange: (key: ProfileField, value: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
          <Field label={f.label}>
            {f.type === "textarea" ? (
              <Textarea value={values[f.key] ?? ""} placeholder={f.placeholder} maxLength={1000} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : (
              <Input type={f.type ?? "text"} value={values[f.key] ?? ""} placeholder={f.placeholder} maxLength={120} onChange={(e) => onChange(f.key, e.target.value)} />
            )}
          </Field>
        </div>
      ))}
    </div>
  );
}
