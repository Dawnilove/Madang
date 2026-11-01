/**
 * Landing logo, drawn straight on the page in every theme: the roof takes the theme's primary color
 * (terracotta in the Madang themes, lime in lime-dark) and the prompt takes its text color.
 */
export function MadangMark({ alt }: { alt: string }): React.JSX.Element {
  return (
    <svg viewBox="20 44 216 152" role="img" aria-label={alt} className="h-20 w-auto">
      <g fill="none" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M32 96 C60 106 98 86 128 58 C158 86 196 106 224 96"
          style={{ stroke: 'var(--primary)' }}
        />
        <path d="M84 132 L112 156 L84 180" style={{ stroke: 'var(--foreground)' }} />
      </g>
      <rect x="124" y="168" width="48" height="16" rx="8" fill="#4C8C4A" />
    </svg>
  )
}
