import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[200px_1fr] items-center gap-3">
      <span className="text-muted">{label}</span>
      <div>
        {children}
        {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
      </div>
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded border border-line bg-panel-2 px-2 py-1.5 outline-none focus:border-accent ${props.className ?? ''}`}
    />
  )
}

export function Button({
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' }) {
  const style = variant === 'primary' ? 'bg-accent text-white hover:brightness-110' : 'bg-panel-2 hover:bg-line'
  return (
    <button
      {...props}
      className={`rounded px-3 py-1.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${style} ${props.className ?? ''}`}
    />
  )
}

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: ReactNode }) {
  const color = kind === 'ok' ? 'text-accent' : kind === 'error' ? 'text-danger' : 'text-muted'
  return <div className={`text-sm ${color}`}>{children}</div>
}
