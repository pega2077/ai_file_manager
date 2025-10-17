import {
  Layout,
  Card,
  Typography,
  Switch,
  Input,
  Button,
  message,
  Modal,
  Select,
  InputNumber,
  Alert,
  Spin,
  Descriptions,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiService } from "../services/api";
import { useTranslation } from "../shared/i18n/I18nProvider";
import {
  defaultLocale,
  normalizeLocale,
  type SupportedLocale,
} from "../shared/i18n";
import type { ApiError, PegaUser } from "../services/api";

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

type LlmProvider =
  | "ollama"
  | "openai"
  | "azure-openai"
  | "openrouter"
  | "bailian"
  | "pega";

interface SettingsState {
  theme: "light" | "dark";
  language: SupportedLocale;
  autoSave: boolean;
  showHiddenFiles: boolean;
  enablePreview: boolean;
  autoSaveRAG: boolean;
  autoTagEnabled: boolean;
  tagSummaryMaxLength: number;
  autoClassifyWithoutConfirmation: boolean;
  workDirectory: string;
  useLocalService: boolean;
  llmProvider: LlmProvider;
  pegaApiKey: string;
}

const DEFAULT_SETTINGS: SettingsState = {
  theme: "light",
  language: defaultLocale,
  autoSave: true,
  showHiddenFiles: false,
  enablePreview: true,
  autoSaveRAG: true,
  autoTagEnabled: false,
  tagSummaryMaxLength: 1000,
  autoClassifyWithoutConfirmation: false,
  workDirectory: "",
  useLocalService: true,
  llmProvider: "ollama",
  pegaApiKey: "",
};

