import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

// ── Button ─────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    'relative inline-flex items-center justify-center gap-2 font-semibold rounded-xl overflow-hidden transition-all duration-200 cursor-pointer select-none';

  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-gradient-to-r from-brand to-brand-light text-white shadow-lg hover:shadow-brand/30 hover:-translate-y-0.5 active:scale-95',
    secondary:
      'bg-gradient-to-b from-slate-100 to-slate-300 text-slate-900 hover:-translate-y-0.5 active:scale-95',
    ghost:
      'border border-white/20 text-slate-200 hover:bg-white/5 hover:-translate-y-0.5 active:scale-95',
    danger:
      'border border-red-500/40 text-red-300 hover:bg-red-500/10 hover:-translate-y-0.5 active:scale-95',
  };

  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3.5 text-base',
  };

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      {/* Shimmer overlay on hover */}
      <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-500 pointer-events-none" />
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ── Card ───────────────────────────────────────────────────────────
interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function Card({ children, className = '', hover = false, glow = false }: CardProps) {
  return (
    <div
      className={`
        relative bg-panel border border-white/[0.06] rounded-xl p-5 overflow-hidden
        ${hover ? 'transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/30' : ''}
        ${glow ? 'ring-1 ring-brand/20' : ''}
        ${className}
      `}
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none rounded-xl" />
      <div className="relative">{children}</div>
    </div>
  );
}

// ── FormField ──────────────────────────────────────────────────────
interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, error, hint, required, children, className = '' }: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-slate-300"
      >
        {label}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-400 animate-slide-up">{error}</p>
      )}
    </div>
  );
}

// ── Input ──────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error, className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={`
        w-full px-3 py-2.5 rounded-xl
        bg-[#0b1230] border text-slate-200 text-sm
        transition-all duration-200 placeholder:text-slate-600
        focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
        ${error ? 'border-red-500/60' : 'border-white/10 hover:border-white/20'}
        ${className}
      `}
    />
  );
}

// ── Select ─────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export function Select({ error, className = '', children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      className={`
        w-full px-3 py-2.5 rounded-xl
        bg-[#0b1230] border text-slate-200 text-sm
        transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
        ${error ? 'border-red-500/60' : 'border-white/10 hover:border-white/20'}
        ${className}
      `}
    >
      {children}
    </select>
  );
}

// ── Chip ───────────────────────────────────────────────────────────
interface ChipProps {
  label: string;
  onRemove?: () => void;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
}

const chipColors = {
  blue: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
  green: 'bg-green-500/10 border-green-500/20 text-green-300',
  amber: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
  red: 'bg-red-500/10 border-red-500/20 text-red-300',
  purple: 'bg-purple-500/10 border-purple-500/20 text-purple-300',
};

export function Chip({ label, onRemove, color = 'blue' }: ChipProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium animate-pop-in ${chipColors[color]}`}>
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 hover:text-white transition-colors rounded-full"
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

// ── Badge ──────────────────────────────────────────────────────────
export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'success' | 'warning' | 'error' }) {
  const v = {
    default: 'bg-slate-700/50 text-slate-300',
    success: 'bg-green-500/10 text-green-400',
    warning: 'bg-amber-500/10 text-amber-400',
    error: 'bg-red-500/10 text-red-400',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${v[variant]}`}>{children}</span>;
}

// ── SectionHeader ──────────────────────────────────────────────────
export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold bg-gradient-to-r from-brand to-brand-light bg-clip-text text-transparent">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

// ── EmptyState ─────────────────────────────────────────────────────
export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
      {icon && <div className="text-4xl text-slate-600">{icon}</div>}
      <p className="font-semibold text-slate-400">{title}</p>
      {description && <p className="text-sm text-slate-500 max-w-xs">{description}</p>}
    </div>
  );
}
