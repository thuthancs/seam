import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, type ViteDevServer } from 'vite'

type NextFunction = () => void

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Seam API plugin for Vite
function seamApiPlugin() {
  return {
    name: 'seam-api',
    configureServer(server: ViteDevServer) {
      // Add CORS headers for all API requests
      server.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }
        next();
      });

      // Health check endpoint
      server.middlewares.use('/api/health', (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ status: 'ok' }))
        } else {
          next()
        }
      })

      // Update classes endpoint
      server.middlewares.use('/api/update-classes', (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString()
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const { tagName, oldClassName, newClassName } = data

              // Read the source file
              const sourceFile = path.join(__dirname, 'src/App.tsx')
              let content = fs.readFileSync(sourceFile, 'utf8')

              // Simple string replacement for className
              // This is a basic implementation - production would use AST parsing
              if (oldClassName && content.includes(oldClassName)) {
                // Replace old className with new one
                content = content.replace(
                  new RegExp(`className=["']${oldClassName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'g'),
                  `className="${newClassName}"`
                )
              } else if (tagName) {
                // Try to find the element and add/update className
                // Look for the tag (e.g., <h1>)
                const tagRegex = new RegExp(`<${tagName}([^>]*)>`, 'g')
                content = content.replace(tagRegex, (match: string, attributes: string) => {
                  if (attributes.includes('className=')) {
                    // Update existing className
                    return match.replace(
                      /className=["']([^"']*)["']/,
                      `className="${newClassName}"`
                    )
                  } else {
                    // Add className attribute
                    return `<${tagName} className="${newClassName}"${attributes}>`
                  }
                })
              }

              // Write back to file
              fs.writeFileSync(sourceFile, content, 'utf8')

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: true,
                message: 'Classes updated in source file',
                file: sourceFile
              }))
            } catch (error) {
              const err = error as Error
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: false,
                error: err.message
              }))
            }
          })
        } else {
          next()
        }
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    seamApiPlugin(),
  ],
})
