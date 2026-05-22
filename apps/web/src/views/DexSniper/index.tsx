import { useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256 } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { useTranslation } from '@pancakeswap/localization'
import {
  AutoRenewIcon,
  Box,
  Button,
  Card,
  CardBody,
  Flex,
  Heading,
  Input,
  Message,
  MessageText,
  Text,
  useToast,
} from '@pancakeswap/uikit'
import { bscTokens } from '@pancakeswap/tokens'
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useDexSniperContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import { isAddress } from 'utils'
import { getDexSniperAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type DexSniperView = 'create' | 'my-bots'

type BotInfo = {
  id: BigNumber
  owner: string
  router: string
  factory: string
  targetToken: string
  buyToken: string
  buyAmount: BigNumber
  remainingBuyAmount: BigNumber
  acquiredAmount: BigNumber
  proceedsToken: string
  proceedsAmount: BigNumber
  stopLossBps: number
  takeProfitBps: number
  slippageBps: number
  minLiquidityUsd: BigNumber
  status: number
  buyWithNative: boolean
  createdAt: BigNumber
  boughtAt: BigNumber
  soldAt: BigNumber
}

const BOT_FEE = parseUnits('1', 18)
const NATIVE_BUY_TOKEN = 'native'
const POLYGON_CHAIN_ID = 137
const DEFAULT_SLIPPAGE = '20'
const DEFAULT_MIN_LIQUIDITY = '100'

const toBps = (value: string) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const statusLabel = (status: number) => {
  if (status === 1) return 'Active'
  if (status === 2) return 'Paused'
  if (status === 3) return 'Bought'
  if (status === 4) return 'Sold'
  return 'Unknown'
}

const DexSniperTabs: React.FC<{ activeView: DexSniperView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/dex-sniper', label: t('Create Bot'), view: 'create' },
    { href: '/dex-sniper/my-bots', label: t('My Bots'), view: 'my-bots' },
  ]

  return (
    <Flex mb="24px" style={{ gap: '8px', flexWrap: 'wrap' }}>
      {links.map((link) => (
        <Button
          key={link.href}
          as="a"
          href={link.href}
          scale="sm"
          variant={activeView === link.view ? 'primary' : 'secondary'}
        >
          {link.label}
        </Button>
      ))}
    </Flex>
  )
}

const BotRow: React.FC<{
  bot: BotInfo
  actionBotId: string
  onPause: (bot: BotInfo) => void
  onResume: (bot: BotInfo) => void
}> = ({ bot, actionBotId, onPause, onResume }) => {
  const { t } = useTranslation()
  const buyDecimals = bot.buyWithNative ? 18 : bot.buyToken.toLowerCase() === bscTokens.usdt.address.toLowerCase() ? 6 : 18
  const buySymbol = bot.buyWithNative ? 'POL' : bot.buyToken.toLowerCase() === bscTokens.usdt.address.toLowerCase() ? 'USDT' : 'TOKEN'
  const isActionLoading = actionBotId === bot.id.toString()

  return (
    <Box p="16px" border="1px solid" borderColor="cardBorder" borderRadius="8px">
      <Flex justifyContent="space-between" alignItems="flex-start" mb="12px" style={{ gap: '12px' }}>
        <Box>
          <Text bold>{t('Bot #%id%', { id: bot.id.toString() })}</Text>
          <Text color="textSubtle" fontSize="12px" ellipsis maxWidth="280px">
            {bot.targetToken}
          </Text>
        </Box>
        <Text color={bot.status === 1 || bot.status === 3 ? 'success' : 'textSubtle'} bold>
          {statusLabel(bot.status)}
        </Text>
      </Flex>
      <Flex flexDirection={['column', null, 'row']} style={{ gap: '12px' }}>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Buy Amount')}
          </Text>
          <Text>
            {formatUnits(bot.buyAmount, buyDecimals)} {buySymbol}
          </Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Take Profit')}
          </Text>
          <Text>{bot.takeProfitBps / 100}%</Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Stop Loss')}
          </Text>
          <Text>{bot.stopLossBps / 100}%</Text>
        </Box>
      </Flex>
      <Flex mt="16px" style={{ gap: '8px', flexWrap: 'wrap' }}>
        <Button scale="sm" disabled={bot.status !== 1 && bot.status !== 3} onClick={() => onPause(bot)}>
          {isActionLoading ? <AutoRenewIcon spin color="currentColor" mr="6px" /> : null}
          {t('Pause')}
        </Button>
        <Button scale="sm" variant="secondary" disabled={bot.status !== 2} onClick={() => onResume(bot)}>
          {isActionLoading ? <AutoRenewIcon spin color="currentColor" mr="6px" /> : null}
          {t('Resume')}
        </Button>
      </Flex>
    </Box>
  )
}

