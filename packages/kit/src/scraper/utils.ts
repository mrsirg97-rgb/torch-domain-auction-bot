export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const formatUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

export const fqdn = (name: string, tld: string): string => `${name}.${tld}`
