const TOKEN_KEY = 'sova_token';
const USER_KEY = 'sova_user';

export interface User {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function mockLogin(): void {
  const fakeToken = 'mock_' + Math.random().toString(36).slice(2);
  const fakeUser: User = {
    id: 123456789,
    first_name: 'Дмитрий',
    last_name: 'М.',
    username: 'dmitry_m',
  };
  localStorage.setItem(TOKEN_KEY, fakeToken);
  localStorage.setItem(USER_KEY, JSON.stringify(fakeUser));
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
