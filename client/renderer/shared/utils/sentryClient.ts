import * as Sentry from "@sentry/react";
import type { AppConfig } from "../types";

let initialized = false;

const logInitializationError = async (message: string, meta?: Record<string, unknown>) => {
  try {
    if (window.electronAPI?.logError) {
      await window.electronAPI.logError(message, meta);
    }
  } catch (error) {
    console.error("Failed to log Sentry initialization error", error);
  }
};

export const initializeSentry = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  if (!window.electronAPI?.getAppConfig) {
    return;
  }

  try {
    const appConfig = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
    const dsn = appConfig?.sentry?.dsn;
    if (!dsn) {
      return;
    }

    const environment = appConfig?.sentry?.environment ?? import.meta.env.MODE ?? "production";

    Sentry.init({
      dsn,
      environment,
      tracesSampleRate: 0,
      autoSessionTracking: false,
      sendDefaultPii: false,
    });

    if (appConfig?.llmProvider) {
      Sentry.setTag("llm_provider", appConfig.llmProvider);
    }
    Sentry.setTag("include_logs_default", String(Boolean(appConfig?.sentry?.sendLogsByDefault)));

    initialized = true;
  } catch (error) {
    console.error("Failed to initialize Sentry client", error);
    await logInitializationError("Renderer Sentry initialization failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
