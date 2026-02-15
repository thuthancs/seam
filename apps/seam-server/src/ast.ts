import generateModule from '@babel/generator';
import parser from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseModule from '@babel/traverse';
import type { JSXAttribute, JSXOpeningElement } from '@babel/types';
import * as t from '@babel/types';

// Babel ESM/CJS interop: default may be nested (types don't reflect runtime shape)
const traverse = ((m: unknown) => (m as { default?: (m: unknown) => void })?.default ?? m)(traverseModule) as (ast: unknown, opts: Record<string, unknown>) => void;
const generate = ((m: unknown) => (m as { default?: (ast: unknown, opts?: unknown, code?: unknown) => { code: string } })?.default ?? m)(generateModule) as (ast: unknown, opts?: unknown, code?: unknown) => { code: string };

export function getClassNameExpression(
  sourceCode: string,
  tagName: string,
  elementIndex?: number
): string | null {
  try {
    const ast = parser.parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
    });

    let foundCount = 0;
    let classNameExpression: string | null = null;

    traverse(ast, {
      JSXOpeningElement(path: NodePath<JSXOpeningElement>) {
        const node = path.node;

        if (t.isJSXIdentifier(node.name) && node.name.name === tagName) {
          if (elementIndex !== undefined && foundCount !== elementIndex) {
            foundCount++;
            return;
          }

          const classNameAttr = node.attributes.find(
            (attr: JSXAttribute | t.JSXSpreadAttribute) =>
              t.isJSXAttribute(attr) &&
              t.isJSXIdentifier(attr.name) &&
              attr.name.name === 'className'
          );

          if (classNameAttr && t.isJSXAttribute(classNameAttr)) {
            if (t.isStringLiteral(classNameAttr.value)) {
              classNameExpression = classNameAttr.value.value;
            } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
              const expression = classNameAttr.value.expression;
              const output = generate(
                expression,
                { retainLines: false, compact: false },
                sourceCode
              );
              classNameExpression = output.code;
            }
            foundCount++;
          }
        }
      },
    });

    return classNameExpression;
  } catch (error) {
    console.error('AST parsing error:', error);
    return null;
  }
}

export function updateClassNameWithAST(
  sourceCode: string,
  tagName: string,
  newClassName: string,
  elementIndex?: number
): string {
  try {
    const ast = parser.parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
    });

    let updated = false;
    let foundCount = 0;

    traverse(ast, {
      JSXOpeningElement(path: NodePath<JSXOpeningElement>) {
        const node = path.node;

        if (t.isJSXIdentifier(node.name) && node.name.name === tagName) {
          if (elementIndex !== undefined && foundCount !== elementIndex) {
            foundCount++;
            return;
          }

          const classNameIndex = node.attributes.findIndex(
            (attr: JSXAttribute | t.JSXSpreadAttribute) =>
              t.isJSXAttribute(attr) &&
              t.isJSXIdentifier(attr.name) &&
              attr.name.name === 'className'
          );

          if (classNameIndex !== -1) {
            const classNameAttr = node.attributes[classNameIndex];

            if (t.isJSXAttribute(classNameAttr)) {
              try {
                const parsed = parser.parseExpression(newClassName, {
                  plugins: ['typescript'],
                });
                if (t.isConditionalExpression(parsed)) {
                  classNameAttr.value = t.jsxExpressionContainer(parsed);
                } else if (t.isStringLiteral(parsed)) {
                  classNameAttr.value = parsed;
                } else {
                  classNameAttr.value = t.stringLiteral(newClassName);
                }
              } catch {
                classNameAttr.value = t.stringLiteral(newClassName);
              }
              updated = true;
            }
          } else {
            try {
              const parsed = parser.parseExpression(newClassName, {
                plugins: ['typescript'],
              });
              if (t.isConditionalExpression(parsed)) {
                node.attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('className'),
                    t.jsxExpressionContainer(parsed)
                  )
                );
              } else {
                node.attributes.push(
                  t.jsxAttribute(
                    t.jsxIdentifier('className'),
                    t.stringLiteral(newClassName)
                  )
                );
              }
            } catch {
              node.attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('className'),
                  t.stringLiteral(newClassName)
                )
              );
            }
            updated = true;
          }
          foundCount++;
        }
      },
    });

    if (updated) {
      const output = generate(
        ast,
        { retainLines: false, compact: false },
        sourceCode
      );
      return output.code;
    }
  } catch (error) {
    console.error('AST parsing error:', error);
    throw error;
  }

  return sourceCode;
}
