export function Spinner({ className }: { className?: string }) {
  return <span className={`spinner ${className ?? ''}`} aria-hidden="true" />
}
