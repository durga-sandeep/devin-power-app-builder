import type { ReactNode } from "react";

type Base = {
  label: string;
  name: string;
  required?: boolean;
  hint?: string;
  error?: string;
  defaultValue?: string | number;
};

type Props = Base &
  (
    | { type?: "text" | "number" | "email"; placeholder?: string; step?: string; min?: string }
    | { type: "textarea"; placeholder?: string; rows?: number }
    | { type: "select"; options: { value: string; label: string }[] }
  );

const inputClass =
  "block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none";

/** Label + control + hint/error. Server-rendered; works with plain <form action>. */
export function FormField(props: Props) {
  const { label, name, required, hint, error, defaultValue } = props;
  let control: ReactNode;
  if (props.type === "textarea") {
    control = (
      <textarea
        id={name}
        name={name}
        required={required}
        rows={props.rows ?? 3}
        placeholder={props.placeholder}
        defaultValue={defaultValue}
        className={inputClass}
      />
    );
  } else if (props.type === "select") {
    control = (
      <select id={name} name={name} required={required} defaultValue={defaultValue} className={inputClass}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        id={name}
        name={name}
        type={props.type ?? "text"}
        required={required}
        placeholder={props.placeholder}
        step={props.step}
        min={props.min}
        defaultValue={defaultValue}
        className={inputClass}
      />
    );
  }
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {control}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
