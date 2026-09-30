export function SupplierIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7" />
      <circle cx="7" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
    </svg>
  );
}

export function SupplierBadge({
  name,
  className = '',
  variant = 'badge',
  title,
}: {
  name: string;
  className?: string;
  variant?: 'badge' | 'chip';
  title?: string;
}) {
  const baseClass = variant === 'chip' ? 'chip supplier-chip' : 'badge badge-supplier';
  return (
    <span
      className={className ? `${baseClass} ${className}` : baseClass}
      title={title ?? `تأمین‌کننده: ${name}`}
    >
      <SupplierIcon />
      <span>{name}</span>
    </span>
  );
}
