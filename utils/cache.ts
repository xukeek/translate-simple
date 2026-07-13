interface CacheEntry {
  result: string
  timestamp: number
}

export class TranslationCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private ttl: number

  constructor(maxSize = 500, ttl = 1000 * 60 * 60) {
    this.maxSize = maxSize
    this.ttl = ttl
  }

  private key(text: string, sourceLang: string, targetLang: string, engine: string): string {
    return `${engine}:${sourceLang}:${targetLang}:${text}`
  }

  get(text: string, sourceLang: string, targetLang: string, engine: string): string | null {
    const key = this.key(text, sourceLang, targetLang, engine)
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }
    return entry.result
  }

  set(text: string, sourceLang: string, targetLang: string, engine: string, result: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    const key = this.key(text, sourceLang, targetLang, engine)
    this.cache.set(key, { result, timestamp: Date.now() })
  }
}
