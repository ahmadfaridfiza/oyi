import { useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256, Zero } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { useTranslation } from '@pancakeswap/localization'
import {
  AutoRenewIcon,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardViewIcon,
  Flex,
  Heading,
  InjectedModalProps,
  Input,
  LinkExternal,
  ListViewIcon,
  Message,
  MessageText,
  Modal,
  Select,
  Text,
  TokenLogo,
  Toggle,
  useModal,
  useToast,
} from '@pancakeswap/uikit'
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useSmartFarmsContract, useTokenContract } from 'hooks/useContract'
import { useProviderOrSigner } from 'hooks/useProviderOrSigner'
import { useAvailableLpPairs } from 'hooks/useAvailableLpPairs'
import { Contract } from '@ethersproject/contracts'
import pairAbi from 'config/abi/pancakePair.json'
import erc20Abi from 'config/abi/erc20.json'

import useSWR from 'swr'
import styled from 'styled-components'
import { getBlockExploreLink, isAddress } from 'utils'
import { getSmartFarmsAddress } from 'utils/addressHelpers'
import { getTokenLogoURLByAddress } from 'utils/getTokenLogoURL'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/router'
import Page from 'views/Page'

type ViewMode = 'list' | 'card'

type FarmInfo = {
  id: BigNumber
  creator: string
  stakingToken: string
  rewardToken: string
  rewardPerSecond: BigNumber
  rewardRemaining: BigNumber
  totalReward: BigNumber
  totalPaid: BigNumber
  totalStaked: BigNumber
  accRewardPerShare: BigNumber
  lastRewardTime: BigNumber
  active: boolean
}

type TokenMetadata = {
  decimals: number
  symbol: string
  name: string
}

type UserFarmInfo = {
  amount: BigNumber
  rewardDebt: BigNumber
  unpaidRewards: BigNumber
}

const CREATE_FEE = parseUnits('10', 18)
const POOLS_PAGE_SIZE = 50
const SECONDS_PER_DAY = BigNumber.from(86400)
const SECONDS_PER_YEAR = BigNumber.from(31536000)
const MIN_LIQUIDITY_USD = 100

const Controls = styled(Flex)`
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
`

const ViewButton = styled(Button)<{ $active?: boolean }>`
  width: 32px;
  height: 32px;
  padding: 0;
  color: ${({ theme, $active }) => ($active ? theme.colors.primary : theme.colors.textSubtle)};
`

const FarmShell = styled(Box)`
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.backgroundAlt};
`

const FarmHeader = styled(Flex)<{ $clickable?: boolean }>`
  min-height: 88px;
  gap: 16px;
  padding: 18px 24px;
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'default')};

  ${({ theme }) => theme.mediaQueries.md} {
    align-items: center;
  }
`

const FarmPanel = styled(Box)`
  border-top: 1px solid ${({ theme }) => theme.colors.cardBorder};
  padding: 20px 24px 24px;
`

const StatBox = styled(Box)`
  min-width: 120px;
`

const ActionBox = styled(Box)`
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 12px;
  padding: 18px;
`

const CardGrid = styled(Box)`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
`

const FarmCardShell = styled(Card)`
  overflow: hidden;
`

const FarmCardTop = styled(Box)`
  min-height: 112px;
  padding: 24px;
  background: ${({ theme }) => theme.colors.backgroundAlt};
`

const TokenLogoWrap = styled(Box)`
  position: relative;
  width: 48px;
  height: 48px;
  flex: none;
`

const RewardLogoBadge = styled(Box)`
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 24px;
  height: 24px;
`

const PercentButton = styled(Button)`
  flex: 1;
  min-width: 64px;
`

const SectionLabel = styled(Text)`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.secondary};
  text-transform: uppercase;
  margin-bottom: 8px;
`

const formatCompactAmount = (amount: BigNumber, decimals: number, precision = 4) => {
  const value = Number(formatUnits(amount, decimals))
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString(undefined, { maximumFractionDigits: precision })
}

const formatDuration = (seconds?: BigNumber) => {
  if (!seconds || seconds.lte(0)) return '-'
  let value = 0
  try {
    value = seconds.toNumber()
  } catch {
    return 'Long running'
  }
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  if (days > 0) return `${days.toLocaleString()}d ${hours}h`
  return `${hours}h`
}

const useTokenMetadata = (address?: string): TokenMetadata => {
  const tokenContract = useTokenContract(address, false)
  const { data } = useSWR(tokenContract && address ? ['smartFarmsTokenMetadata', address] : null, async () => {
    const [decimals, symbol, name] = await Promise.all([
      tokenContract.decimals().catch(() => 18),
      tokenContract.symbol().catch(() => 'TOKEN'),
      tokenContract.name().catch(() => 'Token'),
    ])
    return { decimals: Number(decimals), symbol: String(symbol), name: String(name) }
  })
  return data ?? { decimals: 18, symbol: 'TOKEN', name: 'Token' }
}

const NATIVE_LIKE = [
  '0x0000000000000000000000000000000000001010',
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
]

