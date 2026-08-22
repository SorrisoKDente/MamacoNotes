import { useEffect, useState } from 'react'

export const MOBILE_QUERY = '(max-width: 1024px) and (pointer: coarse)'

export function isMobileNow(): boolean {
  return typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => isMobileNow())

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
