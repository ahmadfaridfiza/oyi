import type { NextApiHandler } from 'next'
import { Contract } from '@ethersproject/contracts'
import { Interface } from '@ethersproject/abi'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { getAddress } from '@ethersproject/address'
import { z } from 'zod'
import erc20Abi from 'config/abi/erc20.json'
import {
  TOKEN_LISTING_CHAIN_ID,
  TOKEN_LISTING_FEE,
  TOKEN_LISTING_MIN_LIQUIDITY_USD,
  TOKEN_LISTING_PLAX_ADDRESS,
  TOKEN_LISTING_RPC_URL,
} from 'config/constants/tokenListing'
import { checkTokenLiquidity, getTokenListingFeeReceiver } from './check'
import { saveTokenLogo, writeListedToken } from '../../../utils/tokenListingStorage'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb',
    },
  },
}

const zSubmitBody = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  logoDataUrl: z.string().min(1),
})

const provider = new JsonRpcProvider(TOKEN_LISTING_RPC_URL, TOKEN_LISTING_CHAIN_ID)
const erc20Interface = new Interface(erc20Abi)

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

const verifyPayment = async (txHash: string) => {
  const [receipt, feeReceiver] = await Promise.all([provider.getTransactionReceipt(txHash), getTokenListingFeeReceiver()])

  if (!receipt || receipt.status !== 1) {
    throw new Error('Payment transaction is not confirmed')
  }

  const requiredFee = parseUnits(TOKEN_LISTING_FEE, 18)
  const transferLog = receipt.logs.find((log) => {
    if (getAddress(log.address) !== getAddress(TOKEN_LISTING_PLAX_ADDRESS)) return false

    try {
      const parsedLog = erc20Interface.parseLog(log)
      return (
        parsedLog.name === 'Transfer' &&
        getAddress(parsedLog.args.to) === feeReceiver &&
        parsedLog.args.value.gte(requiredFee)
      )
    } catch {
      return false
    }
  })

  if (!transferLog) {
    throw new Error(`Payment must transfer at least ${TOKEN_LISTING_FEE} PLAX to the listing fee receiver`)
  }
}

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const parsed = zSubmitBody.safeParse(req.body)
  if (parsed.success === false) {
    return res.status(400).json({ error: 'Invalid listing request', details: parsed.error.flatten() })
  }

  try {
    const address = getAddress(parsed.data.address)
    const [token, liquidity] = await Promise.all([getTokenMeta(address), checkTokenLiquidity(address)])

    if (!liquidity.hasEnoughLiquidity) {
      return res.status(400).json({
        error: 'Liquidity not enough',
        liquidityUSD: liquidity.liquidityUSD,
        minLiquidityUSD: TOKEN_LISTING_MIN_LIQUIDITY_USD,
      })
    }

    await verifyPayment(parsed.data.txHash)
    const logoURI = saveTokenLogo(address, parsed.data.logoDataUrl)

    const listedToken = {
      chainId: TOKEN_LISTING_CHAIN_ID,
      address,
      ...token,
      logoURI,
      listedAt: new Date().toISOString(),
      paymentTxHash: parsed.data.txHash,
      liquidityUSD: Number(liquidity.liquidityUSD.toFixed(2)),
    }

    writeListedToken(listedToken)

    return res.status(200).json({
      token: listedToken,
      message: `Token listed with ${formatUnits(parseUnits(TOKEN_LISTING_FEE, 18), 18)} PLAX fee`,
    })
  } catch (error) {
    console.error(error)
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to list token' })
  }
}

export default handler
