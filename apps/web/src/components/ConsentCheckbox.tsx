// A consent checkbox that shows which version of the text is being accepted.
// The server records the version itself (CONSENT_VERSIONS); the client never sends one.
export function ConsentCheckbox({
  name,
  version,
  required,
  children,
}: {
  name: string;
  version: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" name={name} required={required} />
      <span>
        {children} <span className="hint">(версія {version})</span>
      </span>
    </label>
  );
}