const useLpPairName = (lpAddress?: string): string => {
  const provider = useProviderOrSigner(false)
  const { data } = useSWR(
    provider && lpAddress ? ['lpPairName', lpAddress] : null,
    async () => {
      const pc = new Contract(lpAddress, pairAbi as any, provider)
      const [token0, token1] = await Promise.all([pc.token0(), pc.token1()])
      const t0c = new Contract(token0, erc20Abi as any, provider)
      const t1c = new Contract(token1, erc20Abi as any, provider)
      const [s0, s1] = await Promise.all([
        NATIVE_LIKE.includes(String(token0).toLowerCase()) ? 'POL' : String(await t0c.symbol()),
        NATIVE_LIKE.includes(String(token1).toLowerCase()) ? 'POL' : String(await t1c.symbol()),
      ])
      return `${s0}-${s1} LP`
    },
    { dedupingInterval: 600000 },
  )
  return data ?? ''
}

const LpPairLogo: React.FC<{
  stakingToken?: string
  rewardToken?: string
  stakingLogoURI?: string
  rewardLogoURI?: string
  chainId?: number
  size?: number
}> = ({ stakingToken, rewardToken, stakingLogoURI, rewardLogoURI, chainId, size = 48 }) => {
  const stakingLogo = useMemo(
    () => [stakingLogoURI, getTokenLogoURLByAddress(stakingToken, chainId)].filter(Boolean),
    [chainId, stakingLogoURI, stakingToken],
  )
  const rewardLogo = useMemo(
    () => [rewardLogoURI, getTokenLogoURLByAddress(rewardToken, chainId)].filter(Boolean),
    [chainId, rewardLogoURI, rewardToken],
  )
  return (
    <TokenLogoWrap style={{ width: size, height: size }}>
      <TokenLogo width={size} height={size} srcs={stakingLogo} alt="LP token logo" />
      <RewardLogoBadge>
        <TokenLogo width={24} height={24} srcs={rewardLogo} alt="reward token logo" />
      </RewardLogoBadge>
    </TokenLogoWrap>
  )
}

const LpTokenLogo: React.FC<{
  stakingToken?: string
  stakingLogoURI?: string
  chainId?: number
  size?: number
}> = ({ stakingToken, stakingLogoURI, chainId, size = 48 }) => {
  const stakingLogo = useMemo(
    () => [stakingLogoURI, getTokenLogoURLByAddress(stakingToken, chainId)].filter(Boolean),
    [chainId, stakingLogoURI, stakingToken],
  )
  return (
    <TokenLogoWrap style={{ width: size, height: size }}>
      <TokenLogo width={size} height={size} srcs={stakingLogo} alt="LP token logo" />
    </TokenLogoWrap>
  )
}

const StakeModal: React.FC<
  InjectedModalProps & {
    farm: FarmInfo
    mode: 'stake' | 'unstake'
    smartFarmsAddress: string
    stakingMetadata: TokenMetadata
    rewardMetadata: TokenMetadata
    maxAmount: BigNumber
    allowance?: BigNumber
    onRefresh: () => void
  }
