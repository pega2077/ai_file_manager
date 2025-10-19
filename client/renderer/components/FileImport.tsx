import React, {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useRef,
} from "react";
import { Button, Modal, Select, TreeSelect, message } from "antd";
import { useTranslation } from "../shared/i18n/I18nProvider";
import { apiService } from "../services/api";
import type { ApiError } from "../services/api";
import type {
  DirectoryStructureResponse,
  RecommendDirectoryResponse,
  TreeNode,
  ImportedFileItem,
} from "../shared/types";
import {
  dispatchFileImportNotification,
  FileImportStep,
  FileImportStepState,
} from "../shared/events/fileImportEvents";

type FileImportProps = {
  onImported?: () => void;
};

type ProcessFileResult = "complete" | "pending-user-action";

type ImportMode = "new" | "retry";

type EnqueueTaskPayload = {
  path: string;
  mode: ImportMode;
  existingFileId?: string;
  displayName?: string;
};

type QueuedImportTask = EnqueueTaskPayload & {
  deferred: {
    resolve: () => void;
    reject: (error: unknown) => void;
  };
};

const CONVERSION_ERROR_CODES = new Set([
  "CONVERSION_FAILED",
  "CONVERSION_ERROR",
  "IMPORT_RAG_ERROR",
  "PANDOC_NOT_FOUND",
  "PANDOC_NOT_AVAILABLE",
  "MARKITDOWN_ERROR",
  "CONVERTER_UNAVAILABLE",
]);

const CONVERSION_KEYWORDS = [
  "convert",
  "conversion",
  "pandoc",
  "markitdown",
  "转换",
  "转化",
];

export type FileImportRef = {
  startImport: () => Promise<void> | void;
  importFile: (filePath: string) => Promise<void>;
  retryImport: (file: ImportedFileItem) => Promise<void>;
};

