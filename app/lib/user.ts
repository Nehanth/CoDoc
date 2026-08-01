"use client";

import { useEffect, useState } from "react";

export type Role = "pcp" | "specialist" | "patient";

export type User = {
  id: number;
  role: Role;
  name: string;
  patientName?: string;
};

const KEY = "codoc-user";

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function storeUser(user: User) {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function logout() {
  localStorage.removeItem(KEY);
  window.location.href = "/login";
}

export function homeFor(role: Role): string {
  return role === "pcp" ? "/" : role === "specialist" ? "/referrals" : "/me";
}

/** Client-side guard: redirects to /login when signed out, or to the user's
 *  home when their role isn't allowed here. */
export function useUser(allowed: Role[]): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      window.location.href = "/login";
      return;
    }
    if (!allowed.includes(u.role)) {
      window.location.href = homeFor(u.role);
      return;
    }
    setUser(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return user;
}
