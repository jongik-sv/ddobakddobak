#!/usr/bin/env node
// FNV-1a 64bit hex 대조용 스크립트 — wbs-web src/lib/minutes/blocks.ts 의 fnv1a64 를 그대로 옮겼다.
// 사용: node fnv1a64.mjs <파일경로>  (파일 내용을 UTF-8 로 읽어 해시(16자리 소문자 hex)를 stdout 에 출력)

import { readFileSync } from 'node:fs'

const FNV_OFFSET = BigInt('0xcbf29ce484222325')
const FNV_PRIME = BigInt('0x100000001b3')

function fnv1a64(text) {
  let h = FNV_OFFSET
  for (let i = 0; i < text.length; i++) {
    h = BigInt.asUintN(64, (h ^ BigInt(text.charCodeAt(i))) * FNV_PRIME)
  }
  return h.toString(16).padStart(16, '0')
}

const path = process.argv[2]
if (!path) {
  console.error('usage: node fnv1a64.mjs <file>')
  process.exit(1)
}

const text = readFileSync(path, 'utf8')
console.log(fnv1a64(text))
