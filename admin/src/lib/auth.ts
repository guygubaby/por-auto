export const TOKEN_STORAGE_KEY = 'porauto.admin.token'

export function readAdminToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeAdminToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // 隐私模式下写不进去，本次会话仍然可用
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // 忽略
  }
}
