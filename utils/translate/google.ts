import type { TranslateResponse } from './types'

export async function translateGoogle(
  text: string,
  targetLang: string
): Promise<TranslateResponse> {
  const url = 'https://translate.googleapis.com/translate_a/single'
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'auto',
    tl: targetLang,
    dt: 't',
    q: text,
  })

  const res = await fetch(`${url}?${params}`)
  if (!res.ok) throw new Error(`Google Translate error: ${res.status}`)

  const data = await res.json()
  const sentences: string[] = []
  for (const part of data[0]) {
    if (part[0]) sentences.push(part[0])
  }

  return {
    text: sentences.join(''),
    from: data[2] || 'auto',
  }
}
