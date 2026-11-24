import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { page } from './lib/links';

// 머리글의 제목은 매뉴얼 첫 화면으로 보낸다.
export const onRequest = defineRouteMiddleware((context) => {
  context.locals.starlightRoute.siteTitleHref = page('');
});
