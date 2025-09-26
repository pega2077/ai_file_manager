import React, { useEffect, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Button, Modal, Select, TreeSelect, message } from 'antd';
import { useTranslation } from '../shared/i18n/I18nProvider';
import { apiService } from '../services/api';
import type { DirectoryStructureResponse, RecommendDirectoryResponse, TreeNode } from '../shared/types';

type FileImportProps = {
  onImported?: () => void;
};

export type FileImportRef = {
  startImport: () => Promise<void> | void;
  importFile: (filePath: string) => Promise<void>;
};

const FileImport = forwardRef<FileImportRef, FileImportProps>(({ onImported }, ref) => {
  const { t } = useTranslation();

  // Local states
  const [workDirectory, setWorkDirectory] = useState<string>('workdir');
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [manualSelectModalVisible, setManualSelectModalVisible] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [importFilePath, setImportFilePath] = useState<string>('');
  const [directoryOptions, setDirectoryOptions] = useState<TreeNode[]>([]);
  const [directoryTreeData, setDirectoryTreeData] = useState<TreeNode[]>([]);

  useEffect(() => {
    const loadWorkDirectory = async () => {
      try {
  const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
        const wd = cfg?.workDirectory as string | undefined;
        if (wd) setWorkDirectory(wd);
      } catch (error) {
        console.error('Failed to load workDirectory:', error);
      }
    };
    void loadWorkDirectory();
  }, []);

  const getPathSeparator = () => (navigator.userAgent.includes('Windows') ? '\\' : '/');

  const extractDirectoriesFromStructure = useCallback((structureData: DirectoryStructureResponse): string[] => {
    const directories: string[] = [];
    if (structureData && structureData.items) {
      for (const item of structureData.items) {
        if (item.type === 'folder' && item.relative_path && item.relative_path !== '.') {
          directories.push(item.relative_path);
        }
      }
    }
    return directories;
  }, []);

  const buildDirectoryOptions = useCallback((recommendedDirectory: string, alternatives: string[]): TreeNode[] => {
    const options: TreeNode[] = [];
    options.push({
      title: `${recommendedDirectory} ${t('files.import.suffixRecommended')}`,
      value: recommendedDirectory,
      key: recommendedDirectory,
      children: [],
    });
    alternatives.forEach((alt) => {
      if (alt !== recommendedDirectory) {
        options.push({
          title: `${alt} ${t('files.import.suffixAlternative')}`,
          value: alt,
          key: alt,
          children: [],
        });
      }
    });
    return options;
  }, [t]);

  const buildDirectoryTreeData = useCallback((structureData: DirectoryStructureResponse): TreeNode[] => {
    const treeData: TreeNode[] = [];
    const pathMap = new Map<string, TreeNode>();

    if (structureData && structureData.items) {
      structureData.items.forEach((item) => {
        if (item.type === 'folder' && item.relative_path && item.relative_path !== '.') {
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
        const parts = path.split('/');
        if (parts.length === 1) {
          treeData.push(node);
        } else {
          const parentPath = parts.slice(0, -1).join('/');
          const parentNode = pathMap.get(parentPath);
          if (parentNode) {
            parentNode.children.push(node);
          }
        }
      });
    }

    return treeData;
  }, []);

  const handleRagImport = useCallback(async (fileId: string, noSaveDb: boolean = false) => {
    try {
  const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
      if (cfg?.autoSaveRAG) {
        const loadingKey = message.loading(t('files.messages.importingRag'), 0);
        const ragResponse = await apiService.importToRag(fileId, noSaveDb);
        loadingKey();
        if (ragResponse.success) {
          message.success(t('files.messages.importedRagSuccess'));
        } else {
          message.warning(t('files.messages.saveSuccessRagFailed'));
        }
      }
    } catch (error) {
      message.warning(t('files.messages.saveSuccessRagFailed'));
      console.error(error);
    }
  }, [t]);

  const showImportConfirmationDialog = useCallback(
    async (
      filePath: string,
      recommendedDirectory: string,
      alternatives: string[],
      directoryStructure: DirectoryStructureResponse,
    ) => {
      setImportFilePath(filePath);
      setSelectedDirectory(recommendedDirectory);
      setDirectoryOptions(buildDirectoryOptions(recommendedDirectory, alternatives));
      setDirectoryTreeData(buildDirectoryTreeData(directoryStructure));
      setImportModalVisible(true);
    },
    [buildDirectoryOptions, buildDirectoryTreeData],
  );

  const isImagePath = (p: string) => /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)$/i.test(p);

  const fileToBase64 = async (path: string): Promise<string> => {
    // Rely on preview endpoint to get data URL for images to avoid Node fs in renderer.
    try {
      const preview = await apiService.previewFile(path);
      if (preview.success) {
        const data = preview.data as { content?: string; file_type?: string } | undefined;
        if (data && data.file_type === 'image' && typeof data.content === 'string') {
          // content is a data URL; pass directly to backend which strips it if needed
          return data.content;
        }
      }
    } catch (e) {
      // ignore
    }
    return '';
  };

  const processFile = useCallback(async (filePath: string) => {
    // 1) Load directory structure with error handling
    let directoryStructureResponse: Awaited<ReturnType<typeof apiService.listDirectoryRecursive>>;
    try {
      directoryStructureResponse = await apiService.listDirectoryRecursive(workDirectory);
    } catch (err) {
      message.error(t('files.messages.getDirectoryStructureFailed'));
      window.electronAPI?.logError?.('listDirectoryRecursive failed', { err: String(err) });
      return;
    }
    if (!directoryStructureResponse.success) {
      message.error(directoryStructureResponse.message || t('files.messages.getDirectoryStructureFailed'));
      return;
    }

    const directories = extractDirectoriesFromStructure(
      directoryStructureResponse.data as DirectoryStructureResponse,
    );

    // If image, get description first via /api/chat/describe-image
    let contentForAnalysis: string | undefined = undefined;
    try {
      if (isImagePath(filePath)) {
        message.info(t('files.messages.describingImage'));
        const dataUrl = await fileToBase64(filePath);
        if (dataUrl) {
          const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
          const lang = ((cfg?.language || 'en') as 'zh' | 'en');
          const descResp = await apiService.describeImage(dataUrl, lang);
          if (descResp.success && descResp.data && typeof descResp.data.description === 'string') {
            contentForAnalysis = descResp.data.description;
          }
        }
      }
    } catch (e) {
      // Non-blocking; continue without description
      window.electronAPI?.logError?.('describe-image failed, continuing without content override', { err: String(e) });
    }

    // 2) Recommend directory with error handling
    const loadingKey = message.loading(t('files.messages.analyzingFile'), 0);
    let recommendResponse: Awaited<ReturnType<typeof apiService.recommendDirectory>>;
    try {
      recommendResponse = await apiService.recommendDirectory(filePath, directories, contentForAnalysis);
    } catch (err) {
      loadingKey();
      message.error(t('files.messages.getRecommendationFailed'));
      window.electronAPI?.logError?.('recommendDirectory HTTP error', { err: String(err) });
      return;
    }
    loadingKey();
    if (!recommendResponse.success) {
      message.error(recommendResponse.message || t('files.messages.getRecommendationFailed'));
      return;
    }

    const recommendedDirectory = (recommendResponse.data as RecommendDirectoryResponse)
      ?.recommended_directory;
    const alternatives = (recommendResponse.data as RecommendDirectoryResponse)?.alternatives || [];

  const cfg2 = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
  const autoClassifyWithoutConfirmation = Boolean(cfg2?.autoClassifyWithoutConfirmation);

    if (autoClassifyWithoutConfirmation) {
      const separator = getPathSeparator();
      const fullTargetDirectory = recommendedDirectory.startsWith(workDirectory)
        ? recommendedDirectory
        : `${workDirectory}${separator}${recommendedDirectory.replace(/\//g, separator)}`;

      const saveResponse = await apiService.saveFile(filePath, fullTargetDirectory, false);
      if (saveResponse.success) {
        message.success(t('files.messages.fileAutoSavedTo', { path: recommendedDirectory }));
        onImported?.();
        const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
        if (fileId) {
          // Pass content override if we obtained image description
          try {
            const cfg3 = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
            const descForRag = contentForAnalysis && contentForAnalysis.trim() ? contentForAnalysis : undefined;
            if (cfg3?.autoSaveRAG) {
              const loadingKey2 = message.loading(t('files.messages.importingRag'), 0);
              const ragResponse = await apiService.importToRag(fileId, true, descForRag);
              loadingKey2();
              if (ragResponse.success) {
                message.success(t('files.messages.importedRagSuccess'));
              } else {
                message.warning(t('files.messages.saveSuccessRagFailed'));
              }
            }
          } catch (e) {
            message.warning(t('files.messages.saveSuccessRagFailed'));
            window.electronAPI?.logError?.('importToRag (auto classify) failed', { err: String(e) });
          }
        }
      } else {
        message.error(saveResponse.message || t('files.messages.fileSaveFailed'));
      }
    } else {
      await showImportConfirmationDialog(
        filePath,
        recommendedDirectory,
        alternatives,
        directoryStructureResponse.data as DirectoryStructureResponse,
      );
    }
  }, [workDirectory, t, extractDirectoriesFromStructure, showImportConfirmationDialog, onImported]);

  const handleStartImport = useCallback(async () => {
    try {
      const filePath = await window.electronAPI.selectFile();
      if (!filePath) return;
      await processFile(filePath);
    } catch (error) {
      message.error(t('files.messages.fileImportFailed'));
      window.electronAPI?.logError?.('handleStartImport failed', { err: String(error) });
    }
  }, [processFile, t]);

  // Expose imperative API
  useImperativeHandle(ref, () => ({ startImport: handleStartImport, importFile: processFile }), [handleStartImport, processFile]);

  const handleImportConfirm = async () => {
    if (!selectedDirectory) {
      message.error(t('files.import.selectSaveDirectory'));
      return;
    }
    try {
      const separator = getPathSeparator();
      const fullTargetDirectory = selectedDirectory.startsWith(workDirectory)
        ? selectedDirectory
        : `${workDirectory}${separator}${selectedDirectory.replace(/\//g, separator)}`;

      const saveResponse = await apiService.saveFile(importFilePath, fullTargetDirectory, false);
      if (saveResponse.success) {
        message.success(t('files.import.fileSavedTo', { path: selectedDirectory }));
        setImportModalVisible(false);
        onImported?.();
        const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
        if (fileId) {
          // The file has been saved and recorded in DB; avoid duplicate DB insert in RAG import
          // If we had image description earlier in processFile, reuse it here by previewing if needed
          let contentForAnalysis: string | undefined = undefined;
          try {
            if (isImagePath(importFilePath)) {
              const dataUrl = await fileToBase64(importFilePath);
              if (dataUrl) {
                const cfg4 = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
                const lang = ((cfg4?.language || 'en') as 'zh' | 'en');
                const descResp = await apiService.describeImage(dataUrl, lang);
                if (descResp.success && descResp.data && typeof descResp.data.description === 'string') {
                  contentForAnalysis = descResp.data.description;
                }
              }
            }
          } catch (e) {
            window.electronAPI?.logError?.('describe-image (confirm) failed, continuing', { err: String(e) });
          }
          try {
            const cfg5 = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
            const descForRag = contentForAnalysis && contentForAnalysis.trim() ? contentForAnalysis : undefined;
            if (cfg5?.autoSaveRAG) {
              const loadingKey2 = message.loading(t('files.messages.importingRag'), 0);
              const ragResponse = await apiService.importToRag(fileId, true, descForRag);
              loadingKey2();
              if (ragResponse.success) {
                message.success(t('files.messages.importedRagSuccess'));
              } else {
                message.warning(t('files.messages.saveSuccessRagFailed'));
              }
            }
          } catch (e) {
            message.warning(t('files.messages.saveSuccessRagFailed'));
            window.electronAPI?.logError?.('importToRag (confirm) failed', { err: String(e) });
          }
        }
      } else {
        message.error(saveResponse.message || t('files.messages.fileSaveFailed'));
      }
    } catch (error) {
      message.error(t('files.messages.fileSaveFailed'));
      window.electronAPI?.logError?.('handleImportConfirm saveFile failed', { err: String(error) });
    }
  };

  const handleImportCancel = () => {
    setImportModalVisible(false);
    setSelectedDirectory('');
    setImportFilePath('');
  };

  const handleManualSelectDirectory = () => {
    setImportModalVisible(false);
    setManualSelectModalVisible(true);
  };

  const handleManualSelectConfirm = async () => {
    if (!selectedDirectory) {
      message.error(t('files.import.selectSaveDirectory'));
      return;
    }
    try {
      const separator = getPathSeparator();
      const fullTargetDirectory = selectedDirectory.startsWith(workDirectory)
        ? selectedDirectory
        : `${workDirectory}${separator}${selectedDirectory.replace(/\//g, separator)}`;

      const saveResponse = await apiService.saveFile(importFilePath, fullTargetDirectory, false);
      if (saveResponse.success) {
        message.success(t('files.import.fileSavedTo', { path: selectedDirectory }));
        setManualSelectModalVisible(false);
        onImported?.();
        const fileId = (saveResponse.data as { file_id?: string } | undefined)?.file_id;
        if (fileId) {
          // The file has been saved and recorded in DB; avoid duplicate DB insert in RAG import
          await handleRagImport(fileId, true);
        }
      } else {
        message.error(saveResponse.message || t('files.messages.fileSaveFailed'));
      }
    } catch (error) {
      message.error(t('files.messages.fileSaveFailed'));
      window.electronAPI?.logError?.('handleManualSelectConfirm saveFile failed', { err: String(error) });
    }
  };

  const handleManualSelectCancel = () => {
    setManualSelectModalVisible(false);
  };

  return (
    <>
      <Modal
        title={t('files.import.modalTitle')}
        open={importModalVisible}
        onOk={handleImportConfirm}
        onCancel={handleImportCancel}
        okText={t('files.import.confirmSave')}
        cancelText={t('common.cancel')}
        footer={[
          <Button key="cancel" onClick={handleImportCancel}>
            {t('common.cancel')}
          </Button>,
          <Button key="manual" onClick={handleManualSelectDirectory}>
            {t('files.import.manualSelectButton')}
          </Button>,
          <Button key="confirm" type="primary" onClick={handleImportConfirm}>
            {t('files.import.confirmSave')}
          </Button>,
        ]}
      >
        <div style={{ marginBottom: 16 }}>
          <p>{t('files.import.recommendText', { path: selectedDirectory })}</p>
          <p>{t('files.import.selectTargetPrompt')}</p>
          <Select
            style={{ width: '100%' }}
            value={selectedDirectory}
            onChange={(value: string) => setSelectedDirectory(value)}
            placeholder={t('files.import.selectPlaceholder')}
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
        title={t('files.import.manualModalTitle')}
        open={manualSelectModalVisible}
        onOk={handleManualSelectConfirm}
        onCancel={handleManualSelectCancel}
        okText={t('files.import.confirmSelect')}
        cancelText={t('common.cancel')}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <p>{t('files.import.selectTargetPrompt')}</p>
          <TreeSelect
            style={{ width: '100%' }}
            value={selectedDirectory}
            styles={{ popup: { root: { maxHeight: 400, overflow: 'auto' } } }}
            treeData={directoryTreeData}
            placeholder={t('files.import.selectPlaceholder')}
            treeDefaultExpandAll
            treeLine
            showSearch
            filterTreeNode={(input, treeNode) =>
              String(treeNode?.title).toLowerCase().includes(input.toLowerCase())
            }
            onChange={(value: string) => setSelectedDirectory(value)}
          />
        </div>
      </Modal>
    </>
  );
});

export default FileImport;

