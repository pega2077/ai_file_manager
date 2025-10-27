import { createContext } from "react";

export type ThemeMode = "light" | "dark";

export interface ThemeChangeOptions {
  persist?: boolean;
  followSystem?: boolean;
}

export interface ThemeFollowSystemOptions {
  persist?: boolean;
}

export interface ThemeContextValue {
  mode: ThemeMode;
  isDarkMode: boolean;
  followSystem: boolean;
  setMode: (mode: ThemeMode, options?: ThemeChangeOptions) => Promise<void>;
  toggleMode: (options?: ThemeChangeOptions) => Promise<void>;
  setFollowSystem: (shouldFollow: boolean, options?: ThemeFollowSystemOptions) => Promise<void>;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
