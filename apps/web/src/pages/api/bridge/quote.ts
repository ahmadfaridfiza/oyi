import type { NextApiHandler } from 'next'
import { z } from 'zod'
import { BRIDGE_INTEGRATOR } from 'views/Bridge/config'

const LIFI_QUOTE_ENDPOINT = 'https://li.quest/v1/quote'

const zQuoteQuery = z.object({
  fromChain: z.coerce.number().int().positive(),
  toChain: z.coerce.number().int().positive(),
  fromToken: z.string().min(1),
  toToken: z.string().min(1),
  fromAmount: z.string().regex(/^\d+$/),
  fromAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  slippage: z
    .string()
    .regex(/^(0(\.\d+)?|1(\.0+)?)$/)
    .optional(),
})

const getLifiError = async (response: Response) => {
  try {
    const body = await response.json()
    return body?.message || body?.error || body
  } catch {
    return response.statusText
  }
}

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const parsed = zQuoteQuery.safeParse(req.query)
  if (parsed.success === false) {
    return res.status(400).json({ error: 'Invalid quote request', details: parsed.error.flatten() })
  }

  const params = new URLSearchParams({
    fromChain: String(parsed.data.fromChain),
    toChain: String(parsed.data.toChain),
    fromToken: parsed.data.fromToken,
    toToken: parsed.data.toToken,
    fromAmount: parsed.data.fromAmount,
    fromAddress: parsed.data.fromAddress,
    slippage: parsed.data.slippage ?? '0.005',
    integrator: BRIDGE_INTEGRATOR,
  })

  try {
    const response = await fetch(`${LIFI_QUOTE_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const error = await getLifiError(response)
      return res.status(response.status).json({ error })
    }

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(await response.json())
  } catch (error) {
    console.error(error)
    return res.status(502).json({ error: 'Unable to fetch bridge quote' })
  }
}

export default handler
