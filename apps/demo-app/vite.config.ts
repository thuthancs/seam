import generateDefault from '@babel/generator'
import parser from '@babel/parser'
import type { NodePath } from '@babel/traverse'
import traverseDefault from '@babel/traverse'
import type { JSXAttribute, JSXOpeningElement } from '@babel/types'
import * as t from '@babel/types'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, type ViteDevServer } from 'vite'

// @babel/traverse exports an object with a nested default property containing the function
// Access the nested default to get the actual traverse function
const traverse = (typeof traverseDefault === 'function'
  ? traverseDefault
  : ((traverseDefault as Record<string, unknown>)?.default || traverseDefault)) as typeof traverseDefault

// @babel/generator exports an object with a nested default property containing the function
// Access the nested default to get the actual generate function
const generate = (typeof generateDefault === 'function'
  ? generateDefault
  : ((generateDefault as Record<string, unknown>)?.default || generateDefault)) as typeof generateDefault

type NextFunction = () => void

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Extract className expression from AST
function getClassNameExpression(
  sourceCode: string,
  tagName: string,
  elementIndex?: number
): string | null {
  try {
    const ast = parser.parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
    })

    let foundCount = 0
    let classNameExpression: string | null = null

    traverse(ast, {
      JSXOpeningElement(path: NodePath<JSXOpeningElement>) {
        const node = path.node

        if (t.isJSXIdentifier(node.name) && node.name.name === tagName) {
          // If elementIndex is provided, only match the nth occurrence
          if (elementIndex !== undefined && foundCount !== elementIndex) {
            foundCount++
            return
          }

          const classNameAttr = node.attributes.find(
            (attr: JSXAttribute | t.JSXSpreadAttribute) => t.isJSXAttribute(attr) &&
              t.isJSXIdentifier(attr.name) &&
              attr.name.name === 'className'
          )

          if (classNameAttr && t.isJSXAttribute(classNameAttr)) {
            if (t.isStringLiteral(classNameAttr.value)) {
              // Static string: className="..."
              classNameExpression = classNameAttr.value.value
            } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
              // Expression: className={...}
              const expression = classNameAttr.value.expression
              // Generate code for the expression
              const output = generate(expression, {
                retainLines: false,
                compact: false,
              }, sourceCode)
              classNameExpression = output.code
            }
            foundCount++
          }
        }
      },
    })

    return classNameExpression
  } catch (error) {
    console.error('AST parsing error:', error)
    return null
  }
}

// AST-based className updater
function updateClassNameWithAST(
  sourceCode: string,
  tagName: string,
  newClassName: string,
  elementIndex?: number
): string {
  try {
    const ast = parser.parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
    })

    let updated = false
    let foundCount = 0

    traverse(ast, {
      JSXOpeningElement(path: NodePath<JSXOpeningElement>) {
        const node = path.node

        if (t.isJSXIdentifier(node.name) && node.name.name === tagName) {
          // If elementIndex is provided, only update the nth occurrence
          if (elementIndex !== undefined && foundCount !== elementIndex) {
            foundCount++
            return
          }

          const classNameIndex = node.attributes.findIndex(
            (attr: JSXAttribute | t.JSXSpreadAttribute) => t.isJSXAttribute(attr) &&
              t.isJSXIdentifier(attr.name) &&
              attr.name.name === 'className'
          )

          if (classNameIndex !== -1) {
            const classNameAttr = node.attributes[classNameIndex]

            if (t.isJSXAttribute(classNameAttr)) {
              // Parse newClassName to determine if it's a conditional expression
              try {
                const parsed = parser.parseExpression(newClassName, {
                  plugins: ['typescript'],
                })
                // If it's a conditional expression, use it as-is
                if (t.isConditionalExpression(parsed)) {
                  classNameAttr.value = t.jsxExpressionContainer(parsed)
                } else if (t.isStringLiteral(parsed)) {
                  classNameAttr.value = parsed
                } else {
                  // Default to string literal
                  classNameAttr.value = t.stringLiteral(newClassName)
                }
              } catch {
                // If parsing fails, treat as string literal
                classNameAttr.value = t.stringLiteral(newClassName)
              }
              updated = true
            }
          } else {
            // Add className if missing
            try {
              const parsed = parser.parseExpression(newClassName, {
                plugins: ['typescript'],
              })
              if (t.isConditionalExpression(parsed)) {
                node.attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('className'),
                    t.jsxExpressionContainer(parsed)
                  )
                )
              } else {
                node.attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('className'),
                    t.stringLiteral(newClassName)
                  )
                )
              }
            } catch {
              node.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('className'),
                  t.stringLiteral(newClassName)
                )
              )
            }
            updated = true
          }
          foundCount++
        }
      },
    })

    if (updated) {
      const output = generate(ast, {
        retainLines: false,
        compact: false,
      }, sourceCode)
      return output.code
    }
  } catch (error) {
    console.error('AST parsing error:', error)
    throw error
  }

  return sourceCode
}

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

      // Get className expression endpoint
      server.middlewares.use('/api/get-classname-expression', (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString()
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const { tagName, elementIndex } = data

              // Read the source file
              const sourceFile = path.join(__dirname, 'src/App.tsx')
              const content = fs.readFileSync(sourceFile, 'utf8')

              // Extract className expression from AST
              const classNameExpression = getClassNameExpression(
                content,
                tagName,
                elementIndex
              )

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: true,
                classNameExpression: classNameExpression || '',
                tagName,
                elementIndex
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
              const { tagName, newClassName, elementIndex } = data

              // Read the source file
              const sourceFile = path.join(__dirname, 'src/App.tsx')
              let content = fs.readFileSync(sourceFile, 'utf8')

              // Use AST parsing to update className (handles static strings and conditional expressions)
              content = updateClassNameWithAST(content, tagName, newClassName, elementIndex)

              // Write back to file
              fs.writeFileSync(sourceFile, content, 'utf8')

              // Return path relative to workspace root for GitHub (repo expects relative paths)
              const workspaceRoot = path.resolve(__dirname, '../..')
              const repoRelativePath = path.relative(workspaceRoot, sourceFile)

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({
                success: true,
                message: 'Classes updated in source file',
                file: repoRelativePath
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
