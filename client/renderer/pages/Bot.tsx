import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import botLoadingImage from "../assets/mona-loading-default.gif";
import botStaticImage from "../assets/mona-loading-default-static.png";
import { message, Menu, Button, Tooltip, theme } from "antd";
import { UploadOutlined, SearchOutlined } from "@ant-design/icons";
import FileImport, { FileImportRef } from "../components/FileImport";
import { useTranslation } from "../shared/i18n/I18nProvider";
import {
  FileImportNotification,
  subscribeFileImportNotifications,
} from "../shared/events/fileImportEvents";
import { apiService } from "../services/api";
import type { DirectoryWatchImportRequest } from "../../shared/directoryWatcher";

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const Bot: React.FC = () => {
  const { t } = useTranslation();
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const [processing, setProcessing] = useState<boolean>(false);
  const importRef = useRef<FileImportRef>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [webImporting, setWebImporting] = useState(false);
  const { token } = theme.useToken();
  const statusTextColor = token.colorTextSecondary;
  const contextMenuBaseStyle = useMemo(
    () => ({
      background: token.colorBgElevated,
      border: `1px solid ${token.colorBorderSecondary || token.colorBorder}`,
      borderRadius: 4,
      boxShadow: token.boxShadowSecondary,
    }),
    [
      token.colorBgElevated,
      token.colorBorderSecondary,
      token.colorBorder,
      token.boxShadowSecondary,
    ]
  );

  // Work directory handling moved into FileImport component.

  const showMainWindow = useCallback(
    async (options?: { route?: string; refreshFiles?: boolean }) => {
      try {
        await window.electronAPI.showMainWindow(options);
        return true;
      } catch (error) {
        console.error("Failed to show main window:", error);
        return false;
      }
    },
    []
  );

  const openFilesView = useCallback(() => {
    return showMainWindow({ route: "/files", refreshFiles: true });
  }, [showMainWindow]);

  const openSearchView = useCallback(() => {
    return showMainWindow({ route: "/search" });
  }, [showMainWindow]);

  const handleDoubleClick = async () => {
    await openFilesView();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuVisible(true);
  };

  const readClipboardText = useCallback(async (): Promise<string> => {
    if (navigator?.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          return text;
        }
      } catch (error) {
        window.electronAPI?.logError?.("bot-read-clipboard-browser-failed", {
          err: String(error),
        });
      }
    }

    if (window.electronAPI?.readClipboardText) {
      try {
        return await window.electronAPI.readClipboardText();
      } catch (error) {
        window.electronAPI?.logError?.("bot-read-clipboard-electron-failed", {
          err: String(error),
        });
      }
    }

    return "";
  }, []);

  const handleFileImport = useCallback(
    async (filePath: string) => {
      try {
        await importRef.current?.importFile(filePath);
      } catch (error) {
        window.electronAPI?.logError?.("bot-handle-file-import-failed", {
          err: String(error),
        });
        message.error(t("files.messages.fileImportFailed"));
      }
    },
    [t]
  );

  const handleWebImport = useCallback(
    async (rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (!trimmed) {
        message.warning(t("bot.messages.invalidUrl"));
        return;
      }
      if (!isValidHttpUrl(trimmed)) {
        message.error(t("bot.messages.invalidUrl"));
        return;
      }
      if (webImporting) {
        message.info(t("bot.messages.webImportInProgress"));
        return;
      }

      setMenuVisible(false);
      setWebImporting(true);
      setStatusMessage(t("bot.messages.fetchingWebpage"));

      let hideLoading: (() => void) | undefined;
      try {
        hideLoading = message.loading(t("bot.messages.fetchingWebpage"), 0);
        const response = await apiService.convertWebpage({ url: trimmed });
        const data = response.data;
        if (!data || !data.output_file_path) {
          throw new Error("missing_output_path");
        }
        await handleFileImport(data.output_file_path);
        message.success(t("bot.messages.webImportSuccess"));
      } catch (error) {
        window.electronAPI?.logError?.("bot-web-import-failed", {
          url: trimmed,
          err: String(error),
        });
        message.error(t("bot.messages.webImportFailed"));
      } finally {
        if (hideLoading) hideLoading();
        setWebImporting(false);
      }
    },
    [handleFileImport, t, webImporting]
  );

  const handleMenuClick = async (key: string) => {
    setMenuVisible(false);
    if (key === "importFile") {
      try {
        await importRef.current?.startImport();
      } catch (error) {
        console.error("Failed to import file via menu:", error);
        message.error(t("files.messages.fileImportFailed"));
      }
    } else if (key === "showMain") {
      await openFilesView();
    } else if (key === "hideBot") {
      try {
        await window.electronAPI.hideBotWindow();
      } catch (error) {
        console.error("Failed to hide bot window:", error);
      }
    } else if (key === "pasteUrl") {
      try {
        const urlFromClipboard = await readClipboardText();
        if (!urlFromClipboard) {
          message.warning(t("bot.messages.clipboardEmpty"));
          return;
        }
        await handleWebImport(urlFromClipboard);
      } catch (error) {
        window.electronAPI?.logError?.("bot-paste-url-failed", {
          err: String(error),
        });
        message.error(t("bot.messages.webImportFailed"));
      }
    } else if (key === "openWorkdir") {
      try {
        const cfg =
          (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
        const workDir = cfg?.workDirectory as string | undefined;
        if (!workDir) {
          message.error(t("bot.messages.workdirNotSet"));
          return;
        }
        if (window.electronAPI?.openFolder) {
          const ok = await window.electronAPI.openFolder(workDir);
          if (!ok) {
            message.error(t("bot.messages.openWorkdirFailed"));
          }
        } else {
          message.error(t("bot.messages.openFolderNotSupported"));
        }
      } catch (error) {
        console.error("Failed to open work directory:", error);
        message.error(t("bot.messages.openWorkdirFailed"));
      }
    } else if (key === "exitApp") {
      try {
        await window.electronAPI.quitApp();
      } catch (error) {
        console.error("Failed to quit application:", error);
      }
    }
  };

  const handleImportClick = async () => {
    setMenuVisible(false);
    try {
      await importRef.current?.startImport();
    } catch (error) {
      console.error("Failed to import file via button:", error);
      message.error(t("files.messages.fileImportFailed"));
    }
  };

  const handleSearchClick = async () => {
    setMenuVisible(false);
    // Open the main window where the user can search. If you have a dedicated search API, replace this.
    const opened = await openSearchView();
    if (!opened) {
      console.error("Failed to open main window for search");
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Prevent default to avoid image selection/focus ring while enabling custom dragging
    e.preventDefault();
    isDragging.current = true;
    startPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - startPos.current.x;
    const deltaY = e.clientY - startPos.current.y;
    window.electronAPI.moveBotWindow(deltaX, deltaY);
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Allow drop
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    console.log("Drop event:", e);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    try {
      const filePaths = await Promise.all(
        files.map(async (file) => {
          try {
            return window.webUtils.getPathForFile(file);
          } catch (error) {
            console.error("Failed to get path for file:", file.name, error);
            return null;
          }
        })
      ).then((paths) => paths.filter((path): path is string => path !== null));

      if (filePaths.length > 0) {
        console.log("Dropped files:", filePaths);
        const toastMessage =
          filePaths.length === 1
            ? t("bot.messages.droppedFilePath", { path: filePaths[0] })
            : t("bot.messages.filesDroppedCount", { count: filePaths.length });

        message.info(toastMessage);

        // Process the dropped files
        for (const filePath of filePaths) {
          await handleFileImport(filePath);
        }
      }
    } catch (error) {
      console.error("Error processing dropped files:", error);
      message.error(t("bot.messages.errorProcessingFiles"));
    }
  };

  const handleDirectoryWatcherTask = useCallback(
    (payload: DirectoryWatchImportRequest) => {
      if (!payload || typeof payload.filePath !== "string") {
        return;
      }
      const taskId = payload.taskId;
      const filePath = payload.filePath.trim();
      if (!filePath) {
        return;
      }

      try {
        window.electronAPI?.notifyDirectoryWatcherStatus?.({
          status: "accepted",
          taskId,
          filePath,
        });
      } catch (error) {
        console.error("Failed to acknowledge directory watcher task:", error);
      }

      const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
      if (document.hidden) {
        message.info(
          t("bot.messages.directoryWatcherTaskQueued", { name: fileName })
        );
      }
      setStatusMessage(t("bot.messages.directoryWatcherTaskQueued", { name: fileName }));

      const importer = importRef.current;
      if (!importer || typeof importer.importFile !== "function") {
        window.electronAPI?.notifyDirectoryWatcherStatus?.({
          status: "busy",
          taskId,
          filePath,
        });
        message.warning(t("bot.messages.directoryWatcherImporterUnavailable"));
        return;
      }

      const runImport = async () => {
        try {
          await importer.importFile(filePath, {
            taskId,
            source: "directory-watcher",
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error ?? "unknown error");
          window.electronAPI?.notifyDirectoryWatcherStatus?.({
            status: "error",
            taskId,
            filePath,
            error: errMsg,
          });
          message.error(t("bot.messages.directoryWatcherTaskFailed", { name: fileName }));
        }
      };

      void runImport();
    },
    [t]
  );

  useEffect(() => {
    const unsubscribe = subscribeFileImportNotifications(
      (detail: FileImportNotification) => {
        switch (detail.status) {
          case "start":
            setProcessing(true);
            setStatusMessage(
              detail.filename ?? t("files.messages.preparingFile")
            );
            break;
          case "progress":
            if (detail.message) {
              setStatusMessage(detail.message);
            } else if (
              detail.step === "await-confirmation" &&
              detail.state === "start"
            ) {
              setStatusMessage(t("files.import.selectTargetPrompt"));
            }
            break;
          case "success":
            setProcessing(false);
            setStatusMessage(detail.message ?? t("common.success"));
            break;
          case "error":
            setProcessing(false);
            setStatusMessage(
              detail.message ?? detail.error ?? t("common.error")
            );
            break;
          case "cancelled":
            setProcessing(false);
            setStatusMessage(detail.message ?? null);
            break;
          default:
            break;
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [t]);

  useEffect(() => {
    const handlePasteEvent = (event: ClipboardEvent) => {
      const pastedText = event.clipboardData?.getData("text")?.trim();
      if (!pastedText) {
        return;
      }
      if (!isValidHttpUrl(pastedText)) {
        return;
      }
      event.preventDefault();
      void handleWebImport(pastedText);
    };

    window.addEventListener("paste", handlePasteEvent);
    return () => {
      window.removeEventListener("paste", handlePasteEvent);
    };
  }, [handleWebImport]);

  useEffect(() => {
    if (!statusMessage) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setStatusMessage(null);
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Hide context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuVisible) {
        const menuElement = document.querySelector(".context-menu");
        if (menuElement && !menuElement.contains(e.target as Node)) {
          setMenuVisible(false);
        }
      }
    };

    if (menuVisible) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuVisible]);

  useEffect(() => {
    try {
      window.electronAPI?.registerDirectoryWatcherImporter?.();
    } catch (error) {
      console.error("Failed to register directory watcher importer:", error);
    }

    const unsubscribe = window.electronAPI?.onDirectoryWatcherImportRequest?.(
      handleDirectoryWatcherTask
    );

    return () => {
      unsubscribe?.();
      try {
        window.electronAPI?.unregisterDirectoryWatcherImporter?.();
      } catch (error) {
        console.error("Failed to unregister directory watcher importer:", error);
      }
    };
  }, [handleDirectoryWatcherTask]);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        width: "100vw",
        position: "relative",
        // Avoid any selection highlight on the whole surface
        userSelect: "none" as const,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <Tooltip title={t("bot.menu.importFile")}>
          <Button
            type="default"
            icon={<UploadOutlined />}
            onClick={handleImportClick}
            aria-label={t("bot.menu.importFile")}
          />
        </Tooltip>

        <Tooltip title={t("bot.menu.search")}>
          <Button
            type="default"
            icon={<SearchOutlined />}
            onClick={handleSearchClick}
            aria-label={t("bot.menu.search")}
          />
        </Tooltip>
      </div>
      <img
        id="bot-image"
        src={processing ? botLoadingImage : botStaticImage}
        alt={t("bot.menu.botImageAlt")}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onDragStart={(e) => e.preventDefault()}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        draggable={false}
        style={{
          width: "200px",
          height: "200px",
          cursor: "pointer",
          // Ensure the image never shows selection highlight or drag ghost
          userSelect: "none",
          WebkitUserSelect: "none",
          // Note: avoid unsupported vendor props to satisfy typings
          outline: "none",
          WebkitTapHighlightColor: "transparent",
          ...(isHovered
            ? { filter: "drop-shadow(0px 0px 5px #000000ff)" }
            : {}),
        }}
      />
      {statusMessage && (
        <div
          style={{
            marginTop: 12,
            maxWidth: 220,
            textAlign: "center",
            color: statusTextColor,
            fontSize: 14,
            lineHeight: 1.4,
          }}
        >
          {statusMessage}
        </div>
      )}
      {/* <div>{debugMessage}</div> */}
      {/* FileImport renders its own modals; hidden trigger via ref */}
      <FileImport
        ref={importRef}
        onImported={() => {
          /* optional: toast/refresh */
        }}
      />

      {menuVisible && (
        <div
          className="context-menu"
          style={{
            position: "fixed",
            top: menuPosition.y,
            left: menuPosition.x,
            zIndex: 1000,
            ...contextMenuBaseStyle,
          }}
          onClick={() => setMenuVisible(false)}
        >
          <Menu onClick={({ key }) => handleMenuClick(key as string)}>
            <Menu.Item key="importFile">{t("bot.menu.importFile")}</Menu.Item>
            <Menu.Item key="pasteUrl" disabled={webImporting}>
              {t("bot.menu.pasteUrl")}
            </Menu.Item>
            <Menu.Item key="openWorkdir">{t("bot.menu.openWorkdir")}</Menu.Item>
            <Menu.Item key="showMain">{t("bot.menu.showMain")}</Menu.Item>
            <Menu.Item key="hideBot">{t("bot.menu.hideBot")}</Menu.Item>
            <Menu.Divider />
            <Menu.Item danger key="exitApp">
              {t("bot.menu.exitApp")}
            </Menu.Item>
          </Menu>
        </div>
      )}
    </div>
  );
};

export default Bot;
