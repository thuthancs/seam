import generateDefault from '@babel/generator';
import parser from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import traverseDefault from '@babel/traverse';
import type { JSXAttribute, JSXOpeningElement } from '@babel/types';
import * as t from '@babel/types';

// @babel/traverse exports an object with a nested default property containing the function
const traverse = (typeof traverseDefault === 'function'
    ? traverseDefault
    : ((traverseDefault as Record<string, unknown>)?.default || traverseDefault)) as typeof traverseDefault;

// @babel/generator exports an object with a nested default property containing the function
const generate = (typeof generateDefault === 'function'
    ? generateDefault
    : ((generateDefault as Record<string, unknown>)?.default || generateDefault)) as typeof generateDefault;

/**
 * Updates className in source code using AST parsing
 * Ported from vite.config.ts
 */
export function updateFileContent(
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
                    // If elementIndex is provided, only update the nth occurrence
                    if (elementIndex !== undefined && foundCount !== elementIndex) {
                        foundCount++;
                        return;
                    }

                    const classNameIndex = node.attributes.findIndex(
                        (attr: JSXAttribute | t.JSXSpreadAttribute) => t.isJSXAttribute(attr) &&
                            t.isJSXIdentifier(attr.name) &&
                            attr.name.name === 'className'
                    );

                    if (classNameIndex !== -1) {
                        const classNameAttr = node.attributes[classNameIndex];

                        if (t.isJSXAttribute(classNameAttr)) {
                            // Parse newClassName to determine if it's a conditional expression
                            try {
                                const parsed = parser.parseExpression(newClassName, {
                                    plugins: ['typescript'],
                                });
                                // If it's a conditional expression, use it as-is
                                if (t.isConditionalExpression(parsed)) {
                                    classNameAttr.value = t.jsxExpressionContainer(parsed);
                                } else if (t.isStringLiteral(parsed)) {
                                    classNameAttr.value = parsed;
                                } else {
                                    // Default to string literal
                                    classNameAttr.value = t.stringLiteral(newClassName);
                                }
                            } catch {
                                // If parsing fails, treat as string literal
                                classNameAttr.value = t.stringLiteral(newClassName);
                            }
                            updated = true;
                        }
                    } else {
                        // Add className if missing
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
            const output = generate(ast, {
                retainLines: false,
                compact: false,
            }, sourceCode);
            return output.code;
        }
    } catch (error) {
        console.error('AST parsing error:', error);
        throw error;
    }

    return sourceCode;
}


