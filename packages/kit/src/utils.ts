import { LAMPORTS_PER_SOL } from '@solana/web3.js'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const sol = (lamports: number): string => (lamports / LAMPORTS_PER_SOL).toFixed(4)

export const bpsToPercent = (bps: number): string => (bps / 100).toFixed(2) + '%'

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

// base58 decoder — avoids ESM-only bs58 dependency
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export const decodeBase58 = (s: string): Uint8Array => {
  const result: number[] = []
  for (let i = 0; i < s.length; i++) {
    let carry = B58.indexOf(s[i])
    if (carry < 0) throw new Error(`invalid base58 character: ${s[i]}`)
    for (let j = 0; j < result.length; j++) {
      carry += result[j] * 58
      result[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      result.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (let i = 0; i < s.length && s[i] === '1'; i++) {
    result.push(0)
  }
  return new Uint8Array(result.reverse())
}