const Settings = () => {
  const navigate = useNavigate();
  const { t, locale, setLocale, availableLocales, localeLabels } =
    useTranslation();
  const [settings, setSettings] = useState<SettingsState>(() => ({
    ...DEFAULT_SETTINGS,
    language: locale,
  }));
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:8000");
  const [pegaAuthToken, setPegaAuthTokenState] = useState("");
  const [pegaUser, setPegaUser] = useState<PegaUser | null>(null);
  const [pegaUserLoading, setPegaUserLoading] = useState(false);
  const [pegaUserError, setPegaUserError] = useState<string | null>(null);

  const languageOptions = useMemo(
    () =>
      availableLocales.map((localeKey) => ({
        value: localeKey,
        label: localeLabels[localeKey],
      })),
    [availableLocales, localeLabels]
  );

  const providerOptions = useMemo(
    () => [
      { value: "ollama", label: t("settings.options.llmProviders.ollama") },
      { value: "pega", label: t("settings.options.llmProviders.pega") },
      { value: "openai", label: t("settings.options.llmProviders.openai") },
      {
        value: "openrouter",
        label: t("settings.options.llmProviders.openrouter"),
      },
      { value: "bailian", label: t("settings.options.llmProviders.bailian") },
      {
        value: "azure-openai",
        label: t("settings.options.llmProviders.azureOpenai"),
      },
    ],
    [t]
  );

  const truncatedPegaKey = useMemo(() => {
    const key = settings.pegaApiKey.trim();
    if (!key) {
      return t("settings.messages.pegaKeyMissing");
    }
    if (key.length <= 8) {
      return key;
    }
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
  }, [settings.pegaApiKey, t]);

  const hasPegaToken = useMemo(
    () => pegaAuthToken.trim().length > 0,
    [pegaAuthToken]
  );

  const pegaNumberFormatter = useMemo(
    () => new Intl.NumberFormat(locale),
    [locale]
  );

  const formatPegaValue = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) {
      return t("settings.messages.pegaValueUnavailable");
    }
    if (typeof value === "number") {
      return pegaNumberFormatter.format(value);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : t("settings.messages.pegaValueUnavailable");
  };

  const formatPegaDate = (value: string | null) => {
    if (!value) {
      return t("settings.messages.pegaValueUnavailable");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString(locale);
  };

  useEffect(() => {
    const loadSettings = async () => {
      let nextState: SettingsState = { ...DEFAULT_SETTINGS, language: locale };

      try {
        const appConfig =
          (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
        if (appConfig) {
          const normalizedLanguage = normalizeLocale(
            appConfig.language ?? defaultLocale
          );
          const provider = (appConfig.llmProvider ??
            DEFAULT_SETTINGS.llmProvider) as LlmProvider;
          const pegaKey =
            typeof appConfig.pega?.pegaApiKey === "string"
              ? appConfig.pega.pegaApiKey
              : "";
          const pegaToken =
            typeof appConfig.pega?.pegaAuthToken === "string"
              ? appConfig.pega.pegaAuthToken
              : "";
          nextState = {
            ...nextState,
            theme: appConfig.theme ?? DEFAULT_SETTINGS.theme,
            language: normalizedLanguage,
            autoSave: Boolean(appConfig.autoSave ?? DEFAULT_SETTINGS.autoSave),
            showHiddenFiles: Boolean(
              appConfig.showHiddenFiles ?? DEFAULT_SETTINGS.showHiddenFiles
            ),
            enablePreview: Boolean(
              appConfig.enablePreview ?? DEFAULT_SETTINGS.enablePreview
            ),
            autoSaveRAG: Boolean(
              appConfig.autoSaveRAG ?? DEFAULT_SETTINGS.autoSaveRAG
            ),
            autoTagEnabled: Boolean(
              appConfig.autoTagEnabled ?? DEFAULT_SETTINGS.autoTagEnabled
            ),
            tagSummaryMaxLength: Number.isFinite(
              Number(appConfig.tagSummaryMaxLength)
            )
              ? Math.max(1, Math.floor(Number(appConfig.tagSummaryMaxLength)))
              : DEFAULT_SETTINGS.tagSummaryMaxLength,
            autoClassifyWithoutConfirmation: Boolean(
              appConfig.autoClassifyWithoutConfirmation ??
                DEFAULT_SETTINGS.autoClassifyWithoutConfirmation
            ),
            workDirectory: String(
              appConfig.workDirectory ?? DEFAULT_SETTINGS.workDirectory
            ),
            useLocalService: Boolean(
              appConfig.useLocalService ?? DEFAULT_SETTINGS.useLocalService
            ),
            llmProvider: provider,
            pegaApiKey: pegaKey,
          };

          if (normalizedLanguage !== locale) {
            setLocale(normalizedLanguage);
          }

          apiService.setProvider(provider);
          apiService.setPegaAuthToken(pegaToken);
          setPegaAuthTokenState(pegaToken);
        }
      } catch (error) {
        console.error("Failed to load app config:", error);
      }

      try {
        const url = await window.electronAPI.getApiBaseUrl();
        setApiBaseUrl(url);
      } catch (error) {
        console.error("Failed to load API base URL:", error);
      }

      setSettings(nextState);
    };

    void loadSettings();
  }, [locale, setLocale]);

  useEffect(() => {
    setSettings((prev) =>
      prev.language === locale ? prev : { ...prev, language: locale }
    );
  }, [locale]);

  useEffect(() => {
    apiService.setLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (settings.useLocalService) {
      setApiBaseUrl("http://localhost:8000");
    }
  }, [settings.useLocalService]);

  useEffect(() => {
    let cancelled = false;

    if (settings.llmProvider !== "pega") {
      setPegaUser(null);
      setPegaUserError(null);
      setPegaUserLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const normalizedToken = pegaAuthToken.trim();
    if (!normalizedToken) {
      setPegaUser(null);
      setPegaUserError(null);
      setPegaUserLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const fetchUser = async () => {
      setPegaUserLoading(true);
      setPegaUserError(null);
      try {
        const response = await apiService.getPegaCurrentUser(normalizedToken);
        if (cancelled) {
          return;
        }
        setPegaUser(response.user ?? null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPegaUser(null);
        console.error("Failed to load Pega account information:", error);
        const maybeApiError = error as ApiError;
        if (maybeApiError?.status === 401) {
          setPegaUserError(t("settings.messages.pegaUnauthorized"));
          return;
        }
        if (maybeApiError?.status === 404) {
          setPegaUserError(t("settings.messages.pegaUserNotFound"));
          return;
        }
        setPegaUserError(t("settings.messages.pegaFetchUserFailed"));
      } finally {
        if (!cancelled) {
          setPegaUserLoading(false);
        }
      }
    };

    void fetchUser();

    return () => {
      cancelled = true;
    };
  }, [settings.llmProvider, pegaAuthToken, t]);

  const handleSettingChange = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K]
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleLocaleChange = async (value: SupportedLocale) => {
    if (value !== locale) {
      const newSettings = { ...settings, language: value };
      try {
        await window.electronAPI.updateAppConfig({ language: value });
      } catch (error) {
        console.error("Failed to save language:", error);
      }
      setLocale(value);
      setSettings(newSettings);
    }
  };

  const handleProviderChange = async (value: LlmProvider) => {
    apiService.setProvider(value);
    setSettings((prev) => ({
      ...prev,
      llmProvider: value,
    }));
    try {
      await window.electronAPI.updateAppConfig({ llmProvider: value });
      message.success(t("settings.messages.providerUpdated"));
    } catch (error) {
      message.error(t("settings.messages.providerUpdateError"));
      console.error("Failed to update provider:", error);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await window.electronAPI.updateAppConfig({
        theme: settings.theme,
        language: settings.language,
        autoSave: settings.autoSave,
        showHiddenFiles: settings.showHiddenFiles,
        enablePreview: settings.enablePreview,
        autoSaveRAG: settings.autoSaveRAG,
        autoTagEnabled: settings.autoTagEnabled,
        tagSummaryMaxLength: settings.tagSummaryMaxLength,
        autoClassifyWithoutConfirmation:
          settings.autoClassifyWithoutConfirmation,
        useLocalService: settings.useLocalService,
      });
      message.success(t("settings.messages.saveSuccess"));
    } catch (error) {
      message.error(t("settings.messages.saveError"));
      console.error(error);
    }
  };

  // const handleSaveApiBaseUrl = async () => {
  //   try {
  //     if (window.electronAPI) {
  //       const urlToSave = settings.useLocalService
  //         ? "http://localhost:8000"
  //         : apiBaseUrl;
  //       await window.electronAPI.setApiBaseUrl(urlToSave);
  //       updateApiBaseUrl(urlToSave);
  //       message.success(t("settings.messages.apiSuccess"));
  //     }
  //   } catch (error) {
  //     message.error(t("settings.messages.apiError"));
  //     console.error(error);
  //   }
  // };

  const handleResetSettings = () => {
    const nextState: SettingsState = {
      ...DEFAULT_SETTINGS,
      language: defaultLocale,
      workDirectory: settings.workDirectory,
    };
    setSettings(nextState);
    setLocale(defaultLocale);
    apiService.setProvider(nextState.llmProvider);
    message.success(t("settings.messages.resetSuccess"));
  };

  const handleClearAllData = () => {
    Modal.confirm({
      title: t("settings.messages.clearConfirmTitle"),
      content: t("settings.messages.clearConfirmContent"),
      okText: t("settings.messages.clearConfirmOk"),
      cancelText: t("settings.messages.clearConfirmCancel"),
      okType: "danger",
      onOk: async () => {
        try {
          // Use Electron main process to clear data and relaunch the app
          await window.electronAPI.clearAllData();
          // Mark app as uninitialized before restarting
          await window.electronAPI.updateAppConfig({
            isInitialized: false,
            workDirectory: "",
          });
          setSettings((prev) => ({ ...prev, workDirectory: "" }));
          setPegaAuthTokenState("");
          setPegaUser(null);
          setPegaUserError(null);
          apiService.setPegaAuthToken(null);
        } catch (error) {
          message.error(t("settings.messages.clearException"));
          console.error("Clear data error:", error);
        }
      },
    });
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Content style={{ padding: "24px", background: "#fff" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <Title level={2}>{t("settings.pageTitle")}</Title>

          <Card
            title={t("settings.sections.general")}
            style={{ marginBottom: 24 }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <div>
                <Text strong>{t("settings.labels.theme")}</Text>
                <Switch
                  checkedChildren={t("settings.themeOptions.dark")}
                  unCheckedChildren={t("settings.themeOptions.light")}
                  checked={settings.theme === "dark"}
                  onChange={(checked) =>
                    handleSettingChange("theme", checked ? "dark" : "light")
                  }
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>{t("settings.labels.language")}</Text>
                <Select
                  style={{ marginLeft: 16, minWidth: 160 }}
                  value={settings.language}
                  options={languageOptions}
                  onChange={(value) =>
                    handleLocaleChange(value as SupportedLocale)
                  }
                />
              </div>

              <div>
                <Text strong>{t("settings.labels.autoSave")}</Text>
                <Switch
                  checkedChildren={t("settings.common.enabled")}
                  unCheckedChildren={t("settings.common.disabled")}
                  checked={settings.autoSave}
                  onChange={(checked) =>
                    handleSettingChange("autoSave", checked)
                  }
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>{t("settings.labels.showHiddenFiles")}</Text>
                <Switch
                  checkedChildren={t("settings.common.enabled")}
                  unCheckedChildren={t("settings.common.disabled")}
                  checked={settings.showHiddenFiles}
                  onChange={(checked) =>
                    handleSettingChange("showHiddenFiles", checked)
                  }
                  style={{ marginLeft: 16 }}
                />
              </div>

              <div>
                <Text strong>{t("settings.labels.enablePreview")}</Text>
                <Switch
                  checkedChildren={t("settings.common.enabled")}
                  unCheckedChildren={t("settings.common.disabled")}
                  checked={settings.enablePreview}
                  onChange={(checked) =>
                    handleSettingChange("enablePreview", checked)
                  }
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t("settings.descriptions.enablePreview")}
                </Text>
              </div>

              <div>
                <Text strong>{t("settings.labels.autoSaveRAG")}</Text>
                <Switch
                  checkedChildren={t("settings.common.enabled")}
                  unCheckedChildren={t("settings.common.disabled")}
                  checked={settings.autoSaveRAG}
                  onChange={(checked) =>
                    handleSettingChange("autoSaveRAG", checked)
                  }
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t("settings.descriptions.autoSaveRAG")}
                </Text>
              </div>

              <div>
                <Text strong>{t("settings.labels.autoTagEnabled")}</Text>
                <Switch
                  checkedChildren={t("settings.common.enabled")}
                  unCheckedChildren={t("settings.common.disabled")}
                  checked={settings.autoTagEnabled}
                  onChange={(checked) =>
                    handleSettingChange("autoTagEnabled", checked)
                  }
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t("settings.descriptions.autoTagEnabled")}
                </Text>
              </div>

              <div>
                <Text strong>{t("settings.labels.tagSummaryMaxLength")}</Text>
                <InputNumber
                  min={1}
                  max={10000}
                  step={100}
                  value={settings.tagSummaryMaxLength}
                  onChange={(value) =>
                    handleSettingChange(
                      "tagSummaryMaxLength",
                      Math.max(1, Math.floor(Number(value || 0)))
                    )
                  }
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t("settings.descriptions.tagSummaryMaxLength")}
                </Text>
              </div>

              <div>
                <Text strong>{t("settings.labels.autoClassify")}</Text>
                <Switch
                  checkedChildren={t("settings.common.enabled")}
                  unCheckedChildren={t("settings.common.disabled")}
                  checked={settings.autoClassifyWithoutConfirmation}
                  onChange={(checked) =>
                    handleSettingChange(
                      "autoClassifyWithoutConfirmation",
                      checked
                    )
                  }
                  style={{ marginLeft: 16 }}
                />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  {t("settings.descriptions.autoClassify")}
                </Text>
              </div>
            </div>
          </Card>

          <Card title={t("settings.sections.llm")} style={{ marginBottom: 24 }}>
            <div
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <div>
                <Text strong>{t("settings.labels.llmProvider")}</Text>
                <Select
                  style={{ marginLeft: 16, minWidth: 200 }}
                  value={settings.llmProvider}
                  options={providerOptions}
                  onChange={(value) =>
                    handleProviderChange(value as LlmProvider)
                  }
                />
                <Text
                  type="secondary"
                  style={{ display: "block", marginTop: 8 }}
                >
                  {t("settings.descriptions.llmProvider")}
                </Text>
              </div>

              <div>
                <Text strong>{t("settings.labels.providerConfigPages")}</Text>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  <Button onClick={() => navigate("/settings/providers/ollama")}>
                    {t("settings.actions.configureOllama")}
                  </Button>
                  <Button onClick={() => navigate("/settings/providers/openai")}>
                    {t("settings.actions.configureOpenai")}
                  </Button>
                  <Button onClick={() => navigate("/settings/providers/openrouter")}>
                    {t("settings.actions.configureOpenrouter")}
                  </Button>
                  <Button onClick={() => navigate("/settings/providers/bailian")}>
                    {t("settings.actions.configureBailian")}
                  </Button>
                </div>
                <Text
                  type="secondary"
                  style={{ display: "block", marginTop: 8 }}
                >
                  {t("settings.descriptions.providerConfigPages")}
                </Text>
              </div>

              {settings.llmProvider === "pega" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div>
                    <Text strong>{t("settings.labels.pegaApiKey")}</Text>
                    <div style={{ marginTop: 8 }}>
                      <Text code>{truncatedPegaKey}</Text>
                    </div>
                    <Text
                      type="secondary"
                      style={{ display: "block", marginTop: 8 }}
                    >
                      {t("settings.descriptions.pegaApiKey")}
                    </Text>
                  </div>

                  <div>
                    <Text strong>{t("settings.labels.pegaAccount")}</Text>
                    {hasPegaToken ? (
                      pegaUserLoading ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 8,
                          }}
                        >
                          <Spin size="small" />
                          <Text type="secondary">
                            {t("settings.messages.pegaLoadingUser")}
                          </Text>
                        </div>
                      ) : pegaUser ? (
                        <Descriptions
                          size="small"
                          column={1}
                          style={{ marginTop: 8 }}
                        >
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserEmail")}
                          >
                            {formatPegaValue(pegaUser.email)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserPhone")}
                          >
                            {formatPegaValue(pegaUser.phone)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserStatus")}
                          >
                            {formatPegaValue(pegaUser.status)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserIp")}
                          >
                            {formatPegaValue(pegaUser.ip)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserTokenBalance")}
                          >
                            {formatPegaValue(pegaUser.tokenBalance)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserMonthlyTokenQuota")}
                          >
                            {formatPegaValue(pegaUser.monthlyTokenQuota)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserCreatedAt")}
                          >
                            {formatPegaDate(pegaUser.createdAt)}
                          </Descriptions.Item>
                          <Descriptions.Item
                            label={t("settings.labels.pegaUserUpdatedAt")}
                          >
                            {formatPegaDate(pegaUser.updatedAt)}
                          </Descriptions.Item>
                        </Descriptions>
                      ) : (
                        <Alert
                          type="warning"
                          showIcon
                          style={{ marginTop: 8 }}
                          message={t("settings.messages.pegaUserMissing")}
                        />
                      )
                    ) : (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginTop: 8 }}
                        message={t("settings.messages.pegaLoginRestriction")}
                      />
                    )}

                    {pegaUserError && (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginTop: 8 }}
                        message={pegaUserError}
                      />
                    )}
                  </div>

                  <Button
                    type="primary"
                    style={{ marginTop: 12 }}
                    onClick={() => navigate("/settings/pega-auth")}
                  >
                    {t("settings.actions.managePegaAccount")}
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card
            title={t("settings.sections.workDirectory")}
            style={{ marginBottom: 24 }}
          >
            <div>
              <Text strong>{t("settings.labels.workDirectory")}</Text>
              <TextArea
                value={settings.workDirectory}
                readOnly
                rows={2}
                style={{ marginTop: 8 }}
              />
              <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                {t("settings.descriptions.workDirectory")}
              </Text>
            </div>
          </Card>

          <Card title={t("settings.sections.api")} style={{ marginBottom: 24 }}>
            <div>
              <Text strong>{t("settings.labels.apiBaseUrl")}</Text>
              <Input
                value={apiBaseUrl}
                readOnly={true}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder={t("settings.placeholders.apiBaseUrl")}
                style={{ marginTop: 8, marginBottom: 8 }}
                disabled={settings.useLocalService}
              />
              <Text type="secondary" style={{ display: "block" }}>
                {t("settings.descriptions.apiBaseUrl")}
              </Text>
              {/* <Button type="primary" onClick={handleSaveApiBaseUrl} style={{ marginTop: 8 }}>
                {t('settings.actions.saveApiBaseUrl')}
              </Button> */}
            </div>
          </Card>

          <Card title={t("settings.sections.actions")}>
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              <Button type="primary" onClick={handleSaveSettings}>
                {t("settings.actions.save")}
              </Button>
              <Button onClick={handleResetSettings}>
                {t("settings.actions.reset")}
              </Button>
              <Button danger onClick={handleClearAllData}>
                {t("settings.actions.clear")}
              </Button>
              <Button onClick={() => navigate("/files")}>
                {t("settings.actions.back")}
              </Button>
            </div>
          </Card>
        </div>
      </Content>
    </Layout>
  );
};

export default Settings;
