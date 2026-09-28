import { useEffect, useState } from 'react'
import { Icon } from './Icon'

export function CopyPromptButton({ text, className = 'btn' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    await window.autosync.copyText(text)
    setCopied(true)
  }

  return (
    <button className={className} onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} />
      {copied ? 'Copied — paste into AI' : 'Copy AI prompt'}
    </button>
  )
}
