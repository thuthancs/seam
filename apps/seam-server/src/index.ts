#!/usr/bin/env node

import express from 'express';
import fs from 'fs';
import path from 'path';
import { getClassNameExpression, updateClassNameWithAST } from './ast.js';

// Common entry file patterns (checked in order; first existing wins)
const COMMON_ENTRY_PATTERNS = [
  'src/App.tsx',
  'src/App.jsx',
  'frontend/src/App.tsx',
  'frontend/src/App.jsx',
  'app/src/App.tsx',
  'app/src/App.jsx',
  'packages/frontend/src/App.tsx',
  'packages/web/src/App.tsx',
  'packages/app/src/App.tsx',
];

function discoverEntryFile(projectRoot: string): string | null {
  for (const candidate of COMMON_ENTRY_PATTERNS) {
    const fullPath = path.join(projectRoot, candidate);
    if (fs.existsSync(fullPath)) {
      return candidate;
    }
  }
  return null;
}

function parseArgs(): { project: string; port: number; file: string | null } {
  const args = process.argv.slice(2);
  let project = '';
  let port = 5175;
  let file: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      project = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10) || 5175;
    } else if (args[i] === '--file' && args[i + 1]) {
      file = args[++i];
    }
  }

  if (!project) {
    console.error('Usage: seam-server --project <path> [--port 5175] [--file <path>]');
    console.error('  --project  Path to your app (required)');
    console.error('  --port     Port to run on (default: 5175)');
    console.error('  --file     Source file to update (optional; auto-discovers if omitted)');
    process.exit(1);
  }

  return { project, port, file };
}

const { project, port, file: fileArg } = parseArgs();
const projectRoot = path.resolve(process.cwd(), project);

const file = fileArg ?? discoverEntryFile(projectRoot);
if (!file) {
  console.error(
    `No entry file found. Tried: ${COMMON_ENTRY_PATTERNS.join(', ')}. ` +
    `Use --file <path> to specify explicitly.`
  );
  process.exit(1);
}

const sourceFile = path.join(projectRoot, file);
if (!fs.existsSync(sourceFile)) {
  console.error(`Source file not found: ${sourceFile}`);
  process.exit(1);
}

const app = express();
app.use(express.json());

app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/get-classname-expression', (req, res) => {
  try {
    const { tagName, elementIndex } = req.body;
    const content = fs.readFileSync(sourceFile, 'utf8');
    const classNameExpression = getClassNameExpression(
      content,
      tagName,
      elementIndex
    );

    res.json({
      success: true,
      classNameExpression: classNameExpression || '',
      tagName,
      elementIndex,
    });
  } catch (error) {
    console.error('get-classname-expression error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.post('/api/update-classes', (req, res) => {
  try {
    const { tagName, newClassName, elementIndex } = req.body;
    let content = fs.readFileSync(sourceFile, 'utf8');

    content = updateClassNameWithAST(
      content,
      tagName,
      newClassName,
      elementIndex
    );

    fs.writeFileSync(sourceFile, content, 'utf8');

    const repoRelativePath = path.relative(projectRoot, sourceFile);

    res.json({
      success: true,
      message: 'Classes updated in source file',
      file: repoRelativePath,
    });
  } catch (error) {
    console.error('update-classes error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

app.listen(port, () => {
  console.log(`Seam server running at http://localhost:${port}`);
  console.log(`  Project: ${projectRoot}`);
  console.log(`  File: ${file}`);
});
