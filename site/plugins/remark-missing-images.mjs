// 아직 만들지 않은 화면 이미지(src/assets/screens)를 가리키는 마크다운 이미지 참조를 「화면 준비 중」 글로 바꾼다.
// 초안(draft: true) 쪽도 Astro 가 컴파일하면서 이미지를 찾기 때문에, 없는 이미지가 있으면 사이트 빌드가 멈춘다.
// 게시되는 쪽이 없는 이미지를 참조하지 않는 것은 시험(ManualScopeTests)이 따로 막는다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const screensDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'screens');

function replaceMissing(node) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === 'image' && /assets\/screens\//.test(child.url ?? '')) {
      const file = path.basename(child.url);
      if (!fs.existsSync(path.join(screensDir, file))) {
        return { type: 'emphasis', children: [{ type: 'text', value: `(화면 준비 중: ${child.alt ?? file})` }] };
      }
    }
    replaceMissing(child);
    return child;
  });
}

export default function remarkMissingImages() {
  return (tree) => replaceMissing(tree);
}
