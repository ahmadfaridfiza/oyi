import type { NextApiHandler } from 'next'
import { z } from 'zod'

const LIFI_STATUS_ENDPOINT = 'https://li.quest/v1/status'

const zStatusQuery = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  fromChain: z.coerce.number().int().positive(),
  toChain: z.coerce.number().int().positive(),
  bridge: z.string().optional(),
})

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const parsed = zStatusQuery.safeParse(req.query)
  if (parsed.success === false) {
    return res.status(400).json({ error: 'Invalid status request', details: parsed.error.flatten() })
  }

  const params = new URLSearchParams({
    txHash: parsed.data.txHash,
    fromChain: String(parsed.data.fromChain),
    toChain: String(parsed.data.toChain),
  })

  if (parsed.data.bridge) {
    params.set('bridge', parsed.data.bridge)
  }

  try {
    const response = await fetch(`${LIFI_STATUS_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    })
    const body = await response.json()

    res.setHeader('Cache-Control', 'no-store')
    return res.status(response.status).json(body)
  } catch (error) {
    console.error(error)
    return res.status(502).json({ error: 'Unable to fetch bridge status' })
  }
}

export default handler
