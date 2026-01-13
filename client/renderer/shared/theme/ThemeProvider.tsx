import { ConfigProvider, theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { AppConfig } from "../types";
import {
  ThemeContext,
  type ThemeChangeOptions,
  type ThemeFollowSystemOptions,
  type ThemeMode,
} from "./context";

import { useTranslation } from "../i18n/I18nProvider";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";

const fallbackTheme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
};

const ThemeProvider = ({ children }: PropsWithChildren) => {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [followSystem, setFollowSystemState] = useState<boolean>(true);
  const { locale } = useTranslation();

  const applySystemPreference = useCallback((): ThemeMode => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      setModeState("light");
      return "light";
    }
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const nextMode = prefersDark ? "dark" : "light";
    setModeState(nextMode);
    return nextMode;
  }, []);

  const persistPreference = useCallback(
    async (
      modeToPersist: ThemeMode | undefined,
      shouldFollowSystem: boolean
    ) => {
      try {
        const updates: Partial<AppConfig> = {
          themeFollowSystem: shouldFollowSystem,
        };

        if (shouldFollowSystem) {
          updates.theme = undefined;
        } else if (modeToPersist) {
          updates.theme = modeToPersist;
        } else {
          updates.theme = undefined;
        }

        await window.electronAPI.updateAppConfig(updates);
      } catch (error) {
        if (window.electronAPI?.logError) {
          void window.electronAPI.logError(
            "Failed to persist theme preference",
            {
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
        throw error;
      }
    },
    []
  );

  const setMode = useCallback(
    async (nextMode: ThemeMode, options?: ThemeChangeOptions) => {
      const previousFollowSystem = followSystem;
      let previousMode: ThemeMode = mode;
      let didChange = false;
      let nextFollowSystem = followSystem;

      setModeState((current) => {
        previousMode = current;
        if (current === nextMode) {
          return current;
        }
        didChange = true;
        return nextMode;
      });

      if (typeof options?.followSystem === "boolean") {
        nextFollowSystem = options.followSystem;
        setFollowSystemState(options.followSystem);
      } else if (options?.persist) {
        nextFollowSystem = false;
        setFollowSystemState(false);
      }

      if (!options?.persist) {
        return;
      }

      try {
        await persistPreference(
          nextFollowSystem ? undefined : nextMode,
          nextFollowSystem
        );
      } catch (error) {
        if (didChange) {
          setModeState(previousMode);
        }
        setFollowSystemState(previousFollowSystem);
        throw error;
      }
    },
    [followSystem, mode, persistPreference]
  );

  const toggleMode = useCallback(
    async (options?: ThemeChangeOptions) => {
      if (followSystem) {
        return;
      }
      const nextMode: ThemeMode = mode === "dark" ? "light" : "dark";
      await setMode(nextMode, options);
    },
    [followSystem, mode, setMode]
  );

  const setFollowSystem = useCallback(
    async (shouldFollow: boolean, options?: ThemeFollowSystemOptions) => {
      const previousFollow = followSystem;
      const previousMode = mode;

      setFollowSystemState(shouldFollow);

      let resultingMode = previousMode;
      if (shouldFollow) {
        resultingMode = applySystemPreference();
      }

      if (!options?.persist) {
        return;
      }

      try {
        await persistPreference(
          shouldFollow ? undefined : resultingMode,
          shouldFollow
        );
      } catch (error) {
        setFollowSystemState(previousFollow);
        if (shouldFollow) {
          setModeState(previousMode);
        }
        throw error;
      }
    },
    [applySystemPreference, followSystem, mode, persistPreference]
  );

  useEffect(() => {
    let cancelled = false;

    const loadThemePreference = async () => {
      try {
        const config = (await window.electronAPI.getAppConfig()) as
          | AppConfig
          | undefined;
        if (cancelled) {
          return;
        }
        if (config?.themeFollowSystem) {
          setFollowSystemState(true);
          if (!cancelled) {
            applySystemPreference();
          }
          return;
        }
        if (config?.theme === "dark" || config?.theme === "light") {
          setFollowSystemState(false);
          setModeState(config.theme);
          return;
        }
        setFollowSystemState(true);
        if (!cancelled) {
          applySystemPreference();
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (window.electronAPI?.logError) {
          void window.electronAPI.logError("Failed to load theme preference", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        setFollowSystemState(true);
        if (!cancelled) {
          applySystemPreference();
        }
      }
    };

    void loadThemePreference();

    return () => {
      cancelled = true;
    };
  }, [applySystemPreference]);

  useEffect(() => {
    if (
      !followSystem ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (matches: boolean) => {
      setModeState(matches ? "dark" : "light");
    };

    apply(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      apply(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handler);
      return () => {
        mediaQuery.removeEventListener("change", handler);
      };
    }

    mediaQuery.addListener(handler);
    return () => {
      mediaQuery.removeListener(handler);
    };
  }, [followSystem]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    document.body.setAttribute("data-theme", mode);
  }, [mode]);

  const themeConfig = useMemo<ThemeConfig>(
    () => ({
      algorithm:
        mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    }),
    [mode]
  );

  const contextValue = useMemo(
    () => ({
      mode,
      isDarkMode: mode === "dark",
      followSystem,
      setMode,
      toggleMode,
      setFollowSystem,
    }),
    [followSystem, mode, setFollowSystem, setMode, toggleMode]
  );

  const antdLocale = useMemo(() => {
    switch (locale) {
      case "zh":
        return zhCN;
      case "en":
        return enUS;
      default:
        return enUS;
    }
  }, [locale]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <ConfigProvider locale={antdLocale} theme={themeConfig ?? fallbackTheme}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
};

export default ThemeProvider;
