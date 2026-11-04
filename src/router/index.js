import { createRouter, createWebHistory } from 'vue-router'
import { supabase } from '../lib/supabase'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    name: 'feed',
    component: () => import('../views/FeedView.vue')
  },
  {
    path: '/checkin',
    name: 'checkin',
    component: () => import('../views/CheckinView.vue')
  },
  {
    path: '/dishes',
    name: 'dishes',
    component: () => import('../views/DishesView.vue')
  },
  {
    path: '/board',
    name: 'board',
    component: () => import('../views/BoardView.vue')
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue')
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

/** 统一登录守卫：未登录只能进入登录页 */
router.beforeEach(async (to) => {
  if (to.meta.public) {
    // 已登录时无需再看登录页
    if (to.name === 'login') {
      const {
        data: { session }
      } = await supabase.auth.getSession()
      if (session) return { name: 'feed' }
    }
    return true
  }

  const {
    data: { session }
  } = await supabase.auth.getSession()
  if (!session) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
