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
  CopyButton,
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
import { useSmartPoolsContract, useTokenContract } from 'hooks/useContract'
import useSWR from 'swr'
import { isAddress } from 'utils'
import { getSmartPoolsAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

type SmartPoolsView = 'create' | 'all' | 'my-stakes' | 'my-pools'

type SmartPoolInfo = {
  id: BigNumber
  creator: string
  stakingToken: string
  rewardToken: string
  title: string
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

const getPoolTitle = (pool: SmartPoolInfo, stakingSymbol: string, rewardSymbol: string) =>
  pool.title || `${stakingSymbol} earn ${rewardSymbol}`

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
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h`
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

const SmartPoolsTabs: React.FC<{ activeView: SmartPoolsView }> = ({ activeView }) => {
  const { t } = useTranslation()
  const links = [
    { href: '/smart-pools', label: t('All Pools'), view: 'all' },
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
  const [title, setTitle] = useState('')
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
        title.trim(),
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
    rewardToken,
    smartPoolsContract,
    stakingToken,
    t,
    title,
    toastError,
    toastSuccess,
  ])

  return (
    <Card>
      <CardBody>
        <Heading scale="lg" mb="8px">
          {t('Create Smart Pool')}
        </Heading>
        <Text color="textSubtle" mb="24px">
          {t('Create a single-token staking pool with a %fee% PLAX creation fee.', { fee: formatUnits(CREATE_FEE, 18) })}
        </Text>

        {!hasSmartPoolsAddress ? (
          <Message variant="warning" mb="24px">
            <MessageText>{t('Smart Pools contract address is not configured for this network yet.')}</MessageText>
          </Message>
        ) : null}

        <Box mb="16px">
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

        <Box mb="16px">
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

        <Box mb="16px">
          <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
            {t('Pool Title')}
          </Text>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('Optional')} />
        </Box>

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

const SmartPoolRow: React.FC<{
  pool: SmartPoolInfo
  smartPoolsAddress: string
  onRefresh: () => void
}> = ({ pool, smartPoolsAddress, onRefresh }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()
  const smartPoolsContract = useSmartPoolsContract()
  const stakingTokenContract = useTokenContract(pool.stakingToken)
  const stakingMetadata = useTokenMetadata(pool.stakingToken)
  const rewardMetadata = useTokenMetadata(pool.rewardToken)
  const [stakeAmount, setStakeAmount] = useState('')
  const [pendingAction, setPendingAction] = useState('')

  const parsedStakeAmount = useMemo(() => {
    if (!stakeAmount) return null
    try {
      return parseUnits(stakeAmount, stakingMetadata.decimals)
    } catch {
      return null
    }
  }, [stakeAmount, stakingMetadata.decimals])

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

  const userAmount = userInfo?.amount ? BigNumber.from(userInfo.amount) : Zero
  const isStakeApproved =
    parsedStakeAmount && stakingAllowance ? BigNumber.from(stakingAllowance).gte(parsedStakeAmount) : false
  const remainingDuration = pool.rewardPerSecond.gt(0) ? pool.rewardRemaining.div(pool.rewardPerSecond) : null
  const poolIsOpen = pool.active && pool.rewardRemaining.gt(0)

  const refresh = useCallback(() => {
    onRefresh()
    refreshUserInfo()
    refreshPendingReward()
    refreshStakingAllowance()
  }, [onRefresh, refreshPendingReward, refreshStakingAllowance, refreshUserInfo])

  const handleApproveStake = useCallback(async () => {
    if (!stakingTokenContract) return

    setPendingAction('approve')
    try {
      const tx = await callWithGasPrice(stakingTokenContract, 'approve', [smartPoolsAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Staking Token Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshStakingAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve staking token. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, refreshStakingAllowance, smartPoolsAddress, stakingTokenContract, t, toastError, toastSuccess])

  const handleDeposit = useCallback(async () => {
    if (!smartPoolsContract || !parsedStakeAmount?.gt(0)) return

    setPendingAction('stake')
    try {
      const tx = await callWithGasPrice(smartPoolsContract, 'deposit', [pool.id, parsedStakeAmount])
      const receipt = await tx.wait()
      toastSuccess(t('Staked'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      setStakeAmount('')
      refresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to stake. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, parsedStakeAmount, pool.id, refresh, smartPoolsContract, t, toastError, toastSuccess])

  const handleWithdrawAll = useCallback(async () => {
    if (!smartPoolsContract || userAmount.lte(0)) return

    setPendingAction('withdraw')
    try {
      const tx = await callWithGasPrice(smartPoolsContract, 'withdraw', [pool.id, userAmount])
      const receipt = await tx.wait()
      toastSuccess(t('Unstaked'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refresh()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to unstake. Please try again.'))
    } finally {
      setPendingAction('')
    }
  }, [callWithGasPrice, pool.id, refresh, smartPoolsContract, t, toastError, toastSuccess, userAmount])

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

  return (
    <Box p="16px" border="1px solid" borderColor="cardBorder" borderRadius="8px">
      <Flex justifyContent="space-between" alignItems="flex-start" mb="12px" style={{ gap: '12px' }}>
        <Box>
          <Text bold>{getPoolTitle(pool, stakingMetadata.symbol, rewardMetadata.symbol)}</Text>
          <Text color="textSubtle" fontSize="12px">
            {stakingMetadata.symbol} earn {rewardMetadata.symbol}
          </Text>
        </Box>
        <Text fontSize="12px" color={poolIsOpen ? 'success' : 'textSubtle'} bold>
          {poolIsOpen ? t('Active') : t('No reward left')}
        </Text>
      </Flex>

      <Flex alignItems="center" style={{ gap: '6px', flexWrap: 'wrap' }} mb="12px">
        <Text color="textSubtle" fontSize="12px">
          {t('Stake')}: {pool.stakingToken}
        </Text>
        <CopyButton width="16px" buttonColor="textSubtle" text={pool.stakingToken} tooltipMessage={t('Address copied')} />
      </Flex>

      <Flex flexDirection={['column', null, 'row']} style={{ gap: '12px' }} mb="16px">
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Total staked')}
          </Text>
          <Text>
            {formatUnits(pool.totalStaked, stakingMetadata.decimals)} {stakingMetadata.symbol}
          </Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Reward left')}
          </Text>
          <Text>
            {formatUnits(pool.rewardRemaining, rewardMetadata.decimals)} {rewardMetadata.symbol}
          </Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Reward per day')}
          </Text>
          <Text>
            {formatUnits(pool.rewardPerSecond.mul(SECONDS_PER_DAY), rewardMetadata.decimals)} {rewardMetadata.symbol}
          </Text>
        </Box>
        <Box width="100%">
          <Text color="textSubtle" fontSize="12px">
            {t('Remaining')}
          </Text>
          <Text>{pool.totalStaked.gt(0) ? formatDuration(remainingDuration) : t('Waiting for stakers')}</Text>
        </Box>
      </Flex>

      {account ? (
        <>
          <Flex flexDirection={['column', null, 'row']} style={{ gap: '12px' }} mb="16px">
            <Box width="100%">
              <Text color="textSubtle" fontSize="12px">
                {t('Your stake')}
              </Text>
              <Text>
                {formatUnits(userAmount, stakingMetadata.decimals)} {stakingMetadata.symbol}
              </Text>
            </Box>
            <Box width="100%">
              <Text color="textSubtle" fontSize="12px">
                {t('Earned')}
              </Text>
              <Text>
                {formatUnits(pendingReward ?? Zero, rewardMetadata.decimals)} {rewardMetadata.symbol}
              </Text>
            </Box>
          </Flex>

          <Flex flexDirection={['column', null, 'row']} style={{ gap: '8px' }}>
            <Input
              inputMode="decimal"
              value={stakeAmount}
              onChange={(event) => setStakeAmount(event.target.value)}
              placeholder={`0.0 ${stakingMetadata.symbol}`}
              disabled={!poolIsOpen}
            />
            {!isStakeApproved ? (
              <Button
                onClick={handleApproveStake}
                disabled={!parsedStakeAmount?.gt(0) || pendingAction === 'approve'}
                endIcon={pendingAction === 'approve' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Enable')}
              </Button>
            ) : (
              <Button
                onClick={handleDeposit}
                disabled={!poolIsOpen || !parsedStakeAmount?.gt(0) || pendingAction === 'stake'}
                endIcon={pendingAction === 'stake' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Stake')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleHarvest}
              disabled={(pendingReward ?? Zero).lte(0) || pendingAction === 'harvest'}
              endIcon={pendingAction === 'harvest' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
            >
              {t('Harvest')}
            </Button>
            <Button
              variant="secondary"
              onClick={handleWithdrawAll}
              disabled={userAmount.lte(0) || pendingAction === 'withdraw'}
              endIcon={pendingAction === 'withdraw' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
            >
              {t('Unstake All')}
            </Button>
          </Flex>

          {account.toLowerCase() === pool.creator.toLowerCase() ? (
            <Button
              mt="12px"
              scale="sm"
              variant="text"
              onClick={handleClosePool}
              disabled={pool.totalStaked.gt(0) || pool.rewardRemaining.lte(0) || pendingAction === 'close'}
              endIcon={pendingAction === 'close' ? <AutoRenewIcon spin color="currentColor" /> : undefined}
            >
              {t('Close Pool')}
            </Button>
          ) : null}
        </>
      ) : (
        <ConnectWalletButton />
      )}
    </Box>
  )
}

const SmartPoolsList: React.FC<{ view: Exclude<SmartPoolsView, 'create'> }> = ({ view }) => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const smartPoolsAddress = useMemo(() => getSmartPoolsAddress(chainId), [chainId])
  const hasSmartPoolsAddress = Boolean(smartPoolsAddress)
  const smartPoolsContract = useSmartPoolsContract()

  const { data: pools, mutate } = useSWR(
    smartPoolsContract && hasSmartPoolsAddress && (view === 'all' || account)
      ? ['smartPoolsList', view, account, smartPoolsAddress]
      : null,
    () => {
      if (view === 'my-stakes') {
        return smartPoolsContract.getPoolsByStaker(account, 0, POOLS_PAGE_SIZE)
      }
      if (view === 'my-pools') {
        return smartPoolsContract.getPoolsByCreator(account, 0, POOLS_PAGE_SIZE)
      }
      return smartPoolsContract.getPools(0, POOLS_PAGE_SIZE)
    },
    { refreshInterval: 15000 },
  )

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

  return (
    <Card>
      <CardBody>
        <Heading scale="lg" mb="24px">
          {view === 'my-stakes' ? t('My Stakes') : view === 'my-pools' ? t('My Pools') : t('Smart Pools')}
        </Heading>
        {pools?.length ? (
          <Flex flexDirection="column" style={{ gap: '12px' }}>
            {pools.map((pool: SmartPoolInfo) => (
              <SmartPoolRow key={pool.id.toString()} pool={pool} smartPoolsAddress={smartPoolsAddress} onRefresh={mutate} />
            ))}
          </Flex>
        ) : (
          <Text color="textSubtle">{t('No smart pools found.')}</Text>
        )}
      </CardBody>
    </Card>
  )
}

const SmartPools: React.FC<{ view: SmartPoolsView }> = ({ view }) => {
  return (
    <Page>
      <Box maxWidth={view === 'create' ? '620px' : '980px'} mx="auto" width="100%">
        <SmartPoolsTabs activeView={view} />
        {view === 'create' ? <CreateSmartPool /> : <SmartPoolsList view={view} />}
      </Box>
    </Page>
  )
}

export default SmartPools
