import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  title: ReactNode
  /** Shown beside the title while the section is folded, so a folded section still says what is in it. */
  summary?: ReactNode
  /** Open until the user folds it; `null` follows `auto` (for example: open while something needs a look). */
  auto: boolean
  children: ReactNode
}

/** A page section whose heading folds it, so the Activity log moves up. The user's choice wins over `auto` until the page changes folder. */
export function Fold({ title, summary, auto, children }: Props) {
  const [chosen, setChosen] = useState<boolean | null>(null)
  const open = chosen ?? auto
  return (
    <div className={`section fold ${open ? 'open' : ''}`}>
      <h2>
        <button className="plain fold-head" aria-expanded={open} onClick={() => setChosen(!open)}>
          <Icon name="chev" className="ico chev" />
          {title}
        </button>
        {!open && summary !== undefined && <span className="fold-sum">{summary}</span>}
      </h2>
      {open && children}
    </div>
  )
}
