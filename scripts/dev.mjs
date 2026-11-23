import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const server = await createServer({
  server: { port: 5173, strictPort: true }
})

await server.listen()
server.printUrls()

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: 'http://localhost:5173',
    ELECTRON_ENABLE_LOGGING: '1'
  }
})

child.on('close', async () => {
  await server.close()
  process.exit(0)
})
