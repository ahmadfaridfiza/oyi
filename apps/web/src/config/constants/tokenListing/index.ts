import { ChainId } from '@pancakeswap/sdk'

export const TOKEN_LISTING_CHAIN_ID = ChainId.BSC
export const TOKEN_LISTING_FEE = '10'
export const TOKEN_LISTING_MIN_LIQUIDITY_USD = 100

export const TOKEN_LISTING_FACTORY_ADDRESS = '0x709e3C6b22993189327a8CFebD572b6cc459fe40'
export const TOKEN_LISTING_RPC_URL = process.env.NEXT_PUBLIC_NODE_PRODUCTION || 'https://polygon.drpc.org'

export const TOKEN_LISTING_PLAX_ADDRESS = '0x328801B0b580eAdd83eA841638865eA41Dc6fb25'
export const TOKEN_LISTING_REFERENCE_TOKENS = [
  {
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    symbol: 'USDT',
    decimals: 6,
    priceUsd: 1,
  },
  {
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    symbol: 'USDC',
    decimals: 6,
    priceUsd: 1,
  },
  {
    address: TOKEN_LISTING_PLAX_ADDRESS,
    symbol: 'PLAX',
    decimals: 18,
  },
]
