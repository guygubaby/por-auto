import { createRouter, createWebHashHistory } from 'vue-router';
import { nextTick } from 'vue';
import { routes } from 'vue-router/auto-routes';

export const router = createRouter({ history: createWebHashHistory(), routes });
router.afterEach(async route => {
  document.title = `${String(route.meta.title ?? '工作台')} · Por Auto`;
  await nextTick();
  document.getElementById('main-content')?.scrollTo({ top: 0 });
  document.getElementById('main-content')?.focus({ preventScroll: true });
});
