export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn, user } = useUserSession()

  if (!loggedIn.value && to.path.startsWith('/dashboard')) {
    return navigateTo('/login')
  }

  if (loggedIn.value && (to.path === '/login' || to.path === '/register')) {
    if (user.value?.role === 'admin') {
      return navigateTo('/dashboard/admin')
    }
    return navigateTo('/dashboard')
  }

  // Redirect admin from farmer dashboard to admin dashboard
  if (loggedIn.value && user.value?.role === 'admin' && to.path === '/dashboard') {
    return navigateTo('/dashboard/admin')
  }
})
