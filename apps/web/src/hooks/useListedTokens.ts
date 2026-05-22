import { ERC20Token } from '@pancakeswap/sdk'
import { WrappedTokenInfo } from '@pancakeswap/token-lists'
import { useMemo } from 'react'
import useSWR from 'swr'
import { useActiveChainId } from './useActiveChainId'

type ListedTokenInfo = {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
}

const fetchListedTokens = async () => {
  const response = await fetch('/api/token-listing/list')
  if (!response.ok) {
    throw new Error('Unable to fetch listed tokens')
  }
  return response.json() as Promise<{ tokens: ListedTokenInfo[] }>
}

export const useListedTokens = (): { [address: string]: ERC20Token } => {
  const { chainId } = useActiveChainId()
  const { data } = useSWR('tokenListingList', fetchListedTokens, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  return useMemo(
    () =>
      (data?.tokens ?? [])
        .filter((token) => token.chainId === chainId)
        .reduce<{ [address: string]: ERC20Token }>((tokens, token) => {
          const wrappedToken = new WrappedTokenInfo(token)
          return {
            ...tokens,
            [wrappedToken.address]: wrappedToken,
          }
        }, {}),
    [chainId, data?.tokens],
  )
}
