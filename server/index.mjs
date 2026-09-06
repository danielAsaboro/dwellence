import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApp } from './app.mjs'
import { createStore, runRetention } from './store.mjs'

const port = Number(process.env.PORT ?? 8787)
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/dwellence.sqlite')
const locationEncryptionKey = process.env.LOCATION_ENCRYPTION_KEY
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)

if (!locationEncryptionKey || locationEncryptionKey.length < 24) {
  console.error('Refusing to start: set LOCATION_ENCRYPTION_KEY to a unique 24+-character secret.')
  process.exit(1)
}

mkdirSync(dirname(databasePath), { recursive: true })
const staticDirectory = resolve(process.env.STATIC_DIRECTORY ?? './dist')
const store = createStore(databasePath)
runRetention(store)
const retentionTimer = setInterval(() => runRetention(store), 24 * 60 * 60 * 1000)
retentionTimer.unref()
const app = createApp({ store, locationEncryptionKey, allowedOrigins, staticDirectory })
app.listen(port, () => console.log(`Dwellence API listening on port ${port}`))
