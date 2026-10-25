import 'dotenv/config'
import { adminPool } from './db.js'
import { runRetention } from './retention.js'

const removed = await runRetention()
console.log(`removed ${removed}`)
await adminPool().end()
