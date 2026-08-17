// A multi-select variant of the design system's `.seg` control (its native
// markup uses radio inputs; phases need independent toggles, so this swaps in
// checkboxes under the same `.seg`/`.seg-opt` classes).
export function SegMulti<T extends string>({
  options,
  value,
  onChange,
  name,
}: {
  options: { id: T; label: string }[];
  value: T[];
  onChange: (next: T[]) => void;
  name: string;
}) {
  function toggle(id: T) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div className="seg" role="group" aria-label={name}>
      {options.map((opt) => (
        <label key={opt.id} className="seg-opt">
          <input
            type="checkbox"
            checked={value.includes(opt.id)}
            onChange={() => toggle(opt.id)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
