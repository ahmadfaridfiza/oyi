export const LIFI_NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'
export const BRIDGE_INTEGRATOR = 'plaxswap'

export type BridgeChain = {
  id: number
  name: string
  shortName: string
  rpcUrls: string[]
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  blockExplorerUrls: string[]
}

export type BridgeToken = {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  isNative?: boolean
}

export const BRIDGE_CHAINS: BridgeChain[] = [
  {
    id: 137,
    name: 'Polygon',
    shortName: 'Polygon',
    rpcUrls: ['https://polygon-rpc.com'],
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  {
    id: 56,
    name: 'BNB Chain',
    shortName: 'BNB',
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    blockExplorerUrls: ['https://bscscan.com'],
  },
  {
    id: 1,
    name: 'Ethereum',
    shortName: 'ETH',
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
  },
  {
    id: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://arbiscan.io'],
  },
  {
    id: 10,
    name: 'Optimism',
    shortName: 'Optimism',
    rpcUrls: ['https://mainnet.optimism.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
  },
]

export const BRIDGE_TOKENS: BridgeToken[] = [
  {
    chainId: 137,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'POL',
    name: 'Polygon',
    decimals: 18,
    isNative: true,
  },
  {
    chainId: 137,
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: 137,
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: 137,
    address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
  },
  {
    chainId: 137,
    address: '0x328801B0b580eAdd83eA841638865eA41Dc6fb25',
    symbol: 'PLAX',
    name: 'Plax',
    decimals: 18,
  },
  {
    chainId: 56,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    isNative: true,
  },
  {
    chainId: 56,
    address: '0x55d398326f99059fF775485246999027B3197955',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 18,
  },
  {
    chainId: 56,
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 18,
  },
  {
    chainId: 1,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
  },
  {
    chainId: 1,
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: 1,
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: 1,
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
  },
  {
    chainId: 42161,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
  },
  {
    chainId: 42161,
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: 42161,
    address: '0xFd086bC7CD5C481DCC9C85ebe4786C9FCbb9eC',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  {
    chainId: 10,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
  },
  {
    chainId: 10,
    address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  {
    chainId: 10,
    address: '0x94b008aD8eF4d2B506B72dBF1D0FFf4288aD877',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
]

export const getBridgeTokens = (chainId: number) => BRIDGE_TOKENS.filter((token) => token.chainId === chainId)

export const getBridgeChain = (chainId: number) => BRIDGE_CHAINS.find((chain) => chain.id === chainId)
