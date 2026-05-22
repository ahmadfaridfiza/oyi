export const LIFI_NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

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
  logoURI?: string
}

const TOKEN_LOGOS = {
  eth: '/images/chains/1.png',
  avax:
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/assets/0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7/logo.png',
  cro: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/cronos/info/logo.png',
  hype: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/hyperliquid/info/logo.png',
  sei: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sei/info/logo.png',
  sonic: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/sonic/info/logo.png',
  usdc: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  usdt: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  dai: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png',
  arb: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/assets/0x912CE59144191C1204E64559FE8253a0e49E6548/logo.png',
  op: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/assets/0x4200000000000000000000000000000000000042/logo.png',
}

export const BRIDGE_CHAINS: BridgeChain[] = [
  {
    id: 137,
    name: 'Polygon',
    shortName: 'Polygon',
    rpcUrls: ['https://polygon.drpc.org'],
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  {
    id: 56,
    name: 'BNB Chain',
    shortName: 'BNB',
    rpcUrls: ['https://bsc-dataseed.bnbchain.org'],
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
  {
    id: 8453,
    name: 'Base',
    shortName: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org'],
  },
  {
    id: 25,
    name: 'Cronos Mainnet',
    shortName: 'Cronos',
    rpcUrls: ['https://evm.cronos.org'],
    nativeCurrency: { name: 'Cronos', symbol: 'CRO', decimals: 18 },
    blockExplorerUrls: ['https://explorer.cronos.org'],
  },
  {
    id: 534352,
    name: 'Scroll',
    shortName: 'Scroll',
    rpcUrls: ['https://rpc.scroll.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://scrollscan.com'],
  },
  {
    id: 43114,
    name: 'Avalanche',
    shortName: 'Avalanche',
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    blockExplorerUrls: ['https://snowtrace.io'],
  },
  {
    id: 999,
    name: 'HyperEVM',
    shortName: 'Hyperliquid',
    rpcUrls: ['https://rpc.hyperliquid.xyz/evm'],
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    blockExplorerUrls: ['https://hyperevmscan.io'],
  },
  {
    id: 59144,
    name: 'Linea Mainnet',
    shortName: 'Linea',
    rpcUrls: ['https://rpc.linea.build'],
    nativeCurrency: { name: 'Linea Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://lineascan.build'],
  },
  {
    id: 1329,
    name: 'Sei Network',
    shortName: 'Sei',
    rpcUrls: ['https://evm-rpc.sei-apis.com'],
    nativeCurrency: { name: 'Sei', symbol: 'SEI', decimals: 18 },
    blockExplorerUrls: ['https://seiscan.io'],
  },
  {
    id: 146,
    name: 'Sonic',
    shortName: 'Sonic',
    rpcUrls: ['https://rpc.soniclabs.com'],
    nativeCurrency: { name: 'Sonic', symbol: 'S', decimals: 18 },
    blockExplorerUrls: ['https://sonicscan.org'],
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
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 56,
    address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 18,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 1,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.eth,
  },
  {
    chainId: 1,
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 1,
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 1,
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    logoURI: TOKEN_LOGOS.dai,
  },
  {
    chainId: 42161,
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    symbol: 'ARB',
    name: 'Arbitrum',
    decimals: 18,
    logoURI: TOKEN_LOGOS.arb,
  },
  {
    chainId: 42161,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.eth,
  },
  {
    chainId: 42161,
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 42161,
    address: '0xFd086bC7CD5C481DCC9C85ebe4786C9FCbb9eC',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 10,
    address: '0x4200000000000000000000000000000000000042',
    symbol: 'OP',
    name: 'Optimism',
    decimals: 18,
    logoURI: TOKEN_LOGOS.op,
  },
  {
    chainId: 10,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.eth,
  },
  {
    chainId: 10,
    address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 10,
    address: '0x94b008aD8eF4d2B506B72dBF1D0FFf4288aD877',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 8453,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.eth,
  },
  {
    chainId: 8453,
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 8453,
    address: '0xfde4C96c8593536E31f229EA8f37b2ADa2699bb2',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 25,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'CRO',
    name: 'Cronos',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.cro,
  },
  {
    chainId: 25,
    address: '0xc21223249CA28397B4B6541dfFaEc539BfF0c59',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 25,
    address: '0x66e428c3f67a68878562e79A0234c1F83c208770',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 534352,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.eth,
  },
  {
    chainId: 43114,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'AVAX',
    name: 'Avalanche',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.avax,
  },
  {
    chainId: 43114,
    address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 43114,
    address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 999,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'HYPE',
    name: 'HYPE',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.hype,
  },
  {
    chainId: 59144,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.eth,
  },
  {
    chainId: 59144,
    address: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdc,
  },
  {
    chainId: 59144,
    address: '0xA219439258ca9da29E9Cc4cE5596924745e12B93',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: TOKEN_LOGOS.usdt,
  },
  {
    chainId: 1329,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'SEI',
    name: 'Sei',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.sei,
  },
  {
    chainId: 146,
    address: LIFI_NATIVE_TOKEN_ADDRESS,
    symbol: 'S',
    name: 'Sonic',
    decimals: 18,
    isNative: true,
    logoURI: TOKEN_LOGOS.sonic,
  },
]

export const getBridgeTokens = (chainId: number) => BRIDGE_TOKENS.filter((token) => token.chainId === chainId)

export const getBridgeChain = (chainId: number) => BRIDGE_CHAINS.find((chain) => chain.id === chainId)

export const WAGMI_BRIDGE_CHAINS = BRIDGE_CHAINS.map((chain) => ({
  id: chain.id,
  name: chain.name,
  nativeCurrency: chain.nativeCurrency,
  rpcUrls: {
    default: {
      http: chain.rpcUrls,
    },
    public: {
      http: chain.rpcUrls,
    },
  },
  blockExplorers: {
    default: {
      name: `${chain.name} Explorer`,
      url: chain.blockExplorerUrls[0],
    },
  },
  contracts: {},
  testnet: false,
}))
