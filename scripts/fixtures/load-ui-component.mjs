import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import React from 'react'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const root = resolve(dirname(new URL(import.meta.url).pathname), '../..')

// Execute actual presentation components in SSR tests; do not mock state labels or permissions.
export function loadUiComponent(path, overrides = {}, cache = new Map()) {
  const absolute = resolve(root, path)
  if (cache.has(absolute)) return cache.get(absolute)
  const loadedModule = { exports: {} }; cache.set(absolute, loadedModule.exports)
  const source = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  function dependency(name) {
    if (name in overrides) return overrides[name]
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => React.createElement('a', props, children) }
    if (name === 'next/image') return { __esModule: true, default: ({ fill, sizes, ...props }) => React.createElement('img', { ...props, sizes, 'data-fill': fill || undefined }) }
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(absolute), name)
      for (const suffix of ['.tsx', '.ts']) {
        try { readFileSync(target + suffix); return loadUiComponent(target + suffix, overrides, cache) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    }
    return require(name)
  }
  new Function('require', 'exports', 'module', source)(dependency, loadedModule.exports, loadedModule)
  cache.set(absolute, loadedModule.exports)
  return loadedModule.exports
}
