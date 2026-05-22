import type { NextApiHandler } from 'next'
import { Contract } from '@ethersproject/contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { getAddress } from '@ethersproject/address'
import { z } from 'zod'
import erc20Abi from 'config/abi/erc20.json'
import tokenDeployerAbi from 'config/abi/tokenDeployer.json'
import contracts from 'config/constants/contracts'
import {
  TOKEN_LISTING_CHAIN_ID,
  TOKEN_LISTING_FACTORY_ADDRESS,
  TOKEN_LISTING_FEE,
  TOKEN_LISTING_MIN_LIQUIDITY_USD,
  TOKEN_LISTING_PLAX_ADDRESS,
  TOKEN_LISTING_REFERENCE_TOKENS,
  TOKEN_LISTING_RPC_URL,
} from 'config/constants/tokenListing'

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]

const FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address pair)']
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const zCheckQuery = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
})

const provider = new JsonRpcProvider(TOKEN_LISTING_RPC_URL, TOKEN_LISTING_CHAIN_ID)

const getTokenMeta = async (tokenAddress: string) => {
  const tokenContract = new Contract(tokenAddress, erc20Abi, provider)
  const [name, symbol, decimals] = await Promise.all([
    tokenContract.name(),
    tokenContract.symbol(),
    tokenContract.decimals(),
  ])

  return {
    name: String(name),
    symbol: String(symbol),
    decimals: Number(decimals),
  }
}

const getPairLiquidityUSD = async (
  tokenAddress: string,
  referenceToken: (typeof TOKEN_LISTING_REFERENCE_TOKENS)[number],
  referenceTokenPriceUsd: number,
) => {
  const factory = new Contract(TOKEN_LISTING_FACTORY_ADDRESS, FACTORY_ABI, provider)
  const pairAddress = await factory.getPair(tokenAddress, referenceToken.address)

  if (!pairAddress || pairAddress === ZERO_ADDRESS) {
    return null
  }

  const pair = new Contract(pairAddress, PAIR_ABI, provider)
  const [token0, reserves] = await Promise.all([pair.token0(), pair.getReserves()])
  const referenceReserve =
    getAddress(token0) === getAddress(referenceToken.address) ? reserves.reserve0 ?? reserves[0] : reserves.reserve1 ?? reserves[1]
  const referenceAmount = Number(formatUnits(referenceReserve, referenceToken.decimals))
  const liquidityUSD = referenceAmount * referenceTokenPriceUsd * 2

  return {
    pairAddress,
    referenceToken: referenceToken.symbol,
    liquidityUSD,
  }
}

const getPlaxPriceUsd = async () => {
  const stableTokens = TOKEN_LISTING_REFERENCE_TOKENS.filter((token) => token.priceUsd)
  const factory = new Contract(TOKEN_LISTING_FACTORY_ADDRESS, FACTORY_ABI, provider)
  const priceChecks = await Promise.all(
    stableTokens.map(async (stableToken) => {
      const pairAddress = await factory.getPair(TOKEN_LISTING_PLAX_ADDRESS, stableToken.address)
      if (!pairAddress || pairAddress === ZERO_ADDRESS) return 0

      const pair = new Contract(pairAddress, PAIR_ABI, provider)
      const [token0, reserves] = await Promise.all([pair.token0(), pair.getReserves()])
      const plaxReserve =
        getAddress(token0) === getAddress(TOKEN_LISTING_PLAX_ADDRESS)
          ? reserves.reserve0 ?? reserves[0]
          : reserves.reserve1 ?? reserves[1]
      const stableReserve =
        getAddress(token0) === getAddress(stableToken.address) ? reserves.reserve0 ?? reserves[0] : reserves.reserve1 ?? reserves[1]
      const plaxAmount = Number(formatUnits(plaxReserve, 18))
      const stableAmount = Number(formatUnits(stableReserve, stableToken.decimals))

      return plaxAmount > 0 && stableAmount > 0 ? stableAmount / plaxAmount : 0
    }),
  )

  return priceChecks.find((price) => price > 0) ?? 0
}

export const getTokenListingFeeReceiver = async () => {
  if (process.env.TOKEN_LISTING_FEE_RECEIVER) {
    return getAddress(process.env.TOKEN_LISTING_FEE_RECEIVER)
  }

  const tokenDeployerAddress = contracts.tokenDeployer[TOKEN_LISTING_CHAIN_ID]
  if (!tokenDeployerAddress) {
    throw new Error('Token listing fee receiver is not configured')
  }

  const tokenDeployer = new Contract(tokenDeployerAddress, tokenDeployerAbi, provider)
  return getAddress(await tokenDeployer.feeReceiver())
}

export const checkTokenLiquidity = async (tokenAddress: string) => {
  const checksumAddress = getAddress(tokenAddress)
  const plaxPriceUsd = await getPlaxPriceUsd()
  const checks = await Promise.all(
    TOKEN_LISTING_REFERENCE_TOKENS.map((referenceToken) =>
      getPairLiquidityUSD(
        checksumAddress,
        referenceToken,
        referenceToken.priceUsd ?? (referenceToken.symbol === 'PLAX' ? plaxPriceUsd : 0),
      ),
    ),
  )
  const sortedLiquidity = checks
    .filter(Boolean)
    .sort((a, b) => b.liquidityUSD - a.liquidityUSD)
  const bestLiquidity = sortedLiquidity[0]

  return {
    liquidityUSD: bestLiquidity?.liquidityUSD ?? 0,
    pairAddress: bestLiquidity?.pairAddress,
    referenceToken: bestLiquidity?.referenceToken,
    hasEnoughLiquidity: (bestLiquidity?.liquidityUSD ?? 0) >= TOKEN_LISTING_MIN_LIQUIDITY_USD,
  }
}

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const parsed = zCheckQuery.safeParse(req.query)
  if (parsed.success === false) {
    return res.status(400).json({ error: 'Invalid token address', details: parsed.error.flatten() })
  }

  try {
    const tokenAddress = getAddress(parsed.data.address)
    const [token, liquidity, feeReceiver] = await Promise.all([
      getTokenMeta(tokenAddress),
      checkTokenLiquidity(tokenAddress),
      getTokenListingFeeReceiver(),
    ])

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      chainId: TOKEN_LISTING_CHAIN_ID,
      address: tokenAddress,
      ...token,
      ...liquidity,
      minLiquidityUSD: TOKEN_LISTING_MIN_LIQUIDITY_USD,
      listingFee: parseUnits(TOKEN_LISTING_FEE, 18).toString(),
      feeReceiver,
      feeToken: TOKEN_LISTING_PLAX_ADDRESS,
    })
  } catch (error) {
    console.error(error)
    return res.status(400).json({ error: 'Unable to check token liquidity' })
  }
}

export default handler
