interface ScreenPlaceholderProps {
  name: string;
  description?: string;
}

export function ScreenPlaceholder({ name, description }: ScreenPlaceholderProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="rounded-xl border border-border bg-background-secondary p-12 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
        {description && <p className="mt-2 text-foreground-secondary">{description}</p>}
        <p className="mt-4 text-sm text-foreground-secondary">
          Em construção. Aguardando implementação.
        </p>
      </div>
    </div>
  );
}
