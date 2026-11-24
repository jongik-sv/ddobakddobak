// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkMissingImages from './plugins/remark-missing-images.mjs';

// 게시 주소: https://jongik-sv.github.io/ddobakddobak/manual/ (매뉴얼 첫 화면)
// 랜딩 페이지는 https://jongik-sv.github.io/ddobakddobak/landing/ 에 따로 있다.
export default defineConfig({
  site: 'https://jongik-sv.github.io',
  base: '/ddobakddobak/manual',
  markdown: { remarkPlugins: [remarkMissingImages] },
  integrations: [
    starlight({
      title: '또박또박 사용자 매뉴얼',
      logo: { src: './src/assets/brand/logo.png', alt: '' },
      favicon: '/favicon.png',
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://cdn.jsdelivr.net', crossorigin: true } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css',
          },
        },
      ],
      customCss: ['./src/styles/brand.css', './src/styles/manual.css'],
      components: {
        Hero: './src/components/ManualHero.astro',
        SocialIcons: './src/components/HeaderLinks.astro',
      },
      routeMiddleware: './src/route-data.ts',
      defaultLocale: 'root',
      locales: {
        root: { label: '한국어', lang: 'ko' },
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jongik-sv/ddobakddobak' },
      ],
      sidebar: [
        { label: '시작하기', items: [{ autogenerate: { directory: 'start' } }] },
        { label: '프로젝트와 폴더', items: [{ autogenerate: { directory: 'projects' } }] },
        { label: '회의', items: [{ autogenerate: { directory: 'meetings' } }] },
        { label: '녹음과 전사', items: [{ autogenerate: { directory: 'recording' } }] },
        { label: '회의록', items: [{ autogenerate: { directory: 'minutes' } }] },
        { label: '검색과 AI 챗', items: [{ autogenerate: { directory: 'ai' } }] },
        { label: '공유와 내보내기', items: [{ autogenerate: { directory: 'share' } }] },
        { label: '예약과 자동화', items: [{ autogenerate: { directory: 'schedule' } }] },
        { label: '설정', items: [{ autogenerate: { directory: 'settings' } }] },
        { label: '휴지통', items: [{ autogenerate: { directory: 'trash' } }] },
        { label: '도움말', items: [{ autogenerate: { directory: 'help' } }] },
      ],
    }),
  ],
});
