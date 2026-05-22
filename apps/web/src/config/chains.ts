import { ChainId } from '@pancakeswap/sdk'
import memoize from 'lodash/memoize'
import invert from 'lodash/invert'

export const CHAIN_QUERY_NAME = {
  [ChainId.ETHEREUM]: 'eth',
  [ChainId.GOERLI]: 'goerli',
  56: 'bnb',
  [ChainId.BSC]: '',
  [ChainId.BSC_TESTNET]: 'polygonMumbai',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  25: 'cronos',
  534352: 'scroll',
  43114: 'avalanche',
  999: 'hyperliquid',
  59144: 'linea',
  1329: 'sei',
  146: 'sonic',
} satisfies Record<number, string>

const CHAIN_QUERY_NAME_TO_ID = invert(CHAIN_QUERY_NAME)

export const getChainId = memoize((chainName: string) => {
  if (!chainName) return undefined
  return CHAIN_QUERY_NAME_TO_ID[chainName] ? +CHAIN_QUERY_NAME_TO_ID[chainName] : undefined
})
