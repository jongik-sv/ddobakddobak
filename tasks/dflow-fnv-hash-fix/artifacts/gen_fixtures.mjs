#!/usr/bin/env node
// verify.sh 용 테스트 입력 파일 생성기. 매 실행마다 지정한 디렉터리에 고정된 내용으로 다시 쓴다.
// 사용: node gen_fixtures.mjs <출력 디렉터리>

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node gen_fixtures.mjs <dir>')
  process.exit(1)
}
mkdirSync(dir, { recursive: true })

function write(name, content) {
  // 트레일링 개행을 두지 않는다 — psql 의 `\set v `cat file`` (커맨드 서브스티튜션)이 트레일링
  // 개행을 제거하므로, node 쪽도 같은 내용을 읽도록 파일 자체에 개행을 넣지 않는다.
  writeFileSync(join(dir, `${name}.txt`), content, 'utf8')
}

write('empty', '')
write('ascii', 'Hello, World! FNV-1a test 123 - the quick brown fox jumps over the lazy dog.')
write('korean', '회의록 요약 테스트입니다. 오늘 논의된 안건은 다음과 같습니다.')
write('emoji', '😀 이모지 테스트 🎉 놀람 표정 😺 고양이 이모지 혼합 텍스트입니다 🚀🔥')
write('mixed', 'Meeting 회의 2026-09-03: 결정사항 (A안 채택) 📌, 특수문자 !@#$%^&*()_+~`[]{}|;:\'",.<>/?')

// 한글 반복 구문을 정확한 글자 수로 잘라 긴 본문을 만든다 (한글 음절은 BMP 단일 코드유닛이라
// JS .length 와 Postgres char_length 가 1:1 로 맞는다).
const base =
  '또박또박 회의록 위키 본문 성능 검증용 한글 문자열입니다. 여러 문단과 다양한 어휘를 섞어 ' +
  '실제 회의록과 비슷한 분포를 흉내냅니다. 안건 논의 결정사항 액션아이템 참석자 다음일정. '

function koreanOfLength(n) {
  let s = ''
  while (s.length < n) s += base
  return s.slice(0, n)
}

// 동등성 검증용 2~3만자 장문
write('long20000', koreanOfLength(20000))
write('long28837', koreanOfLength(28837))

// 타이밍 측정용 (5k/10k/20k/28.8k)
write('kr5000', koreanOfLength(5000))
write('kr10000', koreanOfLength(10000))
write('kr20000', koreanOfLength(20000))
write('kr28800', koreanOfLength(28800))

console.log(`fixtures written to ${dir}`)
