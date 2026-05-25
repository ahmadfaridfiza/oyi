import { ChangeEvent, useCallback, useMemo, useState } from 'react'
import { BigNumber } from '@ethersproject/bignumber'
import { MaxUint256, Zero } from '@ethersproject/constants'
import { formatUnits, parseUnits } from '@ethersproject/units'
import { useTranslation } from '@pancakeswap/localization'
import {
  AutoRenewIcon,
  Box,
  Button,
  CardViewIcon,
  Card,
  CardBody,
  CopyButton,
  Flex,
  Heading,
  InjectedModalProps,
  Input,
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
import { bscTokens } from '@pancakeswap/tokens'
import ConnectWalletButton from 'components/ConnectWalletButton'
import { ToastDescriptionWithTx } from 'components/Toast'
import { useActiveChainId } from 'hooks/useActiveChainId'
import { useCallWithGasPrice } from 'hooks/useCallWithGasPrice'
import { useSmartPoolsContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import styled from 'styled-components'
import { isAddress } from 'utils'
import { getSmartPoolsAddress } from 'utils/addressHelpers'
import { getTokenLogoURLByAddress } from 'utils/getTokenLogoURL'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type SmartPoolsView = 'create' | 'all' | 'my-stakes' | 'my-pools'
type ViewMode = 'list' | 'card'

type SmartPoolInfo = {
  id: BigNumber
  creator: string
  stakingToken: string
  rewardToken: string
  title: string
  stakingLogoURI: string
  rewardLogoURI: string
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

type UserPoolInfo = {
  amount: BigNumber
  rewardDebt: BigNumber
  unpaidRewards: BigNumber
}

const CREATE_FEE = parseUnits('10', 18)
const POOLS_PAGE_SIZE = 50
const SECONDS_PER_DAY = BigNumber.from(86400)
const SECONDS_PER_YEAR = BigNumber.from(31536000)
const MAX_LOGO_BYTES = 32 * 1024

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

const PoolShell = styled(Box)`
  overflow: hidden;
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.backgroundAlt};
`

const PoolHeader = styled(Flex)<{ $clickable?: boolean }>`
  min-height: 88px;
  gap: 16px;
  padding: 18px 24px;
  cursor: ${({ $clickable }) => ($clickable ? 'pointer' : 'default')};

  ${({ theme }) => theme.mediaQueries.md} {
    align-items: center;
  }
`

const PoolPanel = styled(Box)`
  border-top: 1px solid ${({ theme }) => theme.colors.cardBorder};
  padding: 20px 24px 24px;
`

const StatBox = styled(Box)`
  min-width: 120px;
`

const ActionBox = styled(Box)`
  border: 1px solid ${({ theme }) => theme.colors.cardBorder};
  border-radius: 8px;
  padding: 18px;
`

const CardGrid = styled(Box)`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
`

const SmartPoolCardShell = styled(Card)`
  overflow: hidden;
`

const SmartPoolCardTop = styled(Box)`
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

const LogoUploadBox = styled(Box)`
  border: 1px dashed ${({ theme }) => theme.colors.cardBorder};
  border-radius: 8px;
  padding: 12px;
`

const PercentButton = styled(Button)`
  flex: 1;
  min-width: 64px;
`

const getPoolTitle = (pool: SmartPoolInfo, stakingSymbol: string, rewardSymbol: string) =>
  pool.title || `${rewardSymbol} ${stakingSymbol} Pool`

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

const getEstimatedApr = (pool: SmartPoolInfo, stakingDecimals: number, rewardDecimals: number) => {
  if (pool.totalStaked.lte(0)) return '0.00%'
  const yearlyReward = Number(formatUnits(pool.rewardPerSecond.mul(SECONDS_PER_YEAR), rewardDecimals))
  const totalStaked = Number(formatUnits(pool.totalStaked, stakingDecimals))
  if (!Number.isFinite(yearlyReward) || !Number.isFinite(totalStaked) || totalStaked <= 0) return '0.00%'
  return `${((yearlyReward / totalStaked) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

const useTokenMetadata = (address?: string): TokenMetadata => {
  const tokenContract = useTokenContract(address, false)
  const { data } = useSWR(tokenContract && address ? ['smartPoolsTokenMetadata', address] : null, async () => {
    const [decimals, symbol, name] = await Promise.all([
      tokenContract.decimals().catch(() => 18),
      tokenContract.symbol().catch(() => 'TOKEN'),
      tokenContract.name().catch(() => 'Token'),
    ])
    return { decimals: Number(decimals), symbol: String(symbol), name: String(name) }
  })

  return data ?? { decimals: 18, symbol: 'TOKEN', name: 'Token' }
}

const TokenPairLogo: React.FC<{
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
      <TokenLogo width={size} height={size} srcs={stakingLogo} alt="staking token logo" />
      <RewardLogoBadge>
        <TokenLogo width={24} height={24} srcs={rewardLogo} alt="reward token logo" />
      </RewardLogoBadge>
    </TokenLogoWrap>
  )
}

const LogoInput: React.FC<{
  label: string
  helper: string
  logoURI: string
  onChange: (value: string) => void
}> = ({ label, helper, logoURI, onChange }) => {
  const { t } = useTranslation()
  const { toastError } = useToast()

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      if (file.size > MAX_LOGO_BYTES) {
        toastError(t('Error'), t('Logo file is too large. Please use an image under 32KB.'))
        return
      }

      const reader = new FileReader()
      reader.onload = () => onChange(String(reader.result ?? ''))
      reader.readAsDataURL(file)
    },
    [onChange, t, toastError],
  )

  return (
    <LogoUploadBox>
      <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
        {label}
      </Text>
      <Text color="textSubtle" fontSize="12px" mb="8px">
        {helper}
      </Text>
      <Input value={logoURI} onChange={(event) => onChange(event.target.value)} placeholder="https://.../logo.png" mb="8px" />
      <Input type="file" accept="image/*" onChange={handleFileChange} />
    </LogoUploadBox>
  )
}

const SmartPoolsTabs: React.FC<{ activeView: SmartPoolsView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/smart-pools', label: t('Smart Pools'), view: 'all' },
    { href: '/smart-pools/create', label: t('Create Pool'), view: 'create' },
    { href: '/smart-pools/my-stakes', label: t('My Stakes'), view: 'my-stakes' },
    { href: '/smart-pools/my-pools', label: t('My Pools'), view: 'my-pools' },
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

const CreateSmartPool = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const smartPoolsAddress = useMemo(() => getSmartPoolsAddress(chainId), [chainId])
  const hasSmartPoolsAddress = Boolean(smartPoolsAddress)
  const smartPoolsContract = useSmartPoolsContract()
  const plaxToken = bscTokens.cake
  const plaxContract = useTokenContract(plaxToken.address)

  const [stakingTokenAddress, setStakingTokenAddress] = useState('')
  const [rewardTokenAddress, setRewardTokenAddress] = useState('')
  const [stakingLogoURI, setStakingLogoURI] = useState('')
  const [rewardLogoURI, setRewardLogoURI] = useState('')
  const [rewardAmount, setRewardAmount] = useState('')
  const [rewardPerDay, setRewardPerDay] = useState('')
  const [isApprovingFee, setIsApprovingFee] = useState(false)
  const [isApprovingReward, setIsApprovingReward] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createdPoolId, setCreatedPoolId] = useState('')

  const stakingToken = useMemo(() => isAddress(stakingTokenAddress), [stakingTokenAddress])
  const rewardToken = useMemo(() => isAddress(rewardTokenAddress), [rewardTokenAddress])
  const rewardTokenContract = useTokenContract(rewardToken || undefined)
  const stakingMetadata = useTokenMetadata(stakingToken || undefined)
  const rewardMetadata = useTokenMetadata(rewardToken || undefined)
  const stakingDefaultLogo = getTokenLogoURLByAddress(stakingToken || undefined, chainId)
  const rewardDefaultLogo = getTokenLogoURLByAddress(rewardToken || undefined, chainId)

  const parsedRewardAmount = useMemo(() => {
    if (!rewardAmount) return null
    try {
      return parseUnits(rewardAmount, rewardMetadata.decimals)
    } catch {
      return null
    }
  }, [rewardAmount, rewardMetadata.decimals])

  const parsedRewardPerSecond = useMemo(() => {
    if (!rewardPerDay) return null
    try {
      return parseUnits(rewardPerDay, rewardMetadata.decimals).div(SECONDS_PER_DAY)
    } catch {
      return null
    }
  }, [rewardPerDay, rewardMetadata.decimals])

  const { data: feeAllowance, mutate: refreshFeeAllowance } = useSWR(
    account && plaxContract && hasSmartPoolsAddress ? ['smartPoolsFeeAllowance', account, smartPoolsAddress] : null,
    () => plaxContract.allowance(account, smartPoolsAddress),
  )

  const { data: rewardAllowance, mutate: refreshRewardAllowance } = useSWR(
    account && rewardTokenContract && rewardToken && hasSmartPoolsAddress
      ? ['smartPoolsRewardAllowance', account, rewardToken, smartPoolsAddress]
      : null,
    () => rewardTokenContract.allowance(account, smartPoolsAddress),
  )

  const isFeeApproved = feeAllowance ? BigNumber.from(feeAllowance).gte(CREATE_FEE) : false
  const isRewardApproved =
    parsedRewardAmount && rewardAllowance ? BigNumber.from(rewardAllowance).gte(parsedRewardAmount) : false
  const estimatedDuration =
    parsedRewardAmount && parsedRewardPerSecond?.gt(0) ? parsedRewardAmount.div(parsedRewardPerSecond) : null

  const canCreate =
    Boolean(account) &&
    Boolean(smartPoolsContract) &&
    hasSmartPoolsAddress &&
    Boolean(stakingToken) &&
    Boolean(rewardToken) &&
    parsedRewardAmount?.gt(0) &&
    parsedRewardPerSecond?.gt(0)

  const handleApproveFee = useCallback(async () => {
    if (!plaxContract || !hasSmartPoolsAddress) return

    setIsApprovingFee(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [smartPoolsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Contract Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshFeeAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApprovingFee(false)
    }
  }, [callWithGasPrice, hasSmartPoolsAddress, plaxContract, refreshFeeAllowance, smartPoolsAddress, t, toastError, toastSuccess])

  const handleApproveReward = useCallback(async () => {
    if (!rewardTokenContract || !hasSmartPoolsAddress) return

    setIsApprovingReward(true)
    try {
      const tx = await callWithGasPrice(rewardTokenContract, 'approve', [smartPoolsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Reward Token Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshRewardAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve reward token. Please try again.'))
    } finally {
      setIsApprovingReward(false)
    }
  }, [
    callWithGasPrice,
    hasSmartPoolsAddress,
    refreshRewardAllowance,
    rewardTokenContract,
    smartPoolsAddress,
    t,
    toastError,
    toastSuccess,
  ])

  const handleCreatePool = useCallback(async () => {
    if (!smartPoolsContract || !stakingToken || !rewardToken || !parsedRewardAmount || !parsedRewardPerSecond || !canCreate) {
      return
    }

    setIsCreating(true)
    setCreatedPoolId('')
    try {
      const tx = await callWithGasPrice(smartPoolsContract, 'createPool', [
        stakingToken,
        rewardToken,
        '',
        stakingLogoURI.trim(),
        rewardLogoURI.trim(),
        parsedRewardAmount,
        parsedRewardPerSecond,
      ])
      const receipt = await tx.wait()
      const createdEvent = receipt.logs
        .map((log) => {
          try {
            return smartPoolsContract.interface.parseLog(log)
          } catch {
            return null
          }
        })
        .find((event) => event?.name === 'PoolCreated')

      if (createdEvent?.args?.id) {
        setCreatedPoolId(createdEvent.args.id.toString())
      }

      toastSuccess(t('Smart Pool Created'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshFeeAllowance()
      refreshRewardAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to create smart pool. Please check your inputs and try again.'))
    } finally {
      setIsCreating(false)
    }
  }, [
    callWithGasPrice,
    canCreate,
    parsedRewardAmount,
    parsedRewardPerSecond,
    refreshFeeAllowance,
    refreshRewardAllowance,
    rewardLogoURI,
    rewardToken,
    smartPoolsContract,
    stakingLogoURI,
    stakingToken,
    t,
    toastError,
    toastSuccess,
  ])

  return (
    <Card>
      <CardBody>
        <Flex alignItems="center" justifyContent="space-between" mb="20px" style={{ gap: '16px' }}>
          <Box>
            <Heading scale="lg">{t('Create Smart Pool')}</Heading>
            <Text color="textSubtle">
              {t('Single token staking with a %fee% PLAX creation fee.', { fee: formatUnits(CREATE_FEE, 18) })}
            </Text>
          </Box>
          <TokenPairLogo
            stakingToken={stakingToken || undefined}
            rewardToken={rewardToken || undefined}
            stakingLogoURI={stakingLogoURI}
            rewardLogoURI={rewardLogoURI}
            chainId={chainId}
          />
        </Flex>

        {!hasSmartPoolsAddress ? (
          <Message variant="warning" mb="24px">
            <MessageText>{t('Smart Pools contract address is not configured for this network yet.')}</MessageText>
          </Message>
        ) : null}

        <Flex flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
          <Box width="100%">
            <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
              {t('Staking Token Address')}
            </Text>
            <Input value={stakingTokenAddress} onChange={(event) => setStakingTokenAddress(event.target.value)} placeholder="0x..." />
            {stakingToken ? (
              <Text color="textSubtle" fontSize="12px" mt="4px">
                {t('Detected: %name% (%symbol%, %decimals% decimals)', {
                  name: stakingMetadata.name,
                  symbol: stakingMetadata.symbol,
                  decimals: stakingMetadata.decimals,
                })}
              </Text>
            ) : null}
          </Box>
          <Box width="100%">
            <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
              {t('Reward Token Address')}
            </Text>
            <Input value={rewardTokenAddress} onChange={(event) => setRewardTokenAddress(event.target.value)} placeholder="0x..." />
            {rewardToken ? (
              <Text color="textSubtle" fontSize="12px" mt="4px">
                {t('Detected: %name% (%symbol%, %decimals% decimals)', {
                  name: rewardMetadata.name,
                  symbol: rewardMetadata.symbol,
                  decimals: rewardMetadata.decimals,
                })}
              </Text>
            ) : null}
          </Box>
        </Flex>

        {!stakingDefaultLogo || !rewardDefaultLogo ? (
          <Flex my="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
            {!stakingDefaultLogo ? (
              <LogoInput
                label={t('Staking Token Logo')}
                helper={t('Upload a small logo or paste an image URL.')}
                logoURI={stakingLogoURI}
                onChange={setStakingLogoURI}
              />
            ) : null}
            {!rewardDefaultLogo ? (
              <LogoInput
                label={t('Reward Token Logo')}
                helper={t('Upload a small logo or paste an image URL.')}
                logoURI={rewardLogoURI}
                onChange={setRewardLogoURI}
              />
            ) : null}
          </Flex>
        ) : null}

        <Flex mb="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
          <Box width="100%" style={{ flex: 1 }}>
            <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
              {t('Total Reward')}
            </Text>
            <Input inputMode="decimal" value={rewardAmount} onChange={(event) => setRewardAmount(event.target.value)} placeholder="0.0" />
          </Box>
          <Box width="100%" style={{ flex: 1 }}>
            <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
              {t('Reward Per Day')}
            </Text>
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
            disabled={!hasSmartPoolsAddress || isApprovingFee}
            endIcon={isApprovingFee ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable PLAX')}
          </Button>
        ) : !isRewardApproved ? (
          <Button
            width="100%"
            onClick={handleApproveReward}
            disabled={!canCreate || isApprovingReward}
            endIcon={isApprovingReward ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable Reward Token')}
          </Button>
        ) : (
          <Button
            width="100%"
            onClick={handleCreatePool}
            disabled={!canCreate || isCreating}
            endIcon={isCreating ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Create Pool')}
          </Button>
        )}

        {createdPoolId ? (
          <Message variant="success" mt="24px">
            <MessageText>{t('Created smart pool ID: %id%', { id: createdPoolId })}</MessageText>
          </Message>
        ) : null}
      </CardBody>
    </Card>
  )
}

const SmartStakeModal: React.FC<
  InjectedModalProps & {
    pool: SmartPoolInfo
    mode: 'stake' | 'unstake'
    smartPoolsAddress: string
    stakingMetadata: TokenMetadata
    rewardMetadata: TokenMetadata
    maxAmount: BigNumber
    allowance?: BigNumber
    onRefresh: () => void
  }
> = ({ pool, mode, smartPoolsAddress, stakingMetadata, rewardMetadata, maxAmount, allowance, onDismiss, onRefresh }) => {
  const { t } = useTranslation()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const { chainId } = useActiveChainId()
  const smartPoolsContract = useSmartPoolsContract()
  const stakingTokenContract = useTokenContract(pool.stakingToken)
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
      const tx = await callWithGasPrice(stakingTokenContract, 'approve', [smartPoolsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Staking Token Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      onRefresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve staking token. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, onRefresh, smartPoolsAddress, stakingTokenContract, t, toastError, toastSuccess])

  const handleConfirm = useCallback(async () => {
    if (!smartPoolsContract || !parsedAmount?.gt(0)) return

    setPendingAction(mode)
    try {
      const tx = await callWithGasPrice(smartPoolsContract, mode === 'stake' ? 'deposit' : 'withdraw', [pool.id, parsedAmount])
      const receipt = await tx.wait()
      toastSuccess(mode === 'stake' ? t('Staked') : t('Unstaked'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      onRefresh()
      onDismiss?.()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), mode === 'stake' ? t('Unable to stake. Please try again.') : t('Unable to unstake. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, mode, onDismiss, onRefresh, parsedAmount, pool.id, smartPoolsContract, t, toastError, toastSuccess])

  return (
    <Modal title={mode === 'stake' ? t('Stake in Pool') : t('Unstake')} onDismiss={onDismiss}>
      <Box width={['100%', '100%', '360px']}>
        <Flex justifyContent="space-between" alignItems="center" mb="16px">
          <Text bold>{mode === 'stake' ? t('Stake') : t('Unstake')}:</Text>
          <Flex alignItems="center" style={{ gap: '8px' }}>
            <TokenPairLogo
              stakingToken={pool.stakingToken}
              rewardToken={pool.rewardToken}
              stakingLogoURI={pool.stakingLogoURI}
              rewardLogoURI={pool.rewardLogoURI}
              chainId={chainId}
              size={28}
            />
            <Text bold>{stakingMetadata.symbol}</Text>
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
            ? t('Harvested %symbol% rewards are also sent to your wallet when you unstake.', {
                symbol: rewardMetadata.symbol,
              })
            : t('Your stake will start earning rewards while this pool still has reward balance.')}
        </Text>
        {needsApproval ? (
          <Button
            width="100%"
            onClick={handleApprove}
            disabled={pendingAction === 'approve'}
            endIcon={pendingAction === 'approve' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
          >
            {t('Enable')}
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

const SmartPoolRow: React.FC<{
  pool: SmartPoolInfo
  smartPoolsAddress: string
  onRefresh: () => void
  initialExpanded?: boolean
  asCard?: boolean
}> = ({ pool, smartPoolsAddress, onRefresh, initialExpanded = false, asCard = false }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const { chainId } = useActiveChainId()
  const smartPoolsContract = useSmartPoolsContract()
  const stakingTokenContract = useTokenContract(pool.stakingToken)
  const stakingMetadata = useTokenMetadata(pool.stakingToken)
  const rewardMetadata = useTokenMetadata(pool.rewardToken)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [pendingAction, setPendingAction] = useState('')

  const { data: userInfo, mutate: refreshUserInfo } = useSWR(
    account && smartPoolsContract ? ['smartPoolsUserInfo', pool.id.toString(), account] : null,
    () => smartPoolsContract.userInfo(pool.id, account) as Promise<UserPoolInfo>,
  )

  const { data: pendingReward, mutate: refreshPendingReward } = useSWR(
    account && smartPoolsContract ? ['smartPoolsPendingReward', pool.id.toString(), account] : null,
    () => smartPoolsContract.pendingReward(pool.id, account) as Promise<BigNumber>,
    { refreshInterval: 10000 },
  )

  const { data: stakingAllowance, mutate: refreshStakingAllowance } = useSWR(
    account && stakingTokenContract ? ['smartPoolsStakingAllowance', pool.id.toString(), account, smartPoolsAddress] : null,
    () => stakingTokenContract.allowance(account, smartPoolsAddress),
  )

  const { data: stakingBalance, mutate: refreshStakingBalance } = useSWR(
    account && stakingTokenContract ? ['smartPoolsStakingBalance', pool.id.toString(), account] : null,
    () => stakingTokenContract.balanceOf(account),
  )

  const userAmount = userInfo?.amount ? BigNumber.from(userInfo.amount) : Zero
  const pending = pendingReward ?? Zero
  const userBalance = stakingBalance ? BigNumber.from(stakingBalance) : Zero
  const allowance = stakingAllowance ? BigNumber.from(stakingAllowance) : Zero
  const remainingDuration = pool.rewardPerSecond.gt(0) ? pool.rewardRemaining.div(pool.rewardPerSecond) : null
  const poolIsOpen = pool.active && pool.rewardRemaining.gt(0)
  const apr = getEstimatedApr(pool, stakingMetadata.decimals, rewardMetadata.decimals)
  const title = getPoolTitle(pool, stakingMetadata.symbol, rewardMetadata.symbol)

  const refresh = useCallback(() => {
    onRefresh()
    refreshUserInfo()
    refreshPendingReward()
    refreshStakingAllowance()
    refreshStakingBalance()
  }, [onRefresh, refreshPendingReward, refreshStakingAllowance, refreshStakingBalance, refreshUserInfo])

  const [onPresentStakeModal] = useModal(
    <SmartStakeModal
      pool={pool}
      mode="stake"
      smartPoolsAddress={smartPoolsAddress}
      stakingMetadata={stakingMetadata}
      rewardMetadata={rewardMetadata}
      maxAmount={userBalance}
      allowance={allowance}
      onRefresh={refresh}
    />,
  )
  const [onPresentUnstakeModal] = useModal(
    <SmartStakeModal
      pool={pool}
      mode="unstake"
      smartPoolsAddress={smartPoolsAddress}
      stakingMetadata={stakingMetadata}
      rewardMetadata={rewardMetadata}
      maxAmount={userAmount}
      onRefresh={refresh}
    />,
  )

  const handleHarvest = useCallback(async () => {
    if (!smartPoolsContract) return

    setPendingAction('harvest')
    try {
      const tx = await callWithGasPrice(smartPoolsContract, 'harvest', [pool.id])
      const receipt = await tx.wait()
      toastSuccess(t('Harvested'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to harvest. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, pool.id, refresh, smartPoolsContract, t, toastError, toastSuccess])

  const handleClosePool = useCallback(async () => {
    if (!smartPoolsContract) return

    setPendingAction('close')
    try {
      const tx = await callWithGasPrice(smartPoolsContract, 'closePool', [pool.id])
      const receipt = await tx.wait()
      toastSuccess(t('Pool Closed'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to close pool. Make sure no tokens are staked.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, pool.id, refresh, smartPoolsContract, t, toastError, toastSuccess])

  const header = (
    <PoolHeader
      $clickable
      flexDirection={['column', null, null, 'row']}
      justifyContent="space-between"
      onClick={() => setExpanded((current) => !current)}
    >
      <Flex alignItems="center" minWidth="180px" style={{ gap: '12px' }}>
        <TokenPairLogo
          stakingToken={pool.stakingToken}
          rewardToken={pool.rewardToken}
          stakingLogoURI={pool.stakingLogoURI}
          rewardLogoURI={pool.rewardLogoURI}
          chainId={chainId}
        />
        <Box>
          <Text bold>{t('Earn')} {rewardMetadata.symbol}</Text>
          <Text color="textSubtle" fontSize="12px">
            {t('Stake')} {stakingMetadata.symbol}
          </Text>
        </Box>
      </Flex>
      <StatBox>
        <Text color="secondary" fontSize="12px" bold>
          {rewardMetadata.symbol} {t('Earned')}
        </Text>
        <Text bold>{formatCompactAmount(pending, rewardMetadata.decimals, 6)}</Text>
        <Text color="textSubtle" fontSize="12px">
          ~0 USD
        </Text>
      </StatBox>
      <StatBox>
        <Text color="textSubtle" fontSize="12px">
          {t('Total staked')}
        </Text>
        <Text bold>
          {formatCompactAmount(pool.totalStaked, stakingMetadata.decimals, 3)} {stakingMetadata.symbol}
        </Text>
      </StatBox>
      <StatBox>
        <Text color="textSubtle" fontSize="12px">
          {t('APR')}
        </Text>
        <Text bold>{apr}</Text>
      </StatBox>
      <StatBox>
        <Text color="textSubtle" fontSize="12px">
          {poolIsOpen ? t('Ends in') : t('Status')}
        </Text>
        <Text bold>{poolIsOpen && pool.totalStaked.gt(0) ? formatDuration(remainingDuration) : poolIsOpen ? t('Waiting') : t('Finished')}</Text>
      </StatBox>
      <Button variant="text" scale="sm">
        {expanded ? t('Hide') : t('Details')}
      </Button>
    </PoolHeader>
  )

  const panel = (
    <PoolPanel>
      <Flex flexDirection={['column', null, null, 'row']} style={{ gap: '24px' }}>
        <Box minWidth="220px">
          <Flex justifyContent="space-between" mb="6px">
            <Text bold>{t('APR')}:</Text>
            <Text bold>{apr}</Text>
          </Flex>
          <Flex justifyContent="space-between" mb="6px">
            <Text bold>{t('Reward left')}:</Text>
            <Text bold>
              {formatCompactAmount(pool.rewardRemaining, rewardMetadata.decimals, 3)} {rewardMetadata.symbol}
            </Text>
          </Flex>
          <Flex justifyContent="space-between" mb="6px">
            <Text bold>{t('Reward/day')}:</Text>
            <Text bold>
              {formatCompactAmount(pool.rewardPerSecond.mul(SECONDS_PER_DAY), rewardMetadata.decimals, 3)} {rewardMetadata.symbol}
            </Text>
          </Flex>
          <Flex alignItems="center" style={{ gap: '6px', flexWrap: 'wrap' }}>
            <Text color="primary" fontSize="13px">
              {t('View Contract')}
            </Text>
            <CopyButton width="16px" buttonColor="primary" text={pool.stakingToken} tooltipMessage={t('Address copied')} />
          </Flex>
          {account?.toLowerCase() === pool.creator.toLowerCase() ? (
            <Button
              mt="10px"
              scale="sm"
              variant="text"
              onClick={handleClosePool}
              disabled={pool.totalStaked.gt(0) || pool.rewardRemaining.lte(0) || pendingAction === 'close'}
              endIcon={pendingAction === 'close' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
            >
              {t('Close Pool')}
            </Button>
          ) : null}
        </Box>
        <ActionBox width="100%">
          <Text color="secondary" fontSize="12px" bold textTransform="uppercase" mb="12px">
            {rewardMetadata.symbol} {t('Earned')}
          </Text>
          <Flex justifyContent="space-between" alignItems="center" style={{ gap: '12px' }}>
            <Box>
              <Text fontSize="24px" bold>
                {formatCompactAmount(pending, rewardMetadata.decimals, 6)}
              </Text>
              <Text color="textSubtle" fontSize="12px">
                ~0 USD
              </Text>
            </Box>
            <Button
              onClick={handleHarvest}
              disabled={pending.lte(0) || pendingAction === 'harvest'}
              endIcon={pendingAction === 'harvest' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
            >
              {t('Harvest')}
            </Button>
          </Flex>
        </ActionBox>
        <ActionBox width="100%">
          <Text color="secondary" fontSize="12px" bold textTransform="uppercase" mb="12px">
            {userAmount.gt(0) ? `${stakingMetadata.symbol} ${t('Staked')}` : `${t('Stake')} ${stakingMetadata.symbol}`}
          </Text>
          {userAmount.gt(0) ? (
            <Flex justifyContent="space-between" alignItems="center" style={{ gap: '12px' }}>
              <Box>
                <Text fontSize="24px" bold>
                  {formatCompactAmount(userAmount, stakingMetadata.decimals, 6)}
                </Text>
                <Text color="textSubtle" fontSize="12px">
                  ~0 USD
                </Text>
              </Box>
              <Flex style={{ gap: '8px' }}>
                <Button scale="sm" variant="secondary" onClick={onPresentUnstakeModal}>
                  -
                </Button>
                <Button scale="sm" onClick={onPresentStakeModal} disabled={!poolIsOpen}>
                  +
                </Button>
              </Flex>
            </Flex>
          ) : !account ? (
            <ConnectWalletButton width="100%" />
          ) : (
            <Button width="100%" variant="secondary" onClick={onPresentStakeModal} disabled={!poolIsOpen}>
              {t('Stake')}
            </Button>
          )}
        </ActionBox>
      </Flex>
    </PoolPanel>
  )

  if (asCard) {
    return (
      <SmartPoolCardShell>
        <SmartPoolCardTop>
          <Flex justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Heading scale="md" color="secondary">
                {title}
              </Heading>
              <Text color="textSubtle">
                {t('Stake')} {stakingMetadata.symbol}
              </Text>
            </Box>
            <TokenPairLogo
              stakingToken={pool.stakingToken}
              rewardToken={pool.rewardToken}
              stakingLogoURI={pool.stakingLogoURI}
              rewardLogoURI={pool.rewardLogoURI}
              chainId={chainId}
            />
          </Flex>
        </SmartPoolCardTop>
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
              <Text color="textSubtle" fontSize="12px">
                ~0 USD
              </Text>
            </Box>
            <Button onClick={handleHarvest} disabled={pending.lte(0) || pendingAction === 'harvest'}>
              {t('Harvest')}
            </Button>
          </Flex>
          <Text color="secondary" fontSize="12px" bold>
            {t('Stake')} {stakingMetadata.symbol}
          </Text>
          {account && userAmount.gt(0) ? (
            <Flex justifyContent="space-between" alignItems="center" style={{ gap: '8px' }}>
              <Text bold>{formatCompactAmount(userAmount, stakingMetadata.decimals, 6)}</Text>
              <Flex style={{ gap: '8px' }}>
                <Button scale="sm" variant="secondary" onClick={onPresentUnstakeModal}>
                  -
                </Button>
                <Button scale="sm" onClick={onPresentStakeModal} disabled={!poolIsOpen}>
                  +
                </Button>
              </Flex>
            </Flex>
          ) : account ? (
            <Button width="100%" onClick={onPresentStakeModal} disabled={!poolIsOpen}>
              {poolIsOpen ? t('Stake') : t('Finished')}
            </Button>
          ) : (
            <ConnectWalletButton width="100%" />
          )}
          <Flex justifyContent="space-between" alignItems="center" mt="24px">
            <Button scale="sm" variant="text" onClick={() => setExpanded((current) => !current)}>
              {expanded ? t('Hide') : t('Details')}
            </Button>
            <Text color={poolIsOpen ? 'success' : 'textSubtle'} fontSize="12px" bold>
              {poolIsOpen ? t('Live') : t('Finished')}
            </Text>
          </Flex>
          {expanded ? (
            <Box mt="16px">
              <Flex justifyContent="space-between" mb="6px">
                <Text color="textSubtle">{t('Total staked')}</Text>
                <Text bold>
                  {formatCompactAmount(pool.totalStaked, stakingMetadata.decimals, 3)} {stakingMetadata.symbol}
                </Text>
              </Flex>
              <Flex justifyContent="space-between">
                <Text color="textSubtle">{t('Reward left')}</Text>
                <Text bold>
                  {formatCompactAmount(pool.rewardRemaining, rewardMetadata.decimals, 3)} {rewardMetadata.symbol}
                </Text>
              </Flex>
            </Box>
          ) : null}
        </CardBody>
      </SmartPoolCardShell>
    )
  }

  return (
    <PoolShell>
      {header}
      {expanded ? panel : null}
    </PoolShell>
  )
}

const SmartPoolsList: React.FC<{ view: Exclude<SmartPoolsView, 'create'> }> = ({ view }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const smartPoolsAddress = useMemo(() => getSmartPoolsAddress(chainId), [chainId])
  const hasSmartPoolsAddress = Boolean(smartPoolsAddress)
  const smartPoolsContract = useSmartPoolsContract()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [stakedOnly, setStakedOnly] = useState(view === 'my-stakes')
  const [status, setStatus] = useState<'live' | 'finished'>('live')
  const [sortBy, setSortBy] = useState('hot')
  const [query, setQuery] = useState('')
  const shouldFetchUserPools = view === 'my-stakes' || (view === 'all' && stakedOnly)

  const { data: pools, mutate } = useSWR(
    smartPoolsContract && hasSmartPoolsAddress && (view === 'all' || account) && (!shouldFetchUserPools || account)
      ? ['smartPoolsList', view, stakedOnly, account, smartPoolsAddress]
      : null,
    () => {
      if (shouldFetchUserPools) {
        return smartPoolsContract.getPoolsByStaker(account, 0, POOLS_PAGE_SIZE)
      }
      if (view === 'my-pools') {
        return smartPoolsContract.getPoolsByCreator(account, 0, POOLS_PAGE_SIZE)
      }
      return smartPoolsContract.getPools(0, POOLS_PAGE_SIZE)
    },
    { refreshInterval: 15000 },
  )

  const filteredPools = useMemo(() => {
    const search = query.trim().toLowerCase()
    return (pools ?? [])
      .filter((pool: SmartPoolInfo) => (status === 'live' ? pool.active && pool.rewardRemaining.gt(0) : !pool.active || pool.rewardRemaining.lte(0)))
      .filter((pool: SmartPoolInfo) => !search || `${pool.title} ${pool.stakingToken} ${pool.rewardToken}`.toLowerCase().includes(search))
      .sort((a: SmartPoolInfo, b: SmartPoolInfo) => {
        if (sortBy === 'totalStaked') {
          if (a.totalStaked.eq(b.totalStaked)) return 0
          return a.totalStaked.gt(b.totalStaked) ? -1 : 1
        }
        if (a.active !== b.active) return a.active ? -1 : 1
        if (a.id.eq(b.id)) return 0
        return a.id.gt(b.id) ? -1 : 1
      })
  }, [pools, query, sortBy, status])

  if (!hasSmartPoolsAddress) {
    return (
      <Message variant="warning">
        <MessageText>{t('Smart Pools contract address is not configured for this network yet.')}</MessageText>
      </Message>
    )
  }

  if (view !== 'all' && !account) {
    return <ConnectWalletButton />
  }

  if (view === 'all' && stakedOnly && !account) {
    return <ConnectWalletButton />
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
            <Toggle checked={stakedOnly} onChange={() => setStakedOnly((current) => !current)} scale="sm" />
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
            <Text fontSize="12px" bold color="textSubtle" mb="4px">
              {t('SORT BY')}
            </Text>
            <Select
              options={[
                { label: t('Hot'), value: 'hot' },
                { label: t('Total staked'), value: 'totalStaked' },
              ]}
              onOptionChange={(option) => setSortBy(String(option.value))}
            />
          </Box>
          <Box>
            <Text fontSize="12px" bold color="textSubtle" mb="4px">
              {t('SEARCH')}
            </Text>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search Pools')} />
          </Box>
        </Flex>
      </Controls>

      {viewMode === 'card' ? (
        <CardGrid>
          {filteredPools.map((pool: SmartPoolInfo) => (
            <SmartPoolRow key={pool.id.toString()} pool={pool} smartPoolsAddress={smartPoolsAddress} onRefresh={mutate} asCard />
          ))}
        </CardGrid>
      ) : (
        <Flex flexDirection="column" style={{ gap: '0' }}>
          {filteredPools.map((pool: SmartPoolInfo, index: number) => (
            <SmartPoolRow
              key={pool.id.toString()}
              pool={pool}
              smartPoolsAddress={smartPoolsAddress}
              onRefresh={mutate}
              initialExpanded={index === 0}
            />
          ))}
        </Flex>
      )}

      {!filteredPools.length ? (
        <Card>
          <CardBody>
            <Text color="textSubtle">{t('No smart pools found.')}</Text>
          </CardBody>
        </Card>
      ) : null}
    </>
  )
}

const SmartPools: React.FC<{ view: SmartPoolsView }> = ({ view }) => {
  return (
    <Page>
      <Box maxWidth={view === 'create' ? '720px' : '1100px'} mx="auto" width="100%">
        <SmartPoolsTabs activeView={view} />
        {view === 'create' ? <CreateSmartPool /> : <SmartPoolsList view={view} />}
      </Box>
    </Page>
  )
}

export default SmartPools
