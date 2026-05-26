import { useMemo } from 'react'
import { Contract } from '@ethersproject/contracts'
import { useProviderOrSigner } from 'hooks/useProviderOrSigner'
import factoryAbi from 'config/abi/pancakeFactory.json'
import pairAbi from 'config/abi/pancakePair.json'
import erc20Abi from 'config/abi/erc20.json'
import { FACTORY_ADDRESS } from '@pancakeswap/sdk'
import useSWR from 'swr'

const BATCH_SIZE = 30

export type LpPairOption = { label: string; value: string }

async function fetchSinglePair(addr: string, provider: any): Promise<LpPairOption | null> {
  const NATIVE_LIKE = [
    '0x0000000000000000000000000000000000001010'.toLowerCase(),
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'.toLowerCase(),
  ]
  try {
    const pc = new Contract(addr, pairAbi as any, provider)
    const [token0Addr, token1Addr, totalSupplyBn]: [string, string, any] = await Promise.all([
      pc.token0(),
      pc.token1(),
      pc.totalSupply(),
    ])
    if (totalSupplyBn.isZero()) return null

    const t0c = new Contract(token0Addr, erc20Abi as any, provider)
    const t1c = new Contract(token1Addr, erc20Abi as any, provider)

    let s0 = 'TOKEN'
    let s1 = 'TOKEN'
    try {
      s0 = NATIVE_LIKE.includes(String(token0Addr).toLowerCase()) ? 'POL' : String(await t0c.symbol())
      s1 = NATIVE_LIKE.includes(String(token1Addr).toLowerCase()) ? 'POL' : String(await t1c.symbol())
    } catch {
      try {
        s0 = String(await t0c.symbol())
        s1 = String(await t1c.symbol())
      } catch {
        // keep TOKEN
      }
    }

    return { value: addr, label: `${s0}-${s1} LP (${s0} / ${s1})` }
  } catch {
    return null
  }
}

async function fetchAllPairs(factoryAddress: string, provider: any): Promise<LpPairOption[]> {
  const factory = new Contract(factoryAddress, factoryAbi as any, provider)
  const rawCount = await factory.allPairsLength()
  const count = Number(rawCount.toString())
  if (count === 0) return []

  const indexArray = Array.from({ length: count }, (_, i) => i)

  const pairAddresses: string[] = (
    await Promise.all(
      indexArray.map((i) =>
        factory.allPairs(i).catch(() => null),
      ),
    )
  ).filter((addr): addr is string => addr !== null)

  const results: LpPairOption[] = []
  const emptyArray = Array.from({ length: Math.ceil(pairAddresses.length / BATCH_SIZE) }, (_, i) => i)

  const batchResults = await Promise.all(
    emptyArray.map(async (batchIndex) => {
      const start = batchIndex * BATCH_SIZE
      const batch = pairAddresses.slice(start, start + BATCH_SIZE)
      return Promise.all(batch.map((addr) => fetchSinglePair(addr, provider)))
    }),
  )

  for (const batch of batchResults) {
    for (const r of batch) {
      if (r) results.push(r)
    }
  }

  results.sort((a, b) => {
    const aIsPlax = a.label.startsWith('PLAX') ? 0 : 1
    const bIsPlax = b.label.startsWith('PLAX') ? 0 : 1
    if (aIsPlax !== bIsPlax) return aIsPlax - bIsPlax
    return a.label.localeCompare(b.label)
  })

  return results
}

export function useAvailableLpPairs() {
  const provider = useProviderOrSigner(false)
  const factoryAddress = FACTORY_ADDRESS

  const { data: options = [], isValidating } = useSWR(
    provider && factoryAddress ? ['availableLpPairs', factoryAddress] : null,
    () => fetchAllPairs(factoryAddress, provider),
    { refreshInterval: 300000, revalidateOnFocus: false, dedupingInterval: 60000 },
  )

  return useMemo(() => ({ options, loading: isValidating }), [options, isValidating])
}
