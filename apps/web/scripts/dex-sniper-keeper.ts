import { Contract } from '@ethersproject/contracts'
import { Wallet } from '@ethersproject/wallet'
import { BigNumber } from '@ethersproject/bignumber'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatUnits, parseUnits } from '@ethersproject/units'
import dexSniperAbi from '../src/config/abi/dexSniper.json'

const FACTORY_ABI = ['function getPair(address tokenA, address tokenB) view returns (address pair)']
const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]
const ROUTER_ABI = ['function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)']

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const STATUS_ACTIVE = 1
const STATUS_BOUGHT = 3
const DEFAULT_LIMIT = 50

type BotInfo = {
  id: BigNumber
  router: string
  factory: string
  targetToken: string
  buyToken: string
  buyAmount: BigNumber
  remainingBuyAmount: BigNumber
  acquiredAmount: BigNumber
  stopLossBps: number
  takeProfitBps: number
  slippageBps: number
  minLiquidityUsd: BigNumber
  status: number
  buyWithNative: boolean
}

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing ${key}`)
  }
  return value
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const getPathInputToken = (bot: BotInfo) => (bot.buyWithNative ? requiredEnv('DEX_SNIPER_WRAPPED_NATIVE') : bot.buyToken)

const withSlippage = (amount: BigNumber, slippageBps: number) => amount.mul(Math.max(0, 10000 - slippageBps)).div(10000)

const getGasOverrides = async (provider: JsonRpcProvider) => {
  const [feeData, latestBlock] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')])
  const minPriorityFee = parseUnits(process.env.DEX_SNIPER_MIN_PRIORITY_FEE_GWEI ?? '30', 'gwei')
  const envMaxFee = process.env.DEX_SNIPER_MAX_FEE_GWEI
    ? parseUnits(process.env.DEX_SNIPER_MAX_FEE_GWEI, 'gwei')
    : undefined
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gt(minPriorityFee)
      ? feeData.maxPriorityFeePerGas
      : minPriorityFee
  const baseFee = latestBlock.baseFeePerGas ?? feeData.gasPrice ?? parseUnits('100', 'gwei')
  const calculatedMaxFee = baseFee.mul(2).add(maxPriorityFeePerGas)
  const maxFeePerGas = envMaxFee ?? (feeData.maxFeePerGas && feeData.maxFeePerGas.gt(calculatedMaxFee) ? feeData.maxFeePerGas : calculatedMaxFee)

  return {
    maxFeePerGas,
    maxPriorityFeePerGas,
  }
}

const getPairAddress = async (bot: BotInfo, provider: JsonRpcProvider) => {
  const factory = new Contract(bot.factory, FACTORY_ABI, provider)
  return factory.getPair(bot.targetToken, getPathInputToken(bot)) as Promise<string>
}

const getPairLiquidity = async (pairAddress: string, quoteToken: string, provider: JsonRpcProvider) => {
  if (!pairAddress || pairAddress === ZERO_ADDRESS) return BigNumber.from(0)

  const pair = new Contract(pairAddress, PAIR_ABI, provider)
  const [token0, reserves] = await Promise.all([pair.token0(), pair.getReserves()])
  return token0.toLowerCase() === quoteToken.toLowerCase() ? reserves.reserve0 ?? reserves[0] : reserves.reserve1 ?? reserves[1]
}

const normalizeQuoteLiquidity = (amount: BigNumber, quoteToken: string) => {
  const usdtAddress = process.env.DEX_SNIPER_USDT_ADDRESS ?? '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
  const usdtDecimals = Number(process.env.DEX_SNIPER_USDT_DECIMALS ?? 6)

  if (quoteToken.toLowerCase() === usdtAddress.toLowerCase() && usdtDecimals < 18) {
    return amount.mul(BigNumber.from(10).pow(18 - usdtDecimals))
  }

  return amount
}

const fetchBots = async (sniper: Contract) => {
  const bots: BotInfo[] = []
  for (let offset = 0; ; offset += DEFAULT_LIMIT) {
    // eslint-disable-next-line no-await-in-loop
    const page = (await sniper.getBots(offset, DEFAULT_LIMIT)) as BotInfo[]
    bots.push(...page)
    if (page.length < DEFAULT_LIMIT) break
  }
  return bots
}

const executeBuyIfReady = async (bot: BotInfo, sniper: Contract, provider: JsonRpcProvider) => {
  if (bot.status !== STATUS_ACTIVE || bot.remainingBuyAmount.lte(0)) return

  const path = [getPathInputToken(bot), bot.targetToken]
  const pairAddress = await getPairAddress(bot, provider)
  const rawQuoteLiquidity = await getPairLiquidity(pairAddress, path[0], provider)
  const quoteLiquidity = normalizeQuoteLiquidity(rawQuoteLiquidity, path[0])

  if (quoteLiquidity.lt(bot.minLiquidityUsd)) {
    console.info('[DexSniperKeeper] Liquidity not ready', {
      botId: bot.id.toString(),
      pairAddress,
      quoteLiquidity: quoteLiquidity.toString(),
      minLiquidity: bot.minLiquidityUsd.toString(),
    })
    return
  }

  const router = new Contract(bot.router, ROUTER_ABI, provider)
  const amounts = await router.getAmountsOut(bot.remainingBuyAmount, path)
  const amountOutMin = withSlippage(amounts[amounts.length - 1], bot.slippageBps)
  const deadline = Math.floor(Date.now() / 1000) + 60

  console.info('[DexSniperKeeper] Executing buy', {
    botId: bot.id.toString(),
    path,
    expectedOut: amounts[amounts.length - 1].toString(),
    amountOutMin: amountOutMin.toString(),
  })

  const gasOverrides = await getGasOverrides(provider)
  console.info('[DexSniperKeeper] Buy gas', {
    botId: bot.id.toString(),
    maxFeeGwei: formatUnits(gasOverrides.maxFeePerGas, 'gwei'),
    maxPriorityFeeGwei: formatUnits(gasOverrides.maxPriorityFeePerGas, 'gwei'),
  })

  const tx = await sniper.executeBuy(bot.id, path, amountOutMin, deadline, gasOverrides)
  console.info('[DexSniperKeeper] Buy tx sent', { botId: bot.id.toString(), txHash: tx.hash })
  await tx.wait()
}

const executeSellIfTriggered = async (bot: BotInfo, sniper: Contract, provider: JsonRpcProvider) => {
  if (bot.status !== STATUS_BOUGHT || bot.acquiredAmount.lte(0)) return

  const outputToken = getPathInputToken(bot)
  const path = [bot.targetToken, outputToken]
  const router = new Contract(bot.router, ROUTER_ABI, provider)
  const amounts = await router.getAmountsOut(bot.acquiredAmount, path)
  const currentOutput = amounts[amounts.length - 1] as BigNumber
  const entryOutput = bot.buyAmount
  const takeProfitOutput = entryOutput.mul(10000 + bot.takeProfitBps).div(10000)
  const stopLossOutput = entryOutput.mul(Math.max(0, 10000 - bot.stopLossBps)).div(10000)
  const shouldTakeProfit = currentOutput.gte(takeProfitOutput)
  const shouldStopLoss = currentOutput.lte(stopLossOutput)

  console.info('[DexSniperKeeper] Position check', {
    botId: bot.id.toString(),
    currentOutput: formatUnits(currentOutput, 18),
    takeProfitOutput: formatUnits(takeProfitOutput, 18),
    stopLossOutput: formatUnits(stopLossOutput, 18),
  })

  if (!shouldTakeProfit && !shouldStopLoss) return

  const amountOutMin = withSlippage(currentOutput, bot.slippageBps)
  const deadline = Math.floor(Date.now() / 1000) + 60

  console.info('[DexSniperKeeper] Executing sell', {
    botId: bot.id.toString(),
    reason: shouldTakeProfit ? 'take-profit' : 'stop-loss',
    path,
    amountOutMin: amountOutMin.toString(),
  })

  const gasOverrides = await getGasOverrides(provider)
  console.info('[DexSniperKeeper] Sell gas', {
    botId: bot.id.toString(),
    maxFeeGwei: formatUnits(gasOverrides.maxFeePerGas, 'gwei'),
    maxPriorityFeeGwei: formatUnits(gasOverrides.maxPriorityFeePerGas, 'gwei'),
  })

  const tx = await sniper.executeSell(bot.id, path, amountOutMin, deadline, bot.buyWithNative, gasOverrides)
  console.info('[DexSniperKeeper] Sell tx sent', { botId: bot.id.toString(), txHash: tx.hash })
  await tx.wait()
}

const tick = async (sniper: Contract, provider: JsonRpcProvider) => {
  const bots = await fetchBots(sniper)
  const runnableBots = bots.filter((bot) => bot.status === STATUS_ACTIVE || bot.status === STATUS_BOUGHT)

  console.info('[DexSniperKeeper] Tick', { totalBots: bots.length, runnableBots: runnableBots.length })

  for (const bot of runnableBots) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await executeBuyIfReady(bot, sniper, provider)
      // eslint-disable-next-line no-await-in-loop
      await executeSellIfTriggered(bot, sniper, provider)
    } catch (error) {
      console.error('[DexSniperKeeper] Bot execution failed', {
        botId: bot.id.toString(),
        error,
      })
    }
  }
}

const main = async () => {
  const provider = new JsonRpcProvider(requiredEnv('DEX_SNIPER_RPC_URL'))
  const wallet = new Wallet(requiredEnv('DEX_SNIPER_KEEPER_PRIVATE_KEY'), provider as any)
  const sniper = new Contract(requiredEnv('DEX_SNIPER_CONTRACT_ADDRESS'), dexSniperAbi, wallet)
  const intervalMs = Number(process.env.DEX_SNIPER_POLL_INTERVAL_MS ?? 3000)

  console.info('[DexSniperKeeper] Started', {
    keeper: wallet.address,
    contract: sniper.address,
    intervalMs,
  })

  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await tick(sniper, provider)
    } catch (error) {
      console.error('[DexSniperKeeper] Tick failed', error)
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
  }
}

main().catch((error) => {
  console.error('[DexSniperKeeper] Fatal error', error)
  process.exit(1)
})
