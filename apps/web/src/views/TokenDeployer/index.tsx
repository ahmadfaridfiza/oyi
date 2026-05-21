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
  Checkbox,
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
import { useTokenContract, useTokenDeployerContract } from 'hooks/useContract'
import useSWR from 'swr'
import { getTokenDeployerAddress } from 'utils/addressHelpers'
import { useAccount } from 'wagmi'
import Page from 'views/Page'

const DEPLOY_FEE = parseUnits('10', 18)
const DEFAULT_DECIMALS = '18'

const parseTotalSupply = (value: string, decimals: number) => {
  if (!value || Number.isNaN(decimals)) return null
  try {
    return parseUnits(value, decimals)
  } catch {
    return null
  }
}

const getCreatedTokenAddress = (receipt, tokenDeployerContract) => {
  const createdEvent = receipt.logs
    .map((log) => {
      try {
        return tokenDeployerContract.interface.parseLog(log)
      } catch {
        return null
      }
    })
    .find((event) => event?.name === 'TokenCreated')

  return createdEvent?.args?.token as string | undefined
}

const TokenDeployer = () => {
  const { t } = useTranslation()
  const { address: account } = useAccount()
  const { chainId } = useActiveChainId()
  const { callWithGasPrice } = useCallWithGasPrice()
  const { toastError, toastSuccess } = useToast()

  const tokenDeployerAddress = useMemo(() => getTokenDeployerAddress(chainId), [chainId])
  const hasTokenDeployerAddress = Boolean(tokenDeployerAddress)
  const plaxToken = bscTokens.cake
  const plaxContract = useTokenContract(plaxToken.address)
  const tokenDeployerContract = useTokenDeployerContract()

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState(DEFAULT_DECIMALS)
  const [totalSupply, setTotalSupply] = useState('')
  const [mintable, setMintable] = useState(false)
  const [burnable, setBurnable] = useState(true)
  const [isApproving, setIsApproving] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createdTokenAddress, setCreatedTokenAddress] = useState('')
  const [verificationMessage, setVerificationMessage] = useState('')

  const decimalsNumber = useMemo(() => Number(decimals), [decimals])
  const parsedSupply = useMemo(() => parseTotalSupply(totalSupply, decimalsNumber), [totalSupply, decimalsNumber])
  const isValidDecimals = Number.isInteger(decimalsNumber) && decimalsNumber >= 0 && decimalsNumber <= 18
  const isValidSupply = parsedSupply && parsedSupply.gt(0)

  const { data: allowance, mutate: refreshAllowance } = useSWR(
    account && plaxContract && hasTokenDeployerAddress
      ? ['tokenDeployerAllowance', account, tokenDeployerAddress, plaxToken.address]
      : null,
    () => plaxContract.allowance(account, tokenDeployerAddress),
  )

  const { data: plaxBalance, mutate: refreshBalance } = useSWR(
    account && plaxContract ? ['tokenDeployerPlaxBalance', account, plaxToken.address] : null,
    () => plaxContract.balanceOf(account),
  )

  const isApproved = allowance ? BigNumber.from(allowance).gte(DEPLOY_FEE) : false
  const hasEnoughPlax = plaxBalance ? BigNumber.from(plaxBalance).gte(DEPLOY_FEE) : false
  const canCreate =
    Boolean(account) &&
    hasTokenDeployerAddress &&
    Boolean(tokenDeployerContract) &&
    name.trim().length > 0 &&
    symbol.trim().length > 0 &&
    isValidDecimals &&
    Boolean(isValidSupply) &&
    hasEnoughPlax

  const handleApprove = useCallback(async () => {
    if (!plaxContract || !hasTokenDeployerAddress) return

    setIsApproving(true)
    try {
      const tx = await callWithGasPrice(plaxContract, 'approve', [tokenDeployerAddress, MaxUint256])
      const receipt = await tx.wait()
      toastSuccess(t('Contract Enabled'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshAllowance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to approve PLAX. Please try again.'))
    } finally {
      setIsApproving(false)
    }
  }, [callWithGasPrice, hasTokenDeployerAddress, plaxContract, refreshAllowance, t, toastError, toastSuccess, tokenDeployerAddress])

  const handleCreateToken = useCallback(async () => {
    if (!tokenDeployerContract || !parsedSupply || !canCreate) return

    setIsCreating(true)
    setCreatedTokenAddress('')
    setVerificationMessage('')
    try {
      const tx = await callWithGasPrice(tokenDeployerContract, 'createToken', [
        name.trim(),
        symbol.trim().toUpperCase(),
        decimalsNumber,
        parsedSupply,
        mintable,
        burnable,
      ])
      const receipt = await tx.wait()
      const tokenAddress = getCreatedTokenAddress(receipt, tokenDeployerContract)
      if (tokenAddress) {
        setCreatedTokenAddress(tokenAddress)
        setVerificationMessage(t('Submitting contract verification to Polygonscan...'))
        fetch('/api/token-deployer/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chainId,
            tokenAddress,
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            decimals: decimalsNumber,
            totalSupply: parsedSupply.toString(),
            mintable,
            burnable,
            owner: account,
          }),
        })
          .then((response) => response.json())
          .then((verification) => {
            if (verification?.guid) {
              setVerificationMessage(t('Verification submitted to Polygonscan. It may take a few minutes to complete.'))
              return
            }
            setVerificationMessage(verification?.error || t('Verification could not be submitted.'))
          })
          .catch(() => {
            setVerificationMessage(t('Verification could not be submitted.'))
          })
      }
      toastSuccess(t('Token Created'), <ToastDescriptionWithTx txHash={receipt.transactionHash} />)
      refreshAllowance()
      refreshBalance()
    } catch (error) {
      console.error(error)
      toastError(t('Error'), t('Unable to create token. Please check your inputs and try again.'))
    } finally {
      setIsCreating(false)
    }
  }, [
    burnable,
    callWithGasPrice,
    canCreate,
    account,
    chainId,
    decimalsNumber,
    mintable,
    name,
    parsedSupply,
    refreshAllowance,
    refreshBalance,
    symbol,
    t,
    toastError,
    toastSuccess,
    tokenDeployerContract,
  ])

  return (
    <Page>
      <Box maxWidth="560px" mx="auto" width="100%">
        <Card>
          <CardBody>
            <Heading scale="xl" mb="8px">
              {t('Token Deployer')}
            </Heading>
            <Text color="textSubtle" mb="24px">
              {t('Create a new ERC-20 token and pay a fixed fee of %fee% PLAX.', {
                fee: formatUnits(DEPLOY_FEE, 18),
              })}
            </Text>

            {!hasTokenDeployerAddress ? (
              <Message variant="warning" mb="24px">
                <MessageText>
                  {t('Token deployer contract address is not configured for this network yet.')}
                </MessageText>
              </Message>
            ) : null}

            <Box mb="16px">
              <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                {t('Token Name')}
              </Text>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example Token" />
            </Box>

            <Box mb="16px">
              <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                {t('Symbol')}
              </Text>
              <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="EXT" />
            </Box>

            <Flex mb="16px" flexDirection={['column', null, 'row']} style={{ gap: '16px' }}>
              <Box width="100%" style={{ flex: 1 }}>
                <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                  {t('Decimals')}
                </Text>
                <Input
                  inputMode="numeric"
                  value={decimals}
                  onChange={(event) => setDecimals(event.target.value.replace(/\D/g, ''))}
                  placeholder={DEFAULT_DECIMALS}
                />
                {!isValidDecimals ? (
                  <Text color="failure" fontSize="12px" mt="4px">
                    {t('Decimals must be between 0 and 18.')}
                  </Text>
                ) : null}
              </Box>

              <Box width="100%" style={{ flex: 1 }}>
                <Text fontSize="12px" bold color="secondary" textTransform="uppercase" mb="8px">
                  {t('Total Supply')}
                </Text>
                <Input
                  inputMode="decimal"
                  value={totalSupply}
                  onChange={(event) => setTotalSupply(event.target.value)}
                  placeholder="1000000"
                />
              </Box>
            </Flex>

            <Flex justifyContent="space-between" alignItems="center" mb="12px">
              <Box>
                <Text bold>{t('Mintable')}</Text>
                <Text color="textSubtle" fontSize="12px">
                  {t('Owner can mint more supply later.')}
                </Text>
              </Box>
              <Checkbox checked={mintable} onChange={() => setMintable((current) => !current)} scale="sm" />
            </Flex>

            <Flex justifyContent="space-between" alignItems="center" mb="20px">
              <Box>
                <Text bold>{t('Burnable')}</Text>
                <Text color="textSubtle" fontSize="12px">
                  {t('Token holders can burn their own balance.')}
                </Text>
              </Box>
              <Checkbox checked={burnable} onChange={() => setBurnable((current) => !current)} scale="sm" />
            </Flex>

            <Flex justifyContent="space-between" mb="8px">
              <Text color="textSubtle">{t('Fee')}</Text>
              <Text bold>{t('%fee% PLAX', { fee: formatUnits(DEPLOY_FEE, 18) })}</Text>
            </Flex>
            <Flex justifyContent="space-between" mb="24px">
              <Text color="textSubtle">{t('Your PLAX balance')}</Text>
              <Text bold>{plaxBalance ? formatUnits(plaxBalance, 18) : '-'}</Text>
            </Flex>

            {!account ? (
              <ConnectWalletButton width="100%" />
            ) : !isApproved ? (
              <Button
                width="100%"
                onClick={handleApprove}
                disabled={!hasTokenDeployerAddress || isApproving}
                endIcon={isApproving ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Enable PLAX')}
              </Button>
            ) : (
              <Button
                width="100%"
                onClick={handleCreateToken}
                disabled={!canCreate || isCreating}
                endIcon={isCreating ? <AutoRenewIcon spin color="currentColor" /> : undefined}
              >
                {t('Create Token')}
              </Button>
            )}

            {account && plaxBalance && !hasEnoughPlax ? (
              <Text color="failure" fontSize="12px" mt="12px" textAlign="center">
                {t('A minimum of %fee% PLAX is required.', { fee: formatUnits(DEPLOY_FEE, 18) })}
              </Text>
            ) : null}

            {createdTokenAddress ? (
              <Message variant="success" mt="24px">
                <MessageText>
                  <Flex alignItems="center" style={{ gap: '8px' }}>
                    <Text>{t('Created token: %address%', { address: createdTokenAddress })}</Text>
                    <CopyButton
                      width="16px"
                      buttonColor="textSubtle"
                      text={createdTokenAddress}
                      tooltipMessage={t('Token address copied')}
                    />
                  </Flex>
                  {verificationMessage ? (
                    <Text color="textSubtle" fontSize="12px" mt="8px">
                      {verificationMessage}
                    </Text>
                  ) : null}
                </MessageText>
              </Message>
            ) : null}
          </CardBody>
        </Card>
      </Box>
    </Page>
  )
}

export default TokenDeployer
