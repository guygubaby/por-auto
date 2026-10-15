import { createRouter, createWebHashHistory } from 'vue-router';
import { routes } from 'vue-router/auto-routes';

export const router = createRouter({ history: createWebHashHistory(), routes });
router.afterEach(route => {
  document.title = `${String(route.meta.title ?? '工作台')} · Por Auto`;
  document.getElementById('main-content')?.scrollTo({ top: 0 });
});