const FileImport = forwardRef<FileImportRef, FileImportProps>(
  ({ onImported }, ref) => {
    const { t } = useTranslation();
    const getConversionMessage = useCallback(
      (error: unknown): string | null => {
        if (!error) {
          return null;
        }

        const maybeApiError = error as Partial<ApiError> | null | undefined;
        const code = typeof maybeApiError?.code === "string" ? maybeApiError.code : undefined;

        const messages: string[] = [];

        if (typeof (error as { message?: unknown }).message === "string") {
          messages.push((error as { message: string }).message);
        }

        const details = maybeApiError?.details;
        if (typeof details === "string") {
          messages.push(details);
        } else if (details && typeof details === "object") {
          const detailMessage = (details as { message?: unknown }).message;
          if (typeof detailMessage === "string") {
            messages.push(detailMessage);
          }
        }

        const payload = maybeApiError?.payload;
        if (payload && typeof payload === "object") {
          const payloadMessage = (payload as { message?: unknown }).message;
          if (typeof payloadMessage === "string") {
            messages.push(payloadMessage);
          }
          const nestedErrorMessage = (payload as { error?: { message?: string } }).error?.message;
          if (typeof nestedErrorMessage === "string") {
            messages.push(nestedErrorMessage);
          }
        }

        const normalizedMessages = messages
          .map((msg) => msg.trim())
          .filter((msg) => msg.length > 0);

        const aggregated = normalizedMessages.join(" ").toLowerCase();
        const hasConversionCode = code ? CONVERSION_ERROR_CODES.has(code) : false;
        const hasKeywordHit = aggregated.length > 0
          ? CONVERSION_KEYWORDS.some((keyword) => aggregated.includes(keyword))
          : false;

        if (!hasConversionCode && !hasKeywordHit) {
          return null;
        }

        const primary = normalizedMessages.find((msg) => msg.length > 0) ?? "";
        const normalizedPrimary = primary.toLowerCase();

        const genericMessages = new Set([
          "conversion failed",
          "conversion error",
          "file conversion failed",
        ]);

        if (!primary || genericMessages.has(normalizedPrimary)) {
          return t("files.messages.conversionError");
        }

        return t("files.messages.conversionErrorWithReason", { reason: primary });
      },
      [t],
    );

    // Local states
    const [workDirectory, setWorkDirectory] = useState<string>("workdir");
    const [importModalVisible, setImportModalVisible] = useState(false);
    const [manualSelectModalVisible, setManualSelectModalVisible] =
      useState(false);
    const [selectedDirectory, setSelectedDirectory] = useState<string>("");
    const [importFilePath, setImportFilePath] = useState<string>("");
    const [stagedFileId, setStagedFileId] = useState<string | null>(null);
    const [directoryOptions, setDirectoryOptions] = useState<TreeNode[]>([]);
    const [directoryTreeData, setDirectoryTreeData] = useState<TreeNode[]>([]);
    const taskIdRef = useRef<string | null>(null);
  const importQueueRef = useRef<QueuedImportTask[]>([]);
  const currentImportRef = useRef<QueuedImportTask | null>(null);
  const isProcessingRef = useRef(false);

    const createTaskId = useCallback(
      () =>
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `import-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      [],
    );

    const notifyStart = useCallback(
      (filePath: string) => {
        const taskId = createTaskId();
        taskIdRef.current = taskId;
        const filename = filePath.split(/[/\\]/).pop();
        dispatchFileImportNotification({
          status: "start",
          taskId,
          filePath,
          filename,
        });
      },
      [createTaskId],
    );

    const notifyProgress = useCallback(
      (
        step: FileImportStep,
        state: FileImportStepState,
        message?: string,
      ) => {
        const taskId = taskIdRef.current;
        if (!taskId) return;
        dispatchFileImportNotification({
          status: "progress",
          taskId,
          step,
          state,
          message,
        });
      },
      [],
    );

    const notifySuccess = useCallback(
      (message?: string) => {
        const taskId = taskIdRef.current;
        if (!taskId) return;
        dispatchFileImportNotification({
          status: "success",
          taskId,
          message,
        });
        taskIdRef.current = null;
      },
      [],
    );

    const notifyError = useCallback(
      (error: unknown, fallbackMessage?: string) => {
        const taskId = taskIdRef.current;
        if (!taskId) return;
        const errorMessage =
          error instanceof Error ? error.message : String(error ?? "Unknown error");
        dispatchFileImportNotification({
          status: "error",
          taskId,
          error: errorMessage,
          message: fallbackMessage,
        });
        taskIdRef.current = null;
      },
      [],
    );

    const notifyCancelled = useCallback(
      (message?: string) => {
        const taskId = taskIdRef.current;
        if (!taskId) return;
        dispatchFileImportNotification({
          status: "cancelled",
          taskId,
          message,
        });
        taskIdRef.current = null;
      },
      [],
    );

    useEffect(() => {
      const loadWorkDirectory = async () => {
        try {
          const cfg =
            (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
          const wd = cfg?.workDirectory as string | undefined;
          if (wd) setWorkDirectory(wd);
        } catch (error) {
          console.error("Failed to load workDirectory:", error);
        }
      };
      void loadWorkDirectory();
    }, []);

    const getPathSeparator = () =>
      navigator.userAgent.includes("Windows") ? "\\" : "/";

    const normalizeForComparison = useCallback((value: string) => {
      const trimmed = (value ?? "").trim();
      if (!trimmed) {
        return "";
      }
      return trimmed
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/g, "")
        .toLowerCase();
    }, []);

    const isPathInsideDirectory = useCallback(
      (filePath: string, directoryPath: string) => {
        const normalizedDir = normalizeForComparison(directoryPath);
        const normalizedFile = normalizeForComparison(filePath);
        if (!normalizedDir || !normalizedFile) {
          return false;
        }
        if (normalizedFile === normalizedDir) {
          return true;
        }
        const dirWithSlash = `${normalizedDir}/`;
        return normalizedFile.startsWith(dirWithSlash);
      },
      [normalizeForComparison],
    );

    const resolveParentDirectory = useCallback((filePath: string) => {
      const trimmed = (filePath ?? "").trim();
      if (!trimmed) {
        return "";
      }
      const lastBackslash = trimmed.lastIndexOf("\\");
      const lastSlash = trimmed.lastIndexOf("/");
      const lastSeparator = Math.max(lastBackslash, lastSlash);
      if (lastSeparator < 0) {
        return "";
      }
      if (/^[a-zA-Z]:[\\/]/.test(trimmed) && lastSeparator <= 2) {
        return trimmed.slice(0, 3);
      }
      if (trimmed.startsWith("/") && lastSeparator === 0) {
        return "/";
      }
      return trimmed.slice(0, lastSeparator);
    }, []);

    const extractDirectoriesFromStructure = useCallback(
      (structureData: DirectoryStructureResponse): string[] => {
        const directories: string[] = [];
        if (structureData && structureData.items) {
          for (const item of structureData.items) {
            if (
              item.type === "folder" &&
              item.relative_path &&
              item.relative_path !== "."
            ) {
              directories.push(item.relative_path);
            }
          }
        }
        return directories;
      },
      []
    );

    const buildDirectoryOptions = useCallback(
      (recommendedDirectory: string, alternatives: string[]): TreeNode[] => {
        const options: TreeNode[] = [];
        options.push({
          title: `${recommendedDirectory} ${t(
            "files.import.suffixRecommended"
          )}`,
          value: recommendedDirectory,
          key: recommendedDirectory,
          children: [],
        });
        alternatives.forEach((alt) => {
          if (alt !== recommendedDirectory) {
            options.push({
              title: `${alt} ${t("files.import.suffixAlternative")}`,
              value: alt,
              key: alt,
              children: [],
            });
          }
        });
        return options;
      },
      [t]
    );

    const buildDirectoryTreeData = useCallback(
      (structureData: DirectoryStructureResponse): TreeNode[] => {
        const treeData: TreeNode[] = [];
        const pathMap = new Map<string, TreeNode>();

        if (structureData && structureData.items) {
          structureData.items.forEach((item) => {
            if (
              item.type === "folder" &&
              item.relative_path &&
              item.relative_path !== "."
            ) {
              const node: TreeNode = {
                title: item.name,
                value: item.relative_path,
                key: item.relative_path,
                children: [],
              };
              pathMap.set(item.relative_path, node);
            }
          });

          pathMap.forEach((node, path) => {
            const parts = path.split("/");
            if (parts.length === 1) {
              treeData.push(node);
            } else {
              const parentPath = parts.slice(0, -1).join("/");
              const parentNode = pathMap.get(parentPath);
              if (parentNode) {
                parentNode.children.push(node);
              }
            }
          });
        }

        return treeData;
      },
      []
    );

    const handleRagImport = useCallback(
      async (fileId: string, noSaveDb: boolean = false) => {
        try {
          const cfg =
            (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
          let hideLoading: undefined | (() => void);
          try {
            if (cfg?.autoSaveRAG) {
              notifyProgress("import-rag", "start", t("files.messages.importingRag"));
              hideLoading = message.loading(
                t("files.messages.importingRag"),
                0
              );
              const ragResponse = await apiService.importToRag(
                fileId,
                noSaveDb
              );
              if (ragResponse.success) {
                notifyProgress("import-rag", "success", t("files.messages.importedRagSuccess"));
                message.success(t("files.messages.importedRagSuccess"));
              } else {
                const failureMessage = getConversionMessage({
                  message: ragResponse.error?.message ?? ragResponse.message,
                  code: ragResponse.error?.code,
                  details: ragResponse.error?.details,
                  payload: ragResponse,
                });
                const displayMessage = failureMessage ?? t("files.messages.saveSuccessRagFailed");
                notifyProgress("import-rag", failureMessage ? "error" : "success", displayMessage);
                if (failureMessage) {
                  message.error(displayMessage);
                } else {
                  message.warning(displayMessage);
                }
              }
            }
          } finally {
            if (hideLoading) hideLoading();
          }
        } catch (error) {
          const conversionMessage = getConversionMessage(error);
          const fallback = t("files.messages.saveSuccessRagFailed");
          const messageToShow = conversionMessage ?? fallback;
          notifyProgress("import-rag", "error", messageToShow);
          if (conversionMessage) {
            message.error(messageToShow);
          } else {
            message.warning(messageToShow);
          }
          window.electronAPI?.logError?.(
            "importToRag (handleRagImport) failed",
            {
              err: String(error),
              conversionMessage: conversionMessage ?? undefined,
            }
          );
        }
      },
      [t, notifyProgress, getConversionMessage]
    );

    const showImportConfirmationDialog = useCallback(
      async (
        filePath: string,
        recommendedDirectory: string,
        alternatives: string[],
        directoryStructure: DirectoryStructureResponse
      ) => {
        setImportFilePath(filePath);
        setSelectedDirectory(recommendedDirectory);
        setDirectoryOptions(
          buildDirectoryOptions(recommendedDirectory, alternatives)
        );
        setDirectoryTreeData(buildDirectoryTreeData(directoryStructure));
        setImportModalVisible(true);
      },
      [buildDirectoryOptions, buildDirectoryTreeData]
    );

    const isImagePath = (p: string) =>
      /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)$/i.test(p);

    // Show long descriptions in segmented messages: split by Chinese/English period or newline
    const showSegmentedInfo = useCallback(
      (text: string) => {
        try {
          const normalized = String(text ?? "").replace(/\r\n/g, "\n");
          const rawSegments = normalized
            .split(/[。.\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const mergedSegments: string[] = [];
          const MIN_SEGMENT_LENGTH = 5;

          for (let i = 0; i < rawSegments.length; i += 1) {
            let current = rawSegments[i];
            if (current.length < MIN_SEGMENT_LENGTH) {
              const next = rawSegments[i + 1];
              if (next) {
                current = `${current} ${next}`.replace(/\s+/g, " ").trim();
                i += 1;
              }
            }
            if (current) {
              mergedSegments.push(current);
            }
          }

          mergedSegments.forEach((seg, idx) => {
            setTimeout(() => {
              try {
                if (idx === 0) {
                  message.info(
                    t("files.messages.imageDescription", { text: seg }),
                    2
                  );
                } else {
                  message.info(seg, 2);
                }

                if (idx >= 10) {
                  // stop after 10 segments to avoid flooding
                  return;
                }
              } catch {
                // ignore message rendering failures
              }
            }, idx * 2000);
          });
        } catch {
          // ignore
        }
      },
      [t]
    );

    const fileToBase64 = async (path: string): Promise<string> => {
      // Use backend preview with downscaling to avoid large payloads.
      try {
        const preview = await apiService.previewFile(path, {
          origin: false,
          maxWidth: 500,
          maxHeight: 500,
        });
        if (preview.success) {
          const data = preview.data as
            | { content?: string; file_type?: string }
            | undefined;
          if (
            data &&
            data.file_type === "image" &&
            typeof data.content === "string"
          ) {
            return data.content;
          }
        }
      } catch (e) {
        // ignore
      }
      return "";
    };

    const processFile = useCallback(
      async (task: QueuedImportTask): Promise<ProcessFileResult> => {
        const normalizedPath = (task.path || "").trim();
        if (!normalizedPath) {
          notifyError("empty_path", t("files.messages.fileImportFailed"));
          return "complete";
        }

        notifyStart(normalizedPath);

        let cfg: import("../shared/types").AppConfig | undefined;
        let latestWorkDir = workDirectory;
        try {
          cfg = (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
          if (cfg?.workDirectory && cfg.workDirectory !== workDirectory) {
            latestWorkDir = cfg.workDirectory;
            setWorkDirectory(cfg.workDirectory);
          }
        } catch (error) {
          message.error(t("files.messages.fileImportFailed"));
          window.electronAPI?.logError?.("processFile getAppConfig failed", {
            err: String(error),
          });
          notifyError(error, t("files.messages.fileImportFailed"));
          return "complete";
        }
        const lang = (cfg?.language || "en") as "zh" | "en";

        const isRetry = task.mode === "retry" && typeof task.existingFileId === "string" && task.existingFileId.trim().length > 0;
        const insideWorkspace = isPathInsideDirectory(normalizedPath, latestWorkDir);
        let stagedPath = normalizedPath;
        let stagedId = task.existingFileId ?? "";

        if (!isRetry && insideWorkspace) {
          const parentDirectory = resolveParentDirectory(normalizedPath);
          if (!parentDirectory) {
            message.error(t("files.messages.fileImportFailed"));
            notifyError("parent_directory_missing", t("files.messages.fileImportFailed"));
            return "complete";
          }

          notifyProgress("save-file", "start");
          let saveResponse;
          try {
            saveResponse = await apiService.saveFile(normalizedPath, parentDirectory, true);
          } catch (err) {
            message.error(t("files.messages.fileSaveFailed"));
            window.electronAPI?.logError?.("saveFile (workspace direct) failed", {
              err: String(err),
              path: normalizedPath,
            });
            notifyError(err, t("files.messages.fileSaveFailed"));
            return "complete";
          }

          if (!saveResponse.success) {
            const errMsg = saveResponse.message || t("files.messages.fileSaveFailed");
            message.error(errMsg);
            notifyError(new Error(errMsg), errMsg);
            return "complete";
          }

          notifyProgress("save-file", "success");
          const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
          onImported?.();

          if (fileId && cfg?.autoSaveRAG) {
            notifyProgress("import-rag", "start", t("files.messages.importingRag"));
            let hideLoadingRag: undefined | (() => void);
            try {
              hideLoadingRag = message.loading(t("files.messages.importingRag"), 0);
              const ragResponse = await apiService.importToRag(fileId, true);
              if (ragResponse.success) {
                notifyProgress("import-rag", "success", t("files.messages.importedRagSuccess"));
                message.success(t("files.messages.importedRagSuccess"));
              } else {
                const failureMessage = getConversionMessage({
                  message: ragResponse.error?.message ?? ragResponse.message,
                  code: ragResponse.error?.code,
                  details: ragResponse.error?.details,
                  payload: ragResponse,
                });
                const fallback = t("files.messages.saveSuccessRagFailed");
                const displayMessage = failureMessage ?? fallback;
                notifyProgress("import-rag", failureMessage ? "error" : "success", displayMessage);
                if (failureMessage) {
                  message.error(displayMessage);
                } else {
                  message.warning(displayMessage);
                }
              }
            } catch (err) {
              const conversionMessage = getConversionMessage(err);
              const fallback = t("files.messages.saveSuccessRagFailed");
              const displayMessage = conversionMessage ?? fallback;
              notifyProgress("import-rag", "error", displayMessage);
              if (conversionMessage) {
                message.error(displayMessage);
              } else {
                message.warning(displayMessage);
              }
              window.electronAPI?.logError?.("importToRag (workspace direct) failed", {
                err: String(err),
                path: normalizedPath,
                conversionMessage: conversionMessage ?? undefined,
              });
            } finally {
              hideLoadingRag?.();
            }
          }

          setStagedFileId(null);
          setImportFilePath("");
          setSelectedDirectory("");
          notifySuccess(t("files.messages.fileInWorkspaceProcessed"));
          message.success(t("files.messages.fileInWorkspaceProcessed"));
          return "complete";
        }

        if (isRetry) {
          notifyProgress("stage-file", "start", t("files.messages.preparingFile"));
          setImportFilePath(stagedPath);
          setStagedFileId(stagedId);
          notifyProgress("stage-file", "success", t("common.success"));
        } else {
          notifyProgress("stage-file", "start", t("files.messages.preparingFile"));
          let hideStaging: undefined | (() => void);
          try {
            hideStaging = message.loading(t("files.messages.preparingFile"), 0);
            const stageResponse = await apiService.stageFileToTemp(stagedPath);
            if (!stageResponse.success) {
              const errMsg = stageResponse.message || t("files.messages.stageFailed");
              message.error(errMsg);
              notifyError(new Error(errMsg), errMsg);
              return "complete";
            }
            const data = stageResponse.data as { staged_path?: string; file_id?: string } | undefined;
            const stagedPathFromResponse = (data?.staged_path || "").trim();
            const stagedIdFromResponse = (data?.file_id || "").trim();
            if (!stagedPathFromResponse || !stagedIdFromResponse) {
              notifyError("stageFileToTemp returned empty", t("files.messages.stageFailed"));
              return "complete";
            }
            stagedPath = stagedPathFromResponse;
            stagedId = stagedIdFromResponse;
            setImportFilePath(stagedPath);
            setStagedFileId(stagedId);
            notifyProgress("stage-file", "success", t("common.success"));
          } catch (err) {
            message.error(t("files.messages.stageFailed"));
            window.electronAPI?.logError?.("stageFileToTemp failed", {
              err: String(err),
            });
            notifyError(err, t("files.messages.stageFailed"));
            return "complete";
          } finally {
            hideStaging?.();
          }
        }

        notifyProgress("list-directory", "start");
        let directoryStructureResponse: Awaited<ReturnType<typeof apiService.listDirectoryRecursive>>;
        try {
          directoryStructureResponse = await apiService.listDirectoryRecursive(latestWorkDir);
        } catch (err) {
          message.error(t("files.messages.getDirectoryStructureFailed"));
          window.electronAPI?.logError?.("listDirectoryRecursive failed", {
            err: String(err),
          });
          notifyError(err, t("files.messages.getDirectoryStructureFailed"));
          return "complete";
        }
        if (!directoryStructureResponse.success) {
          const errMsg =
            directoryStructureResponse.message ||
            t("files.messages.getDirectoryStructureFailed");
          message.error(errMsg);
          notifyError(new Error(errMsg), errMsg);
          return "complete";
        }
        notifyProgress("list-directory", "success");

        const directories = extractDirectoriesFromStructure(
          directoryStructureResponse.data as DirectoryStructureResponse
        );

        let contentForAnalysis: string | undefined;
        if (isImagePath(stagedPath)) {
          notifyProgress("describe-image", "start", t("files.messages.describingImage"));
          message.info(t("files.messages.describingImage"));
          try {
            const dataUrl = await fileToBase64(stagedPath);
            if (dataUrl) {
              const descResp = await apiService.describeImage(dataUrl, lang);
              if (
                descResp.success &&
                descResp.data &&
                typeof descResp.data.description === "string"
              ) {
                contentForAnalysis = descResp.data.description;
                showSegmentedInfo(contentForAnalysis);
              }
            }
            notifyProgress("describe-image", "success");
          } catch (e) {
            notifyProgress("describe-image", "success", t("common.error"));
            window.electronAPI?.logError?.(
              "describe-image failed, continuing without content override",
              { err: String(e) }
            );
          }
        }

        notifyProgress("recommend-directory", "start", t("files.messages.analyzingFile"));
        const loadingKey = message.loading(t("files.messages.analyzingFile"), 0);
        let recommendResponse: Awaited<ReturnType<typeof apiService.recommendDirectory>>;
        try {
          recommendResponse = await apiService.recommendDirectory(
            stagedPath,
            directories,
            contentForAnalysis
          );
        } catch (err) {
          loadingKey();
          const conversionMessage = getConversionMessage(err);
          const fallback = t("files.messages.getRecommendationFailed");
          const displayMessage = conversionMessage ?? fallback;
          message.error(displayMessage);
          window.electronAPI?.logError?.("recommendDirectory HTTP error", {
            err: String(err),
            conversionMessage: conversionMessage ?? undefined,
          });
          notifyError(err, displayMessage);
          return "complete";
        }
        loadingKey();
        if (!recommendResponse.success) {
          const conversionMessage = getConversionMessage({
            message: recommendResponse.error?.message ?? recommendResponse.message,
            code: recommendResponse.error?.code,
            details: recommendResponse.error?.details,
            payload: recommendResponse,
          });
          const errMsg =
            conversionMessage ||
            recommendResponse.message ||
            t("files.messages.getRecommendationFailed");
          message.error(errMsg);
          notifyError(new Error(errMsg), errMsg);
          return "complete";
        }
        notifyProgress("recommend-directory", "success");

        const recommendedDirectory = (
          recommendResponse.data as RecommendDirectoryResponse
        )?.recommended_directory;
        const alternatives =
          (recommendResponse.data as RecommendDirectoryResponse)?.alternatives || [];

        const autoClassifyWithoutConfirmation = Boolean(
          cfg?.autoClassifyWithoutConfirmation
        );

        if (autoClassifyWithoutConfirmation) {
          const separator = getPathSeparator();
          const fullTargetDirectory = recommendedDirectory.startsWith(latestWorkDir)
            ? recommendedDirectory
            : `${latestWorkDir}${separator}${recommendedDirectory.replace(/\//g, separator)}`;

          notifyProgress("save-file", "start");
          const saveResponse = await apiService.saveFile(
            stagedPath,
            fullTargetDirectory,
            false,
            stagedId
          );
          if (!saveResponse.success) {
            const errMsg = saveResponse.message || t("files.messages.fileSaveFailed");
            message.error(errMsg);
            notifyError(new Error(errMsg), errMsg);
            return "complete";
          }
          notifyProgress("save-file", "success");
          message.success(
            t("files.messages.fileAutoSavedTo", {
              path: recommendedDirectory,
            })
          );
          onImported?.();
          const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
          if (fileId) {
            const descForRag =
              contentForAnalysis && contentForAnalysis.trim()
                ? contentForAnalysis
                : undefined;
            if (cfg?.autoSaveRAG) {
              notifyProgress("import-rag", "start", t("files.messages.importingRag"));
              let hideLoadingRag: undefined | (() => void);
              try {
                hideLoadingRag = message.loading(t("files.messages.importingRag"), 0);
                const ragResponse = await apiService.importToRag(
                  fileId,
                  true,
                  descForRag
                );
                if (ragResponse.success) {
                  notifyProgress(
                    "import-rag",
                    "success",
                    t("files.messages.importedRagSuccess")
                  );
                  message.success(t("files.messages.importedRagSuccess"));
                } else {
                  const failureMessage = getConversionMessage({
                    message: ragResponse.error?.message ?? ragResponse.message,
                    code: ragResponse.error?.code,
                    details: ragResponse.error?.details,
                    payload: ragResponse,
                  });
                  const fallback = t("files.messages.saveSuccessRagFailed");
                  const displayMessage = failureMessage ?? fallback;
                  notifyProgress("import-rag", failureMessage ? "error" : "success", displayMessage);
                  if (failureMessage) {
                    message.error(displayMessage);
                  } else {
                    message.warning(displayMessage);
                  }
                }
              } catch (e) {
                const fallback = t("files.messages.saveSuccessRagFailed");
                const conversionMessage = getConversionMessage(e);
                const displayMessage = conversionMessage ?? fallback;
                notifyProgress("import-rag", "error", displayMessage);
                if (conversionMessage) {
                  message.error(displayMessage);
                } else {
                  message.warning(displayMessage);
                }
                window.electronAPI?.logError?.(
                  "importToRag (auto classify) failed",
                  {
                    err: String(e),
                    conversionMessage: conversionMessage ?? undefined,
                  }
                );
              } finally {
                hideLoadingRag?.();
              }
            }
          }
          setStagedFileId(null);
          setImportFilePath("");
          setSelectedDirectory("");
          notifySuccess(
            t("files.messages.fileAutoSavedTo", {
              path: recommendedDirectory,
            })
          );
          return "complete";
        }

        await showImportConfirmationDialog(
          stagedPath,
          recommendedDirectory,
          alternatives,
          directoryStructureResponse.data as DirectoryStructureResponse
        );
        notifyProgress("await-confirmation", "start", t("files.import.selectTargetPrompt"));
        return "pending-user-action";
      },
      [
        workDirectory,
        t,
        extractDirectoriesFromStructure,
        showImportConfirmationDialog,
        onImported,
        showSegmentedInfo,
        notifyStart,
        notifyProgress,
        notifySuccess,
        notifyError,
        getConversionMessage,
        isPathInsideDirectory,
        resolveParentDirectory,
      ]
  );

    const runNextImport = useCallback(async () => {
      if (isProcessingRef.current) {
        return;
      }
      const nextTask = importQueueRef.current.shift();
      if (!nextTask) {
        return;
      }
      currentImportRef.current = nextTask;
      isProcessingRef.current = true;
      try {
        const status = await processFile(nextTask);
        if (status === "complete") {
          nextTask.deferred.resolve();
          currentImportRef.current = null;
          isProcessingRef.current = false;
          void runNextImport();
        }
      } catch (error) {
        nextTask.deferred.reject(error);
        currentImportRef.current = null;
        isProcessingRef.current = false;
        window.electronAPI?.logError?.("processFile queue failed", {
          err: String(error),
          path: nextTask.path,
        });
        void runNextImport();
      }
    }, [processFile]);

    const resolveCurrentImport = useCallback(() => {
      const currentTask = currentImportRef.current;
      if (!currentTask) {
        return;
      }
      currentTask.deferred.resolve();
      currentImportRef.current = null;
      isProcessingRef.current = false;
      void runNextImport();
    }, [runNextImport]);

    const enqueueTask = useCallback(
      (task: EnqueueTaskPayload) =>
        new Promise<void>((resolve, reject) => {
          const normalizedPath = (task.path || "").trim();
          if (!normalizedPath) {
            resolve();
            return;
          }
          importQueueRef.current.push({
            ...task,
            path: normalizedPath,
            deferred: { resolve, reject },
          });
          void runNextImport();
        }),
      [runNextImport],
    );

    const handleStartImport = useCallback(async () => {
      try {
        // Refresh latest config before importing
        const cfg =
          (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
        if (cfg?.workDirectory && cfg.workDirectory !== workDirectory) {
          setWorkDirectory(cfg.workDirectory);
        }
        const selected = await window.electronAPI.selectFile();
        if (!selected) return;

        const selectedPaths = Array.isArray(selected) ? selected : [selected];
        const normalizedPaths = selectedPaths
          .map((path) => (typeof path === "string" ? path.trim() : ""))
          .filter((path) => path.length > 0);

        if (normalizedPaths.length === 0) {
          return;
        }

        if (!isProcessingRef.current && !currentImportRef.current) {
          setStagedFileId(null);
          setImportFilePath("");
          setSelectedDirectory("");
        }

        normalizedPaths.forEach((path) => {
          void enqueueTask({ path, mode: "new" });
        });
      } catch (error) {
        message.error(t("files.messages.fileImportFailed"));
        window.electronAPI?.logError?.("handleStartImport failed", {
          err: String(error),
        });
      }
    }, [enqueueTask, t, workDirectory]);

    const retryImport = useCallback(
      (file: ImportedFileItem) => {
        const safePath = (file?.path || "").trim();
        const fileId = (file?.file_id || "").trim();
        if (!safePath || !fileId) {
          const errMsg = t("files.messages.retryImportMissingSource");
          message.error(errMsg);
          return Promise.reject(new Error("missing retry source"));
        }
        message.info(
          t("files.messages.retryImportQueued", {
            name: file.name,
          })
        );
        return enqueueTask({
          path: safePath,
          mode: "retry",
          existingFileId: fileId,
          displayName: file.name,
        }).catch((error) => {
          message.error(
            t("files.messages.retryImportFailed", {
              name: file.name,
            })
          );
          return Promise.reject(error);
        });
      },
      [enqueueTask, t]
    );

    // Expose imperative API
    useImperativeHandle(
      ref,
      () => ({
        startImport: handleStartImport,
        importFile: (filePath: string) => enqueueTask({ path: filePath, mode: "new" }),
        retryImport,
      }),
      [handleStartImport, enqueueTask, retryImport]
    );

    const handleImportConfirm = async () => {
      if (!selectedDirectory) {
        message.error(t("files.import.selectSaveDirectory"));
        return;
      }
      if (!importFilePath || !stagedFileId) {
        message.error(t("files.messages.stageMissing"));
        return;
      }
      try {
        notifyProgress("await-confirmation", "success");
        notifyProgress("save-file", "start");
        const separator = getPathSeparator();
        const fullTargetDirectory = selectedDirectory.startsWith(workDirectory)
          ? selectedDirectory
          : `${workDirectory}${separator}${selectedDirectory.replace(
              /\//g,
              separator
            )}`;

        const saveResponse = await apiService.saveFile(
          importFilePath,
          fullTargetDirectory,
          false,
          stagedFileId
        );
        if (saveResponse.success) {
          notifyProgress("save-file", "success");
          message.success(
            t("files.import.fileSavedTo", { path: selectedDirectory })
          );
          setImportModalVisible(false);
          setStagedFileId(null);
          setImportFilePath("");
          setSelectedDirectory("");
          onImported?.();
          const fileId = (saveResponse.data as { file_id?: string } | undefined)
            ?.file_id;
          if (fileId) {
            // The file has been saved and recorded in DB; avoid duplicate DB insert in RAG import
            // If we had image description earlier in processFile, reuse it here by previewing if needed
            let contentForAnalysis: string | undefined = undefined;
            try {
              if (isImagePath(importFilePath)) {
                notifyProgress("describe-image", "start", t("files.messages.describingImage"));
                const dataUrl = await fileToBase64(importFilePath);
                if (dataUrl) {
                  const cfg4 =
                    (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
                  const lang = (cfg4?.language || "en") as "zh" | "en";
                  const descResp = await apiService.describeImage(
                    dataUrl,
                    lang
                  );
                  if (
                    descResp.success &&
                    descResp.data &&
                    typeof descResp.data.description === "string"
                  ) {
                    contentForAnalysis = descResp.data.description;
                    try {
                      showSegmentedInfo(contentForAnalysis);
                    } catch {
                      // ignore message rendering failures
                    }
                  }
                }
                notifyProgress("describe-image", "success");
              }
            } catch (e) {
              notifyProgress("describe-image", "success", t("common.error"));
              window.electronAPI?.logError?.(
                "describe-image (confirm) failed, continuing",
                { err: String(e) }
              );
            }
            try {
              const cfg5 =
                (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
              const descForRag =
                contentForAnalysis && contentForAnalysis.trim()
                  ? contentForAnalysis
                  : undefined;
              let hideLoading: undefined | (() => void);
              try {
                if (cfg5?.autoSaveRAG) {
                  notifyProgress("import-rag", "start", t("files.messages.importingRag"));
                  hideLoading = message.loading(
                    t("files.messages.importingRag"),
                    0
                  );
                  const ragResponse = await apiService.importToRag(
                    fileId,
                    true,
                    descForRag
                  );
                  if (ragResponse.success) {
                    notifyProgress(
                      "import-rag",
                      "success",
                      t("files.messages.importedRagSuccess")
                    );
                    message.success(t("files.messages.importedRagSuccess"));
                  } else {
                    const failureMessage = getConversionMessage({
                      message: ragResponse.error?.message ?? ragResponse.message,
                      code: ragResponse.error?.code,
                      details: ragResponse.error?.details,
                      payload: ragResponse,
                    });
                    const fallback = t("files.messages.saveSuccessRagFailed");
                    const displayMessage = failureMessage ?? fallback;
                    notifyProgress("import-rag", failureMessage ? "error" : "success", displayMessage);
                    if (failureMessage) {
                      message.error(displayMessage);
                    } else {
                      message.warning(displayMessage);
                    }
                  }
                }
              } finally {
                if (hideLoading) hideLoading();
              }
            } catch (e) {
              const fallback = t("files.messages.saveSuccessRagFailed");
              const conversionMessage = getConversionMessage(e);
              const displayMessage = conversionMessage ?? fallback;
              notifyProgress("import-rag", "error", displayMessage);
              if (conversionMessage) {
                message.error(displayMessage);
              } else {
                message.warning(displayMessage);
              }
              window.electronAPI?.logError?.("importToRag (confirm) failed", {
                err: String(e),
                conversionMessage: conversionMessage ?? undefined,
              });
            }
          }
          notifySuccess(t("files.import.fileSavedTo", { path: selectedDirectory }));
          resolveCurrentImport();
        } else {
          const errMsg =
            saveResponse.message || t("files.messages.fileSaveFailed");
          message.error(errMsg);
          notifyError(new Error(errMsg), errMsg);
        }
      } catch (error) {
        message.error(t("files.messages.fileSaveFailed"));
        window.electronAPI?.logError?.("handleImportConfirm saveFile failed", {
          err: String(error),
        });
        notifyError(error, t("files.messages.fileSaveFailed"));
      }
    };

    const handleImportCancel = () => {
      setImportModalVisible(false);
      setSelectedDirectory("");
      setImportFilePath("");
      setStagedFileId(null);
      notifyCancelled(t("common.cancel"));
      resolveCurrentImport();
    };

    const handleManualSelectDirectory = () => {
      setImportModalVisible(false);
      setManualSelectModalVisible(true);
    };

    const handleManualSelectConfirm = async () => {
      if (!selectedDirectory) {
        message.error(t("files.import.selectSaveDirectory"));
        return;
      }
      if (!importFilePath || !stagedFileId) {
        message.error(t("files.messages.stageMissing"));
        return;
      }
      try {
        notifyProgress("await-confirmation", "success");
        notifyProgress("save-file", "start");
        const separator = getPathSeparator();
        const fullTargetDirectory = selectedDirectory.startsWith(workDirectory)
          ? selectedDirectory
          : `${workDirectory}${separator}${selectedDirectory.replace(
              /\//g,
              separator
            )}`;

        const saveResponse = await apiService.saveFile(
          importFilePath,
          fullTargetDirectory,
          false,
          stagedFileId
        );
        if (saveResponse.success) {
          notifyProgress("save-file", "success");
          message.success(
            t("files.import.fileSavedTo", { path: selectedDirectory })
          );
          setManualSelectModalVisible(false);
          setStagedFileId(null);
          setImportFilePath("");
          setSelectedDirectory("");
          onImported?.();
          const fileId = (saveResponse.data as { file_id?: string } | undefined)
            ?.file_id;
          if (fileId) {
            // The file has been saved and recorded in DB; avoid duplicate DB insert in RAG import
            await handleRagImport(fileId, true);
          }
          notifySuccess(t("files.import.fileSavedTo", { path: selectedDirectory }));
          resolveCurrentImport();
        } else {
          const errMsg =
            saveResponse.message || t("files.messages.fileSaveFailed");
          message.error(errMsg);
          notifyError(new Error(errMsg), errMsg);
        }
      } catch (error) {
        message.error(t("files.messages.fileSaveFailed"));
        window.electronAPI?.logError?.(
          "handleManualSelectConfirm saveFile failed",
          { err: String(error) }
        );
        notifyError(error, t("files.messages.fileSaveFailed"));
      }
    };

    const handleManualSelectCancel = () => {
      setManualSelectModalVisible(false);
      setStagedFileId(null);
      setImportFilePath("");
      setSelectedDirectory("");
      notifyCancelled(t("common.cancel"));
      resolveCurrentImport();
    };

    return (
      <>
        <Modal
          title={t("files.import.modalTitle")}
          open={importModalVisible}
          onOk={handleImportConfirm}
          onCancel={handleImportCancel}
          okText={t("files.import.confirmSave")}
          cancelText={t("common.cancel")}
          footer={[
            <Button key="cancel" onClick={handleImportCancel}>
              {t("common.cancel")}
            </Button>,
            <Button key="manual" onClick={handleManualSelectDirectory}>
              {t("files.import.manualSelectButton")}
            </Button>,
            <Button key="confirm" type="primary" onClick={handleImportConfirm}>
              {t("files.import.confirmSave")}
            </Button>,
          ]}
        >
          <div style={{ marginBottom: 16 }}>
            <p>
              {t("files.import.recommendText", { path: selectedDirectory })}
            </p>
            <p>{t("files.import.selectTargetPrompt")}</p>
            <Select
              style={{ width: "100%" }}
              value={selectedDirectory}
              onChange={(value: string) => setSelectedDirectory(value)}
              placeholder={t("files.import.selectPlaceholder")}
            >
              {directoryOptions.map((option) => (
                <Select.Option key={option.key} value={option.value}>
                  {option.title}
                </Select.Option>
              ))}
            </Select>
          </div>
        </Modal>

        <Modal
          title={t("files.import.manualModalTitle")}
          open={manualSelectModalVisible}
          onOk={handleManualSelectConfirm}
          onCancel={handleManualSelectCancel}
          okText={t("files.import.confirmSelect")}
          cancelText={t("common.cancel")}
          width={600}
        >
          <div style={{ marginBottom: 16 }}>
            <p>{t("files.import.selectTargetPrompt")}</p>
            <TreeSelect
              style={{ width: "100%" }}
              value={selectedDirectory}
              styles={{ popup: { root: { maxHeight: 400, overflow: "auto" } } }}
              treeData={directoryTreeData}
              placeholder={t("files.import.selectPlaceholder")}
              treeDefaultExpandAll
              treeLine
              showSearch
              filterTreeNode={(input, treeNode) =>
                String(treeNode?.title)
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              onChange={(value: string) => setSelectedDirectory(value)}
            />
          </div>
        </Modal>
      </>
    );
  }
);

export default FileImport;
