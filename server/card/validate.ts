import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js'
import addFormatsDefault from 'ajv-formats'
import type { CardDocument } from './types.js'

const here = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(readFileSync(join(here, '../../process/card_schema.json'), 'utf8')) as object

const addFormats = addFormatsDefault as unknown as (instance: Ajv2020) => void
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)

export function assertValidCard(card: unknown): asserts card is CardDocument {
  if (validate(card)) return
  const detail = ((validate.errors ?? []) as ErrorObject[])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
    .join('; ')
  throw new Error(`카드 JSON이 계약을 만족하지 않습니다. ${detail}`.slice(0, 500))
}