const DexSniper: React.FC<{ activeView?: DexSniperView }> = ({ activeView = 'create' }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const dexSniperAddress = useMemo(() => getDexSniperAddress(chainId), [chainId])
  const hasDexSniperAddress = Boolean(dexSniperAddress)
  const dexSniperContract = useDexSniperContract()
  const plaxToken = bscTokens.cake
  const usdtToken = bscTokens.usdt
  const plaxContract = useTokenContract(plaxToken.address)
  const usdtContract = useTokenContract(usdtToken.address)

  const [router, setRouter] = useState('')
  const [factory, setFactory] = useState('')
  const [targetToken, setTargetToken] = useState('')
  const [buyTokenMode, setBuyTokenMode] = useState(NATIVE_BUY_TOKEN)
  const [buyAmount, setBuyAmount] = useState('')
  const [takeProfit, setTakeProfit] = useState('100')
  const [stopLoss, setStopLoss] = useState('30')
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [minLiquidity, setMinLiquidity] = useState(DEFAULT_MIN_LIQUIDITY)
  const [isApprovingFee, setIsApprovingFee] = useState(false)
  const [isApprovingBuyToken, setIsApprovingBuyToken] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [actionBotId, setActionBotId] = useState('')

  const buyWithNative = buyTokenMode === NATIVE_BUY_TOKEN
  const buyTokenContract = buyWithNative ? null : usdtContract
  const buyDecimals = buyWithNative ? 18 : usdtToken.decimals

  const { data: feeAllowance, mutate: refreshFeeAllowance } = useSWR(
    account && dexSniperAddress && plaxContract ? ['dexSniperFeeAllowance', account, dexSniperAddress] : null,
    () => plaxContract.allowance(account, dexSniperAddress),
  )
  const parsedBuyAmount = useMemo(() => {
    try {
      return buyAmount ? parseUnits(buyAmount, buyDecimals) : null
    } catch {
      return null
    }
  }, [buyAmount, buyDecimals])
  const { data: buyTokenAllowance, mutate: refreshBuyTokenAllowance } = useSWR(
    account && dexSniperAddress && buyTokenContract && parsedBuyAmount
      ? ['dexSniperBuyAllowance', account, dexSniperAddress, buyTokenMode]
      : null,
    () => buyTokenContract.allowance(account, dexSniperAddress),
  )
  const { data: bots, mutate: refreshBots } = useSWR(
    activeView === 'my-bots' && account && dexSniperContract ? ['dexSniperBots', account] : null,
    () => dexSniperContract.getBotsByOwner(account, 0, 50) as Promise<BotInfo[]>,
  )

  const isApprovedFee = feeAllowance ? BigNumber.from(feeAllowance).gte(BOT_FEE) : false
  const isApprovedBuyToken = buyWithNative || (buyTokenAllowance && parsedBuyAmount ? BigNumber.from(buyTokenAllowance).gte(parsedBuyAmount) : false)
  const isWrongNetwork = chainId !== POLYGON_CHAIN_ID
  const canCreate =
    account &&
    hasDexSniperAddress &&
    !isWrongNetwork &&
    isAddress(router) &&
    isAddress(factory) &&
    isAddress(targetToken) &&
    parsedBuyAmount?.gt(0) &&
    toBps(takeProfit) &&
    toBps(stopLoss) !== null &&
    toBps(slippage) !== null

  const handleApproveFee = useCallback(async () => {
    if (!plaxContract || !dexSniperAddress) return
    setIsApprovingFee(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [dexSniperAddress, MaxUint256])
      await tx.wait()
      await refreshFeeAllowance()
      toastSuccess(t('PLAX enabled'), <ToastDescriptionWithTx txHash={tx.hash}>{t('You can start a sniper bot now.')}</ToastDescriptionWithTx>)
    } catch {
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApprovingFee(false)
    }
  }, [callWithGasPrice, dexSniperAddress, plaxContract, refreshFeeAllowance, t, toastError, toastSuccess])

  const handleApproveBuyToken = useCallback(async () => {
    if (!buyTokenContract || !dexSniperAddress) return
    setIsApprovingBuyToken(true)
    try {
      const tx = await callWithGasPrice(buyTokenContract, 'approve', [dexSniperAddress, MaxUint256])
      await tx.wait()
      await refreshBuyTokenAllowance()
      toastSuccess(t('USDT enabled'), <ToastDescriptionWithTx txHash={tx.hash}>{t('USDT can be used by your bot.')}</ToastDescriptionWithTx>)
    } catch {
      toastError(t('Error'), t('Unable to approve USDT. Please try again.'))
    } finally {
      setIsApprovingBuyToken(false)
    }
  }, [buyTokenContract, callWithGasPrice, dexSniperAddress, refreshBuyTokenAllowance, t, toastError, toastSuccess])

  const handleCreateBot = useCallback(async () => {
    if (!dexSniperContract || !parsedBuyAmount) return
    const stopLossBps = toBps(stopLoss)
    const takeProfitBps = toBps(takeProfit)
    const slippageBps = toBps(slippage)
    if (stopLossBps === null || takeProfitBps === null || slippageBps === null) return

    setIsCreating(true)
    try {
      const tx = await callWithGasPrice(
        dexSniperContract,
        'createBot',
        [
          router,
          factory,
          targetToken,
          buyWithNative ? '0x0000000000000000000000000000000000000000' : usdtToken.address,
          parsedBuyAmount,
          stopLossBps,
          takeProfitBps,
          slippageBps,
          parseUnits(minLiquidity || '0', 18),
          buyWithNative,
        ],
        buyWithNative ? { value: parsedBuyAmount } : undefined,
      )
      await tx.wait()
      toastSuccess(t('Bot started'), <ToastDescriptionWithTx txHash={tx.hash}>{t('Your sniper bot is active.')}</ToastDescriptionWithTx>)
      await refreshBots()
    } catch (error) {
      toastError(t('Error'), error instanceof Error ? error.message : t('Unable to create bot.'))
    } finally {
      setIsCreating(false)
    }
  }, [
    buyWithNative,
    callWithGasPrice,
    dexSniperContract,
    factory,
    minLiquidity,
    parsedBuyAmount,
    refreshBots,
    router,
    slippage,
    stopLoss,
    takeProfit,
    targetToken,
    t,
    toastError,
    toastSuccess,
    usdtToken.address,
  ])

  const handleBotAction = useCallback(
    async (bot: BotInfo, action: 'pauseBot' | 'resumeBot') => {
      if (!dexSniperContract) return
      setActionBotId(bot.id.toString())
      try {
        const tx = await callWithGasPrice(dexSniperContract, action, [bot.id])
        await tx.wait()
        await refreshBots()
        toastSuccess(t(action === 'pauseBot' ? 'Bot paused' : 'Bot resumed'))
      } catch {
        toastError(t('Error'), t('Unable to update bot.'))
      } finally {
        setActionBotId('')
      }
    },
    [callWithGasPrice, dexSniperContract, refreshBots, t, toastError, toastSuccess],
  )

  return (
    <Page>
      <Box maxWidth="760px" mx="auto" width="100%">
        <DexSniperTabs activeView={activeView} />
        <Card>
          <CardBody>
            <Heading scale="lg" mb="8px">
              {t('DEX Sniper')}
            </Heading>
            <Text color="textSubtle" mb="24px">
              {t('Create a paid sniper bot config. Backend keeper execution can be connected after the sniper contract is deployed.')}
            </Text>

            {!hasDexSniperAddress ? (
              <Message variant="warning" mb="24px">
                <MessageText>{t('DEX Sniper contract address is not configured yet.')}</MessageText>
              </Message>
            ) : null}

            {activeView === 'create' ? (
              <>
                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="16px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Router Address')}
                    </Text>
                    <Input value={router} onChange={(event) => setRouter(event.target.value)} placeholder="0x..." />
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Factory Address')}
                    </Text>
                    <Input value={factory} onChange={(event) => setFactory(event.target.value)} placeholder="0x..." />
                  </Box>
                </Flex>

                <Box mb="16px">
                  <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                    {t('Target Token')}
                  </Text>
                  <Input value={targetToken} onChange={(event) => setTargetToken(event.target.value)} placeholder="0x..." />
                </Box>

                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="16px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Buy With')}
                    </Text>
                    <select value={buyTokenMode} onChange={(event) => setBuyTokenMode(event.target.value)} style={{ width: '100%', height: 48 }}>
                      <option value={NATIVE_BUY_TOKEN}>POL</option>
                      <option value="usdt">USDT</option>
                    </select>
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Buy Amount')}
                    </Text>
                    <Input value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} placeholder="0.0" />
                  </Box>
                </Flex>

                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="16px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Take Profit %')}
                    </Text>
                    <Input value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} />
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Stop Loss %')}
                    </Text>
                    <Input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} />
                  </Box>
                </Flex>

                <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }} mb="24px">
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Slippage %')}
                    </Text>
                    <Input value={slippage} onChange={(event) => setSlippage(event.target.value)} />
                  </Box>
                  <Box width="100%">
                    <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                      {t('Min Liquidity USD')}
                    </Text>
                    <Input value={minLiquidity} onChange={(event) => setMinLiquidity(event.target.value)} />
                  </Box>
                </Flex>

                <Flex justifyContent="space-between" mb="16px">
                  <Text color="textSubtle">{t('Start Bot Fee')}</Text>
                  <Text bold>{t('1000 PLAX')}</Text>
                </Flex>

                {!account ? (
                  <ConnectWalletButton width="100%" />
                ) : !isApprovedFee ? (
                  <Button width="100%" onClick={handleApproveFee} disabled={isApprovingFee || !hasDexSniperAddress}>
                    {isApprovingFee ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {t('Enable PLAX')}
                  </Button>
                ) : !isApprovedBuyToken ? (
                  <Button width="100%" onClick={handleApproveBuyToken} disabled={isApprovingBuyToken || !hasDexSniperAddress}>
                    {isApprovingBuyToken ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {t('Enable USDT')}
                  </Button>
                ) : (
                  <Button width="100%" onClick={handleCreateBot} disabled={!canCreate || isCreating}>
                    {isCreating ? <AutoRenewIcon spin color="currentColor" mr="8px" /> : null}
                    {isWrongNetwork ? t('Switch to Polygon') : t('Pay 1000 PLAX & Start Bot')}
                  </Button>
                )}
              </>
            ) : (
              <Box>
                {!account ? (
                  <ConnectWalletButton width="100%" />
                ) : bots?.length ? (
                  <Flex flexDirection="column" style={{ gap: '12px' }}>
                    {bots.map((bot) => (
                      <BotRow
                        key={bot.id.toString()}
                        bot={bot}
                        actionBotId={actionBotId}
                        onPause={(currentBot) => handleBotAction(currentBot, 'pauseBot')}
                        onResume={(currentBot) => handleBotAction(currentBot, 'resumeBot')}
                      />
                    ))}
                  </Flex>
                ) : (
                  <Text color="textSubtle">{t('No bots found.')}</Text>
                )}
              </Box>
            )}
          </CardBody>
        </Card>
      </Box>
    </Page>
  )
}

export default DexSniper