> = ({ farm, mode, smartFarmsAddress, stakingMetadata, rewardMetadata, maxAmount, allowance, onDismiss, onRefresh }) => {
  const { t } = useTranslation()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const { chainId } = useActiveChainId()
  const smartFarmsContract = useSmartFarmsContract()
  const stakingTokenContract = useTokenContract(farm.stakingToken)
  const lpPairName = useLpPairName(farm.stakingToken)
  const [amount, setAmount] = useState('')
  const [pendingAction, setPendingAction] = useState('')

  const parsedAmount = useMemo(() => {
    if (!amount) return null
    try {
      return parseUnits(amount, stakingMetadata.decimals)
    } catch {
      return null
    }
  }, [amount, stakingMetadata.decimals])

  const needsApproval = mode === 'stake' && parsedAmount?.gt(0) && (!allowance || allowance.lt(parsedAmount))
  const canConfirm = parsedAmount?.gt(0) && parsedAmount.lte(maxAmount)

  const setPercent = useCallback(
    (percent: number) => {
      setAmount(formatUnits(maxAmount.mul(percent).div(100), stakingMetadata.decimals))
    },
    [maxAmount, stakingMetadata.decimals],
  )

  const handleApprove = useCallback(async () => {
    if (!stakingTokenContract) return
    setPendingAction('approve')
    try {
      const tx = await callWithGasPrice(stakingTokenContract, 'approve', [smartFarmsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('LP Token Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      onRefresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve LP token. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, onRefresh, smartFarmsAddress, stakingTokenContract, t, toastError, toastSuccess])

  const handleConfirm = useCallback(async () => {
    if (!smartFarmsContract || !parsedAmount?.gt(0)) return
    setPendingAction(mode)
    try {
      const tx = await callWithGasPrice(smartFarmsContract, mode === 'stake' ? 'deposit' : 'withdraw', [farm.id, parsedAmount])
      const receipt = await tx.wait()
      toastSuccess(mode === 'stake' ? t('Staked') : t('Unstaked'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      onRefresh()
      onDismiss?.()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), mode === 'stake' ? t('Unable to stake LP. Please try again.') : t('Unable to unstake. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, mode, onDismiss, onRefresh, parsedAmount, farm.id, smartFarmsContract, t, toastError, toastSuccess])

  return (
    <Modal title={mode === 'stake' ? t('Stake LP') : t('Unstake LP')} onDismiss={onDismiss}>
      <Box width={['100%', '100%', '360px']}>
        <Flex justifyContent="space-between" alignItems="center" mb="16px">
          <Text bold>{mode === 'stake' ? t('Stake') : t('Unstake')}:</Text>
          <Flex alignItems="center" style={{ gap: '8px' }}>
            <LpTokenLogo stakingToken={farm.stakingToken} size={28} />
            <Text bold>{lpPairName || stakingMetadata.symbol}</Text>
          </Flex>
        </Flex>
        <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.0" />
        <Text textAlign="right" color="textSubtle" fontSize="12px" mt="6px" mb="16px">
          {t('Balance')}: {formatCompactAmount(maxAmount, stakingMetadata.decimals, 8)}
        </Text>
        <Flex style={{ gap: '6px' }} mb="20px">
          {[25, 50, 75, 100].map((percent) => (
            <PercentButton key={percent} scale="xs" variant="tertiary" onClick={() => setPercent(percent)}>
              {percent === 100 ? t('Max') : `${percent}%`}
            </PercentButton>
          ))}
        </Flex>
        <Text color="textSubtle" fontSize="12px" mb="16px">
          {mode === 'unstake'
            ? t('Your LP tokens will be withdrawn and PLAX rewards will be sent to your wallet.')
            : t('Stake LP tokens to earn PLAX rewards from this farm.')}
        </Text>
        {needsApproval ? (
          <Button
            width="100%"
            onClick={handleApprove}
            disabled={pendingAction === 'approve'}
            endIcon={pendingAction === 'approve' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable LP')}
          </Button>
        ) : (
          <Button
            width="100%"
            onClick={handleConfirm}
            disabled={!canConfirm || pendingAction === mode}
            endIcon={pendingAction === mode ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Confirm')}
          </Button>
        )}
      </Box>
    </Modal>
  )
}

const CreateFarm = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const smartFarmsAddress = useMemo(() => getSmartFarmsAddress(chainId), [chainId])
  const hasAddress = Boolean(smartFarmsAddress)
  const smartFarmsContract = useSmartFarmsContract()
  const plaxToken = { address: '0x328801B0b580eAdd83eA841638865eA41Dc6fb25', symbol: 'PLAX', decimals: 18 }
  const { options: lpPairOptions, loading: lpLoading } = useAvailableLpPairs()

  const [lpAddress, setLpAddress] = useState('')
  const [selectedLpLabel, setSelectedLpLabel] = useState('')
  const [useManualLp, setUseManualLp] = useState(false)
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardPerDay, setRewardPerDay] = useState('')
  const [isApprovingFee, setIsApprovingFee] = useState(false)
  const [isApprovingReward, setIsApprovingReward] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createdFarmId, setCreatedFarmId] = useState('')

  const lpToken = useMemo(() => isAddress(lpAddress), [lpAddress]) || lpAddress || undefined
  const lpMetadata = useTokenMetadata(lpToken || undefined)
  const plaxContract = useTokenContract(plaxToken.address)
  const plaxAddress = plaxToken.address

  const parsedRewardAmount = useMemo(() => {
    if (!rewardAmount) return null
    try {
      return parseUnits(rewardAmount, plaxToken.decimals)
    } catch {
      return null
    }
  }, [rewardAmount])

  const parsedRewardPerSecond = useMemo(() => {
    if (!rewardPerDay) return null
    try {
      return parseUnits(rewardPerDay, plaxToken.decimals).div(SECONDS_PER_DAY)
    } catch {
      return null
    }
  }, [rewardPerDay])

  const { data: feeAllowance, mutate: refreshFeeAllowance } = useSWR(
    account && plaxContract && hasAddress ? ['smartFarmsFeeAllowance', account, smartFarmsAddress] : null,
    () => plaxContract.allowance(account, smartFarmsAddress),
  )

  const { data: rewardAllowance, mutate: refreshRewardAllowance } = useSWR(
    account && plaxContract && hasAddress ? ['smartFarmsRewardAllowance', account, plaxAddress, smartFarmsAddress] : null,
    () => plaxContract.allowance(account, smartFarmsAddress),
  )

  const isFeeApproved = feeAllowance ? BigNumber.from(feeAllowance).gte(CREATE_FEE) : false
  const isRewardApproved = parsedRewardAmount && rewardAllowance ? BigNumber.from(rewardAllowance).gte(parsedRewardAmount) : false
  const estimatedDuration = parsedRewardAmount && parsedRewardPerSecond?.gt(0) ? parsedRewardAmount.div(parsedRewardPerSecond) : null

  const canCreate =
    Boolean(account) && Boolean(smartFarmsContract) && hasAddress && Boolean(lpToken) && parsedRewardAmount?.gt(0) && parsedRewardPerSecond?.gt(0)

  const handleApproveFee = useCallback(async () => {
    if (!plaxContract || !hasAddress) return
    setIsApprovingFee(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [smartFarmsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('PLAX Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshFeeAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApprovingFee(false)
    }
  }, [callWithGasPrice, hasAddress, plaxContract, refreshFeeAllowance, smartFarmsAddress, t, toastError, toastSuccess])

  const handleApproveReward = useCallback(async () => {
    if (!plaxContract || !hasAddress) return
    setIsApprovingReward(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [smartFarmsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Reward PLAX Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshRewardAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve reward PLAX. Please try again.'))
    } finally {
      setIsApprovingReward(false)
    }
  }, [callWithGasPrice, hasAddress, plaxContract, refreshRewardAllowance, smartFarmsAddress, t, toastError, toastSuccess])

  const handleCreateFarm = useCallback(async () => {
    if (!smartFarmsContract || !lpToken || !parsedRewardAmount || !parsedRewardPerSecond || !canCreate) return
    setIsCreating(true)
    setCreatedFarmId('')
    try {
      const tx = await callWithGasPrice(smartFarmsContract, 'createFarm', [
        lpToken,
        parsedRewardAmount,
        parsedRewardPerSecond,
      ])
      const receipt = await tx.wait()
      const createdEvent = receipt.logs
        .map((log) => {
          try {
            return smartFarmsContract.interface.parseLog(log)
          } catch {
            return null
          }
        })
        .find((event) => event?.name === 'FarmCreated')
      if (createdEvent?.args?.id) {
        setCreatedFarmId(createdEvent.args.id.toString())
      }
      toastSuccess(t('Smart Farm Created'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshFeeAllowance()
      refreshRewardAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to create farm. Please check your inputs and try again.'))
    } finally {
      setIsCreating(false)
    }
  }, [callWithGasPrice, canCreate, parsedRewardAmount, parsedRewardPerSecond, refreshFeeAllowance, refreshRewardAllowance, lpToken, smartFarmsContract, t, toastError, toastSuccess])

  return (
    <Card>
      <CardHeader>
        <Heading scale="lg">{t('Create Smart Farm')}</Heading>
        <Text color="textSubtle">
          {t('Stake LP tokens and earn PLAX rewards. 10 PLAX creation fee.')}
        </Text>
      </CardHeader>
      <CardBody>
        {!hasAddress ? (
          <Message variant="warning" mb="24px">
            <MessageText>{t('Smart Farms contract is not configured for this network yet.')}</MessageText>
          </Message>
        ) : null}

        <Box mb="16px">
          <Flex justifyContent="space-between" alignItems="center" mb="8px">
            <SectionLabel style={{ marginBottom: 0 }}>{t('LP Pair')}</SectionLabel>
            <Button scale="xs" variant="text" onClick={() => setUseManualLp((c) => !c)}>
              {useManualLp ? t('Select from list') : t('Enter address manually')}
            </Button>
          </Flex>
          {useManualLp ? (
            <Input
              value={lpAddress}
              onChange={(event) => {
                setLpAddress(event.target.value)
                setSelectedLpLabel('')
              }}
              placeholder="0x... (LP token address)"
            />
          ) : (
            <Select
              options={[
                { label: lpLoading ? t('Loading pairs...') : t('Select LP pair...'), value: '' },
                ...lpPairOptions,
              ]}
              onOptionChange={(option) => {
                setLpAddress(option.value)
                setSelectedLpLabel(option.label)
              }}
            />
          )}
          {lpToken ? (
            <Text color="textSubtle" fontSize="12px" mt="4px">
              {selectedLpLabel || `${lpMetadata.name} (${lpMetadata.symbol})`}
            </Text>
          ) : null}
        </Box>

        <Flex mb="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
          <Box width="100%">
            <SectionLabel>{t('Total PLAX Reward')}</SectionLabel>
            <Input inputMode="decimal" value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} placeholder="0.0" />
          </Box>
          <Box width="100%">
            <SectionLabel>{t('PLAX Per Day')}</SectionLabel>
            <Input inputMode="decimal" value={rewardPerDay} onChange={(event) => setRewardPerDay(event.target.value)} placeholder="0.0" />
          </Box>
        </Flex>

        <Flex justifyContent="space-between" mb="8px">
          <Text color="textSubtle">{t('Estimated duration')}</Text>
          <Text bold>{formatDuration(estimatedDuration)}</Text>
        </Flex>
        <Flex justifyContent="space-between" mb="24px">
          <Text color="textSubtle">{t('Creation fee')}</Text>
          <Text bold>{t('%fee% PLAX', { fee: formatUnits(CREATE_FEE, 18) })}</Text>
        </Flex>

        {!account ? (
          <ConnectWalletButton width="100%" />
        ) : !isFeeApproved ? (
          <Button
            width="100%"
            onClick={handleApproveFee}
            disabled={!hasAddress || isApprovingFee}
            endIcon={isApprovingFee ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Approve PLAX Fee')}
          </Button>
        ) : !isRewardApproved ? (
          <Button
            width="100%"
            onClick={handleApproveReward}
            disabled={!canCreate || isApprovingReward}
            endIcon={isApprovingReward ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Approve Reward PLAX')}
          </Button>
        ) : (
          <Button
            width="100%"
            onClick={handleCreateFarm}
            disabled={!canCreate || isCreating}
            endIcon={isCreating ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Create Farm')}
          </Button>
        )}

        {createdFarmId ? (
          <Message variant="success" mt="24px">
            <MessageText>{t('Created Smart Farm ID: %id%', { id: createdFarmId })}</MessageText>
          </Message>
        ) : null}
      </CardBody>
    </Card>
  )
}

const FarmRow: React.FC<{
  farm: FarmInfo
  smartFarmsAddress: string
  onRefresh: () => void
  initialExpanded?: boolean
  asCard?: boolean
}> = ({ farm, smartFarmsAddress, onRefresh, initialExpanded = false, asCard = false }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const { chainId } = useActiveChainId()
  const smartFarmsContract = useSmartFarmsContract()
  const stakingTokenContract = useTokenContract(farm.stakingToken)
  const stakingMetadata = useTokenMetadata(farm.stakingToken)
  const rewardMetadata = useTokenMetadata(farm.rewardToken)
  const lpPairName = useLpPairName(farm.stakingToken)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [pendingAction, setPendingAction] = useState('')

  const { data: userInfo, mutate: refreshUserInfo } = useSWR(
    account && smartFarmsContract ? ['smartFarmsUserInfo', farm.id.toString(), account] : null,
    () => smartFarmsContract.userInfo(farm.id, account) as Promise<UserFarmInfo>,
  )

  const { data: pendingReward, mutate: refreshPendingReward } = useSWR(
    account && smartFarmsContract ? ['smartFarmsPendingReward', farm.id.toString(), account] : null,
    () => smartFarmsContract.pendingReward(farm.id, account) as Promise<BigNumber>,
    { refreshInterval: 10000 },
  )

  const { data: stakingAllowance, mutate: refreshStakingAllowance } = useSWR(
    account && stakingTokenContract ? ['smartFarmsAllowance', farm.id.toString(), account, smartFarmsAddress] : null,
    () => stakingTokenContract.allowance(account, smartFarmsAddress),
  )

  const { data: stakingBalance, mutate: refreshStakingBalance } = useSWR(
    account && stakingTokenContract ? ['smartFarmsBalance', farm.id.toString(), account] : null,
    () => stakingTokenContract.balanceOf(account),
  )

  const userAmount = userInfo?.amount ? BigNumber.from(userInfo.amount) : Zero
  const pending = pendingReward ?? Zero
  const userBalance = stakingBalance ? BigNumber.from(stakingBalance) : Zero
  const allowance = stakingAllowance ? BigNumber.from(stakingAllowance) : Zero
  const remainingDuration = farm.rewardPerSecond.gt(0) ? farm.rewardRemaining.div(farm.rewardPerSecond) : null
  const farmIsOpen = farm.active && farm.rewardRemaining.gt(0)
  const apr = useMemo(() => {
    if (farm.totalStaked.lte(0)) return '0.00%'
    const yearlyReward = Number(formatUnits(farm.rewardPerSecond.mul(SECONDS_PER_YEAR), rewardMetadata.decimals))
    const totalStaked = Number(formatUnits(farm.totalStaked, stakingMetadata.decimals))
    if (!Number.isFinite(yearlyReward) || !Number.isFinite(totalStaked) || totalStaked <= 0) return '0.00%'
    return `${((yearlyReward / totalStaked) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
  }, [farm, stakingMetadata.decimals, rewardMetadata.decimals])

  const refresh = useCallback(() => {
    onRefresh()
    refreshUserInfo()
    refreshPendingReward()
    refreshStakingAllowance()
    refreshStakingBalance()
  }, [onRefresh, refreshPendingReward, refreshStakingAllowance, refreshStakingBalance, refreshUserInfo])

  const [onPresentStakeModal] = useModal(
    <StakeModal
      farm={farm}
      mode="stake"
      smartFarmsAddress={smartFarmsAddress}
      stakingMetadata={stakingMetadata}
      rewardMetadata={rewardMetadata}
      maxAmount={userBalance}
      allowance={allowance}
      onRefresh={refresh}
    />,
  )
  const [onPresentUnstakeModal] = useModal(
    <StakeModal
      farm={farm}
      mode="unstake"
      smartFarmsAddress={smartFarmsAddress}
      stakingMetadata={stakingMetadata}
      rewardMetadata={rewardMetadata}
      maxAmount={userAmount}
      onRefresh={refresh}
    />,
  )

  const handleHarvest = useCallback(async () => {
    if (!smartFarmsContract) return
    setPendingAction('harvest')
    try {
      const tx = await callWithGasPrice(smartFarmsContract, 'harvest', [farm.id])
      const receipt = await tx.wait()
      toastSuccess(t('Harvested'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to harvest PLAX. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, farm.id, refresh, smartFarmsContract, t, toastError, toastSuccess])

  const handleCloseFarm = useCallback(async () => {
    if (!smartFarmsContract) return
    setPendingAction('close')
    try {
      const tx = await callWithGasPrice(smartFarmsContract, 'closeFarm', [farm.id])
      const receipt = await tx.wait()
      toastSuccess(t('Farm Closed'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to close farm. Make sure no LP tokens are staked.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, farm.id, refresh, smartFarmsContract, t, toastError, toastSuccess])

  if (asCard) {
    return (
      <FarmCardShell>
        <FarmCardTop>
          <Flex justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Heading scale="md" color="secondary">
                {t('Earn')} {rewardMetadata.symbol}
              </Heading>
              <Text color="textSubtle">
                {t('Stake')} {lpPairName || stakingMetadata.symbol}
              </Text>
            </Box>
            <LpPairLogo
              stakingToken={farm.stakingToken}
              chainId={chainId}
            />
          </Flex>
        </FarmCardTop>
        <CardBody>
          <Flex justifyContent="space-between" mb="16px">
            <Text bold>{t('APR')}:</Text>
            <Text bold>{apr}</Text>
          </Flex>
          <Text color="secondary" fontSize="12px" bold>
            {rewardMetadata.symbol} {t('Earned')}
          </Text>
          <Flex justifyContent="space-between" alignItems="center" mb="18px" style={{ gap: '12px' }}>
            <Box>
              <Text fontSize="24px" bold>
                {formatCompactAmount(pending, rewardMetadata.decimals, 6)}
              </Text>
              <Text color="textSubtle" fontSize="12px">~0 USD</Text>
            </Box>
            <Button onClick={handleHarvest} disabled={pending.lte(0) || pendingAction === 'harvest'} scale="sm">
              {t('Harvest')}
            </Button>
          </Flex>
          <Text color="secondary" fontSize="12px" bold>
            {t('Staked')} {lpPairName || stakingMetadata.symbol}
          </Text>
          {account && userAmount.gt(0) ? (
            <Flex justifyContent="space-between" alignItems="center" style={{ gap: '8px' }}>
              <Text bold>{formatCompactAmount(userAmount, stakingMetadata.decimals, 6)}</Text>
              <Flex style={{ gap: '8px' }}>
                <Button scale="sm" variant="secondary" onClick={onPresentUnstakeModal}>-</Button>
                <Button scale="sm" onClick={onPresentStakeModal} disabled={!farmIsOpen}>+</Button>
              </Flex>
            </Flex>
          ) : account ? (
            <Button width="100%" onClick={onPresentStakeModal} disabled={!farmIsOpen} scale="sm">
              {farmIsOpen ? t('Stake') : t('Finished')}
            </Button>
          ) : (
            <ConnectWalletButton width="100%" scale="sm" />
          )}
          <Flex justifyContent="space-between" alignItems="center" mt="24px">
            <Button scale="sm" variant="text" onClick={() => setExpanded((c) => !c)}>
              {expanded ? t('Hide') : t('Details')}
            </Button>
            <Text color={farmIsOpen ? 'success' : 'textSubtle'} fontSize="12px" bold>
              {farmIsOpen ? t('Live') : t('Finished')}
            </Text>
          </Flex>
          {expanded ? (
            <Box mt="16px">
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Total staked')}</Text>
                <Text bold>{formatCompactAmount(farm.totalStaked, stakingMetadata.decimals, 3)} {lpPairName || stakingMetadata.symbol}</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Reward left')}</Text>
                <Text bold>{formatCompactAmount(farm.rewardRemaining, rewardMetadata.decimals, 3)} {rewardMetadata.symbol}</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Total reward')}</Text>
                <Text bold>{formatCompactAmount(farm.totalReward, rewardMetadata.decimals, 3)} {rewardMetadata.symbol}</Text>
              </Flex>
              <LinkExternal mt="8px" href={getBlockExploreLink(smartFarmsAddress, 'address', chainId)} bold={false} small>
                {t('View Contract')}
              </LinkExternal>
            </Box>
          ) : null}
        </CardBody>
      </FarmCardShell>
    )
  }

  return (
    <FarmShell>
      <FarmHeader
        $clickable
        flexDirection={['column', null, null, 'row']}
        justifyContent="space-between"
        onClick={() => setExpanded((c) => !c)}
      >
        <Flex alignItems="center" minWidth="180px" style={{ gap: '12px' }}>
          <LpPairLogo
            stakingToken={farm.stakingToken}
            chainId={chainId}
          />
          <Box>
            <Text bold>{t('Earn')} {rewardMetadata.symbol}</Text>
            <Text color="textSubtle" fontSize="12px">{t('Stake')} {lpPairName || stakingMetadata.symbol}</Text>
          </Box>
        </Flex>
        <StatBox>
          <Text color="secondary" fontSize="12px" bold>{rewardMetadata.symbol} {t('Earned')}</Text>
          <Text bold>{formatCompactAmount(pending, rewardMetadata.decimals, 6)}</Text>
          <Text color="textSubtle" fontSize="12px">~0 USD</Text>
        </StatBox>
        <StatBox>
          <Text color="textSubtle" fontSize="12px">{t('Total staked')}</Text>
          <Text bold>{formatCompactAmount(farm.totalStaked, stakingMetadata.decimals, 3)} {lpPairName || stakingMetadata.symbol}</Text>
        </StatBox>
        <StatBox>
          <Text color="textSubtle" fontSize="12px">{t('APR')}</Text>
          <Text bold>{apr}</Text>
        </StatBox>
        <StatBox>
          <Text color="textSubtle" fontSize="12px">{farmIsOpen ? t('Ends in') : t('Status')}</Text>
          <Text bold>{farmIsOpen && farm.totalStaked.gt(0) ? formatDuration(remainingDuration) : farmIsOpen ? t('Waiting') : t('Finished')}</Text>
        </StatBox>
        <Button variant="text" scale="sm">{expanded ? t('Hide') : t('Details')}</Button>
      </FarmHeader>
      {expanded ? (
        <FarmPanel>
          <Flex flexDirection={['column', null, null, 'row']} style={{ gap: '24px' }}>
            <Box minWidth="220px">
              <Flex justifyContent="space-between" mb="6px">
                <Text bold>{t('APR')}:</Text>
                <Text bold>{apr}</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text bold>{t('Reward left')}:</Text>
                <Text bold>{formatCompactAmount(farm.rewardRemaining, rewardMetadata.decimals, 3)} {rewardMetadata.symbol}</Text>
              </Flex>
              <Flex justifyContent="space-between" mb="6px">
                <Text bold>{t('Reward/day')}:</Text>
                <Text bold>{formatCompactAmount(farm.rewardPerSecond.mul(SECONDS_PER_DAY), rewardMetadata.decimals, 3)} {rewardMetadata.symbol}</Text>
              </Flex>
              <LinkExternal href={getBlockExploreLink(smartFarmsAddress, 'address', chainId)} bold={false} small>
                {t('View Contract')}
              </LinkExternal>
              {account?.toLowerCase() === farm.creator.toLowerCase() ? (
                <Button mt="10px" scale="sm" variant="text" onClick={handleCloseFarm}
                  disabled={farm.totalStaked.gt(0) || farm.rewardRemaining.lte(0) || pendingAction === 'close'}
                  endIcon={pendingAction === 'close' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
                >
                  {t('Close Farm')}
                </Button>
              ) : null}
            </Box>
            <ActionBox width="100%">
              <Text color="secondary" fontSize="12px" bold textTransform="uppercase" mb="12px">
                {rewardMetadata.symbol} {t('Earned')}
              </Text>
              <Flex justifyContent="space-between" alignItems="center" style={{ gap: '12px' }}>
                <Box>
                  <Text fontSize="24px" bold>{formatCompactAmount(pending, rewardMetadata.decimals, 6)}</Text>
                  <Text color="textSubtle" fontSize="12px">~0 USD</Text>
                </Box>
                <Button onClick={handleHarvest}
                  disabled={pending.lte(0) || pendingAction === 'harvest'}
                  endIcon={pendingAction === 'harvest' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
                >
                  {t('Harvest')}
                </Button>
              </Flex>
            </ActionBox>
            <ActionBox width="100%">
              <Text color="secondary" fontSize="12px" bold textTransform="uppercase" mb="12px">
                {userAmount.gt(0) ? `${lpPairName || stakingMetadata.symbol} ${t('Staked')}` : `${t('Stake')}`}
              </Text>
              {userAmount.gt(0) ? (
                <Flex justifyContent="space-between" alignItems="center" style={{ gap: '12px' }}>
                  <Box>
                    <Text fontSize="24px" bold>{formatCompactAmount(userAmount, stakingMetadata.decimals, 6)}</Text>
                    <Text color="textSubtle" fontSize="12px">~0 USD</Text>
                  </Box>
                  <Flex style={{ gap: '8px' }}>
                    <Button scale="sm" variant="secondary" onClick={onPresentUnstakeModal}>-</Button>
                    <Button scale="sm" onClick={onPresentStakeModal} disabled={!farmIsOpen}>+</Button>
                  </Flex>
                </Flex>
              ) : !account ? (
                <ConnectWalletButton width="100%" />
              ) : (
                <Button width="100%" variant="secondary" onClick={onPresentStakeModal} disabled={!farmIsOpen}>
                {t('Stake')} {lpPairName || stakingMetadata.symbol}
                </Button>
              )}
            </ActionBox>
          </Flex>
        </FarmPanel>
      ) : null}
    </FarmShell>
  )
}

const SmartFarmsList: React.FC = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const smartFarmsAddress = useMemo(() => getSmartFarmsAddress(chainId), [chainId])
  const hasAddress = Boolean(smartFarmsAddress)
  const smartFarmsContract = useSmartFarmsContract()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [stakedOnly, setStakedOnly] = useState(false)
  const [status, setStatus] = useState<'live' | 'finished'>('live')
  const [sortBy, setSortBy] = useState('hot')
  const [query, setQuery] = useState('')

  const { data: farms, mutate } = useSWR(
    smartFarmsContract && hasAddress ? ['smartFarmsList', smartFarmsAddress] : null,
    async () => {
      const raw = (await smartFarmsContract.getFarms(0, POOLS_PAGE_SIZE)) as any[]
      const PLAX = '0x328801B0b580eAdd83eA841638865eA41Dc6fb25'
      return raw.map((f: any) => ({
        ...f,
        stakingToken: f.lpToken,
        rewardToken: PLAX,
      })) as FarmInfo[]
    },
    { refreshInterval: 15000 },
  )

  const filteredFarms = useMemo(() => {
    const search = query.trim().toLowerCase()
    return (farms ?? [])
      .filter((farm: FarmInfo) => (status === 'live' ? farm.active && farm.rewardRemaining.gt(0) : !farm.active || farm.rewardRemaining.lte(0)))
      .filter((farm: FarmInfo) => !search || `${farm.stakingToken} ${farm.rewardToken}`.toLowerCase().includes(search))
      .filter((farm: FarmInfo) => !stakedOnly || account)
      .sort((a: FarmInfo, b: FarmInfo) => {
        if (sortBy === 'totalStaked') {
          if (a.totalStaked.eq(b.totalStaked)) return 0
          return a.totalStaked.gt(b.totalStaked) ? -1 : 1
        }
        if (a.active !== b.active) return a.active ? -1 : 1
        if (a.id.eq(b.id)) return 0
        return a.id.gt(b.id) ? -1 : 1
      })
  }, [farms, query, sortBy, status, stakedOnly, account])

  if (!hasAddress) {
    return (
      <Message variant="warning">
        <MessageText>{t('Smart Farms contract is not configured for this network yet.')}</MessageText>
      </Message>
    )
  }

  return (
    <>
      <Controls alignItems="center" justifyContent="space-between">
        <Flex alignItems="center" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <ViewButton variant="text" $active={viewMode === 'card'} onClick={() => setViewMode('card')}>
            <CardViewIcon color="currentColor" width="18px" />
          </ViewButton>
          <ViewButton variant="text" $active={viewMode === 'list'} onClick={() => setViewMode('list')}>
            <ListViewIcon color="currentColor" width="18px" />
          </ViewButton>
          <Flex alignItems="center" style={{ gap: '8px' }}>
            <Toggle checked={stakedOnly} onChange={() => setStakedOnly((c) => !c)} scale="sm" />
            <Text bold>{t('Staked only')}</Text>
          </Flex>
          <Button scale="sm" variant={status === 'live' ? 'primary' : 'secondary'} onClick={() => setStatus('live')}>
            {t('Live')}
          </Button>
          <Button scale="sm" variant={status === 'finished' ? 'primary' : 'secondary'} onClick={() => setStatus('finished')}>
            {t('Finished')}
          </Button>
        </Flex>
        <Flex alignItems="center" style={{ gap: '16px', flexWrap: 'wrap' }}>
          <Box>
            <Text fontSize="12px" bold color="textSubtle" mb="4px">{t('SORT BY')}</Text>
            <Select
              options={[
                { label: t('Hot'), value: 'hot' },
                { label: t('Total staked'), value: 'totalStaked' },
              ]}
              onOptionChange={(option) => setSortBy(String(option.value))}
            />
          </Box>
          <Box>
            <Text fontSize="12px" bold color="textSubtle" mb="4px">{t('SEARCH')}</Text>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search by address')} />
          </Box>
        </Flex>
      </Controls>

      {viewMode === 'card' ? (
        <CardGrid>
          {filteredFarms.map((farm: FarmInfo) => (
            <FarmRow key={farm.id.toString()} farm={farm} smartFarmsAddress={smartFarmsAddress} onRefresh={mutate} asCard />
          ))}
        </CardGrid>
      ) : (
        <Flex flexDirection="column" style={{ gap: '0' }}>
          {filteredFarms.map((farm: FarmInfo, index: number) => (
            <FarmRow key={farm.id.toString()} farm={farm} smartFarmsAddress={smartFarmsAddress} onRefresh={mutate} initialExpanded={index === 0} />
          ))}
        </Flex>
      )}

      {!filteredFarms.length ? (
        <Card>
          <CardBody>
            <Text color="textSubtle">{t('No smart farms found.')}</Text>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

const SmartFarmsTabs: React.FC<{ activeView: string }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/smart-farms', label: t('Smart Farms'), view: 'all' },
    { href: '/smart-farms/create', label: t('Create Farm'), view: 'create' },
    { href: '/smart-farms/my-stakes', label: t('My Stakes'), view: 'my-stakes' },
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

const SmartFarms: React.FC = () => {
  const { pathname } = useRouter()
  const view = pathname.includes('/create') ? 'create' : pathname.includes('/my-stakes') ? 'my-stakes' : 'all'

  return (
    <Page>
      <Box maxWidth={view === 'create' ? '720px' : '1100px'} mx="auto" width="100%">
        <SmartFarmsTabs activeView={view} />
        {view === 'create' ? (
          <CreateFarm />
        ) : (
          <SmartFarmsList />
        )}
      </Box>
    </Page>
  )
}

export default SmartFarms
