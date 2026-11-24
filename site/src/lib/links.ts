// 사이트 안 주소를 base(/ddobakddobak/manual) 아래로 만든다.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** 매뉴얼 안 주소. */
export const page = (path: string) => `${base}/${path}`;

/** 또박또박 소개(랜딩) 페이지. */
export const LANDING_URL = 'https://jongik-sv.github.io/ddobakddobak/landing/';
export const GITHUB_URL = 'https://github.com/jongik-sv/ddobakddobak';
