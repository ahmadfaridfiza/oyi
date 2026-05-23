import 'dotenv/config'
import { Interface } from '@ethersproject/abi'
import { BigNumber } from '@ethersproject/bignumber'
import { Contract } from '@ethersproject/contracts'
import { JsonRpcProvider } from '@ethersproject/providers'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'
import newPairSniperAbi from '../src/config/abi/newPairSniper.json'

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
]
const ROUTER_ABI = ['function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)']
const FACTORY_INTERFACE = new Interface(['event PairCreated(address indexed token0, address indexed token1, address pair, uint256)'])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const STATUS_ACTIVE = 1
const STATUS_BOUGHT = 3
const DEFAULT_LIMIT = 50
const SCAN_LOOKBACK_BLOCKS = 5

type BotInfo = {
  id: BigNumber
  router: string
  factory: string
  quoteToken: string
  targetToken: string
  pair: string
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

type PairCandidate = {
  targetToken: string
  pair: string
}

const lastScannedBlockByBot = new Map<string, number>()
const pendingCandidatesByBot = new Map<string, PairCandidate[]>()

const requiredEnv = (key: string) => {
  const value = process.env[key]
  if (!value) throw new Error(`Missing ${key}`)
  return value
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const withSlippage = (amount: BigNumber, slippageBps: number) => amount.mul(Math.max(0, 10000 - slippageBps)).div(10000)

const getGasOverrides = async (provider: JsonRpcProvider) => {
  const [feeData, latestBlock] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')])
  const minPriorityFee = parseUnits(process.env.NEW_PAIR_SNIPER_MIN_PRIORITY_FEE_GWEI ?? '30', 'gwei')
  const envMaxFee = process.env.NEW_PAIR_SNIPER_MAX_FEE_GWEI ? parseUnits(process.env.NEW_PAIR_SNIPER_MAX_FEE_GWEI, 'gwei') : undefined
  const maxPriorityFeePerGas =
    feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas.gt(minPriorityFee) ? feeData.maxPriorityFeePerGas : minPriorityFee
  const baseFee = latestBlock.baseFeePerGas ?? feeData.gasPrice ?? parseUnits('100', 'gwei')
  const calculatedMaxFee = baseFee.mul(2).add(maxPriorityFeePerGas)
  const maxFeePerGas = envMaxFee ?? (feeData.maxFeePerGas && feeData.maxFeePerGas.gt(calculatedMaxFee) ? feeData.maxFeePerGas : calculatedMaxFee)

  return { maxFeePerGas, maxPriorityFeePerGas }
}

const normalizeQuoteLiquidity = (amount: BigNumber, quoteToken: string) => {
  const usdtAddress = process.env.NEW_PAIR_SNIPER_USDT_ADDRESS ?? '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
  const usdtDecimals = Number(process.env.NEW_PAIR_SNIPER_USDT_DECIMALS ?? 6)

  if (quoteToken.toLowerCase() === usdtAddress.toLowerCase() && usdtDecimals < 18) {
    return amount.mul(BigNumber.from(10).pow(18 - usdtDecimals))
  }

  return amount
}

const getPairLiquidity = async (pairAddress: string, quoteToken: string, provider: JsonRpcProvider) => {
  if (!pairAddress || pairAddress === ZERO_ADDRESS) return BigNumber.from(0)
  const pair = new Contract(pairAddress, PAIR_ABI, provider)
  const [token0, reserves] = await Promise.all([pair.token0(), pair.getReserves()])
  return token0.toLowerCase() === quoteToken.toLowerCase() ? reserves.reserve0 ?? reserves[0] : reserves.reserve1 ?? reserves[1]
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

const getNewPairCandidates = async (bot: BotInfo, provider: JsonRpcProvider): Promise<PairCandidate[]> => {
  const latestBlock = await provider.getBlockNumber()
  const scannerKey = `${bot.id.toString()}-${bot.factory.toLowerCase()}`
  const lastScannedBlock = lastScannedBlockByBot.get(scannerKey) ?? Math.max(0, latestBlock - SCAN_LOOKBACK_BLOCKS)
  const fromBlock = Math.min(lastScannedBlock + 1, latestBlock)
  const toBlock = latestBlock
  lastScannedBlockByBot.set(scannerKey, latestBlock)

  const pendingCandidates = pendingCandidatesByBot.get(scannerKey) ?? []

  if (fromBlock > toBlock) return pendingCandidates

  const logs = await provider.getLogs({
    address: bot.factory,
    fromBlock,
    toBlock,
    topics: [FACTORY_INTERFACE.getEventTopic('PairCreated')],
  })

  console.info('[NewPairSniperKeeper] Pair scan', {
    botId: bot.id.toString(),
    factory: bot.factory,
    fromBlock,
    toBlock,
    logs: logs.length,
  })

  const newCandidates = logs
    .map((log) => {
      const parsed = FACTORY_INTERFACE.parseLog(log)
      const token0 = parsed.args.token0 as string
      const token1 = parsed.args.token1 as string
      const pair = parsed.args.pair as string
      const quote = bot.quoteToken.toLowerCase()

      if (token0.toLowerCase() === quote) return { targetToken: token1, pair }
      if (token1.toLowerCase() === quote) return { targetToken: token0, pair }
      return null
    })
    .filter(Boolean) as PairCandidate[]

  const candidatesByPair = new Map<string, PairCandidate>()
  for (const candidate of [...pendingCandidates, ...newCandidates]) {
    candidatesByPair.set(candidate.pair.toLowerCase(), candidate)
  }

  const candidates = Array.from(candidatesByPair.values())
  pendingCandidatesByBot.set(scannerKey, candidates)
  return candidates
}

const executeBuyIfReady = async (bot: BotInfo, sniper: Contract, provider: JsonRpcProvider) => {
  if (bot.status !== STATUS_ACTIVE || bot.remainingBuyAmount.lte(0) || bot.targetToken !== ZERO_ADDRESS) return

  const scannerKey = `${bot.id.toString()}-${bot.factory.toLowerCase()}`
  const candidates = await getNewPairCandidates(bot, provider)
  const router = new Contract(bot.router, ROUTER_ABI, provider)
  const stillPending: PairCandidate[] = []

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const rawQuoteLiquidity = await getPairLiquidity(candidate.pair, bot.quoteToken, provider)
      const quoteLiquidity = normalizeQuoteLiquidity(rawQuoteLiquidity, bot.quoteToken)

      if (quoteLiquidity.lt(bot.minLiquidityUsd)) {
        stillPending.push(candidate)
        console.info('[NewPairSniperKeeper] Liquidity not ready', {
          botId: bot.id.toString(),
          pair: candidate.pair,
          targetToken: candidate.targetToken,
          quoteLiquidity: quoteLiquidity.toString(),
          minLiquidity: bot.minLiquidityUsd.toString(),
        })
        // eslint-disable-next-line no-continue
        continue
      }

      const path = [bot.quoteToken, candidate.targetToken]
      // eslint-disable-next-line no-await-in-loop
      const amounts = await router.getAmountsOut(bot.remainingBuyAmount, path)
      const amountOutMin = withSlippage(amounts[amounts.length - 1], bot.slippageBps)
      const deadline = Math.floor(Date.now() / 1000) + 60
      // eslint-disable-next-line no-await-in-loop
      const gasOverrides = await getGasOverrides(provider)

      console.info('[NewPairSniperKeeper] Executing buy', {
        botId: bot.id.toString(),
        pair: candidate.pair,
        path,
        expectedOut: amounts[amounts.length - 1].toString(),
        amountOutMin: amountOutMin.toString(),
        maxFeeGwei: formatUnits(gasOverrides.maxFeePerGas, 'gwei'),
        maxPriorityFeeGwei: formatUnits(gasOverrides.maxPriorityFeePerGas, 'gwei'),
      })

      // eslint-disable-next-line no-await-in-loop
      const tx = await sniper.executeBuy(bot.id, candidate.targetToken, candidate.pair, path, amountOutMin, deadline, gasOverrides)
      console.info('[NewPairSniperKeeper] Buy tx sent', { botId: bot.id.toString(), txHash: tx.hash })
      // eslint-disable-next-line no-await-in-loop
      await tx.wait()
      pendingCandidatesByBot.delete(scannerKey)
      return
    } catch (error) {
      stillPending.push(candidate)
      console.error('[NewPairSniperKeeper] Candidate failed', {
        botId: bot.id.toString(),
        pair: candidate.pair,
        targetToken: candidate.targetToken,
        error,
      })
    }
  }

  pendingCandidatesByBot.set(scannerKey, stillPending)
}

const executeSellIfTriggered = async (bot: BotInfo, sniper: Contract, provider: JsonRpcProvider) => {
  if (bot.status !== STATUS_BOUGHT || bot.acquiredAmount.lte(0) || bot.targetToken === ZERO_ADDRESS) return

  const path = [bot.targetToken, bot.quoteToken]
  const router = new Contract(bot.router, ROUTER_ABI, provider)
  const amounts = await router.getAmountsOut(bot.acquiredAmount, path)
  const currentOutput = amounts[amounts.length - 1] as BigNumber
  const entryOutput = bot.buyAmount
  const takeProfitOutput = entryOutput.mul(10000 + bot.takeProfitBps).div(10000)
  const stopLossOutput = entryOutput.mul(Math.max(0, 10000 - bot.stopLossBps)).div(10000)
  const shouldTakeProfit = currentOutput.gte(takeProfitOutput)
  const shouldStopLoss = currentOutput.lte(stopLossOutput)

  console.info('[NewPairSniperKeeper] Position check', {
    botId: bot.id.toString(),
    currentOutput: formatUnits(currentOutput, 18),
    takeProfitOutput: formatUnits(takeProfitOutput, 18),
    stopLossOutput: formatUnits(stopLossOutput, 18),
  })

  if (!shouldTakeProfit && !shouldStopLoss) return

  const amountOutMin = withSlippage(currentOutput, bot.slippageBps)
  const deadline = Math.floor(Date.now() / 1000) + 60
  const gasOverrides = await getGasOverrides(provider)

  console.info('[NewPairSniperKeeper] Executing sell', {
    botId: bot.id.toString(),
    reason: shouldTakeProfit ? 'take-profit' : 'stop-loss',
    path,
    amountOutMin: amountOutMin.toString(),
    maxFeeGwei: formatUnits(gasOverrides.maxFeePerGas, 'gwei'),
    maxPriorityFeeGwei: formatUnits(gasOverrides.maxPriorityFeePerGas, 'gwei'),
  })

  const tx = await sniper.executeSell(bot.id, path, amountOutMin, deadline, bot.buyWithNative, gasOverrides)
  console.info('[NewPairSniperKeeper] Sell tx sent', { botId: bot.id.toString(), txHash: tx.hash })
  await tx.wait()
}

const tick = async (sniper: Contract, provider: JsonRpcProvider) => {
  const bots = await fetchBots(sniper)
  const runnableBots = bots.filter((bot) => bot.status === STATUS_ACTIVE || bot.status === STATUS_BOUGHT)

  console.info('[NewPairSniperKeeper] Tick', { totalBots: bots.length, runnableBots: runnableBots.length })

  for (const bot of runnableBots) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await executeBuyIfReady(bot, sniper, provider)
      // eslint-disable-next-line no-await-in-loop
      await executeSellIfTriggered(bot, sniper, provider)
    } catch (error) {
      console.error('[NewPairSniperKeeper] Bot execution failed', {
        botId: bot.id.toString(),
        error,
      })
    }
  }
}

const main = async () => {
  const provider = new JsonRpcProvider(requiredEnv('NEW_PAIR_SNIPER_RPC_URL'))
  const wallet = new Wallet(requiredEnv('NEW_PAIR_SNIPER_KEEPER_PRIVATE_KEY'), provider as any)
  const sniper = new Contract(requiredEnv('NEW_PAIR_SNIPER_CONTRACT_ADDRESS'), newPairSniperAbi, wallet)
  const intervalMs = Number(process.env.NEW_PAIR_SNIPER_POLL_INTERVAL_MS ?? 3000)

  console.info('[NewPairSniperKeeper] Started', {
    keeper: wallet.address,
    contract: sniper.address,
    intervalMs,
  })

  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await tick(sniper, provider)
    } catch (error) {
      console.error('[NewPairSniperKeeper] Tick failed', error)
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
  }
}

main().catch((error) => {
  console.error('[NewPairSniperKeeper] Fatal error', error)
  process.exit(1)
})
