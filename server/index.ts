import 'dotenv/config'
import { createApp } from './app.js'
import { runRetention } from './retention.js'
import { processNext, sweepStuck } from './worker.js'

const port = Number(process.env.API_PORT || 43128)
const app = createApp()
app.listen(port, '0.0.0.0', () => {
  console.log(`api listening on ${port}`)
})

let ticking = false
async function drain() {
  if (ticking) return
  ticking = true
  try {
    await sweepStuck()
    for (;;) {
      const result = await processNext()
      if (result.status === 'idle') break
    }
  } catch (error) {
    console.error(error)
  } finally {
    ticking = false
  }
}

setInterval(() => {
  void drain()
}, 3000)
setInterval(() => {
  void runRetention().catch((error: unknown) => console.error(error))
}, 24 * 60 * 60 * 1000)
void runRetention().catch((error: unknown) => console.error(error))
