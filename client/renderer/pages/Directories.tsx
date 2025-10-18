import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Layout, Table, Spin, message, Button, Modal, Form, Input, Tag } from 'antd';
import { ArrowUpOutlined, EyeOutlined, FolderOpenOutlined, FileTextOutlined, DatabaseOutlined, FolderAddOutlined, ImportOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';
import FilePreview from '../components/FilePreview';
import FileImport, { FileImportRef } from '../components/FileImport';
import { FileItem, DirectoryResponse, BatchFileRecordResponse, FileRecordStatus } from '../shared/types';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Content } = Layout;

const Directories = () => {
  const { t } = useTranslation();
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [workDirectory, setWorkDirectory] = useState<string>('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [enablePreview, setEnablePreview] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fileStatusMap, setFileStatusMap] = useState<Record<string, FileRecordStatus>>({});
  const [statusLoading, setStatusLoading] = useState(false);
  const [form] = Form.useForm<{ folderName: string }>();
  const importRef = useRef<FileImportRef>(null);
  const statusRequestIdRef = useRef(0);
  const lastDirectoryRef = useRef<string>('');
  const selectedMenu = 'files';

  const getPathSeparator = useCallback(() => (navigator.userAgent.includes('Windows') ? '\\' : '/'), []);

  const normalizeDirectoryBase = useCallback((directory: string) => {
    const separator = getPathSeparator();
    const trimmed = (directory ?? '').trim();
    if (!trimmed) {
      return '';
    }
    if (separator === '\\') {
      if (/^[a-zA-Z]:\\$/u.test(trimmed)) {
        return trimmed;
      }
      return trimmed.replace(/[\\]+$/u, '');
    }
    if (trimmed === '/') {
      return trimmed;
    }
    return trimmed.replace(/\/+$/u, '');
  }, [getPathSeparator]);

  const normalizePathForKey = useCallback((value: string) => {
    const separator = getPathSeparator();
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      return '';
    }
    const replaced = separator === '\\' ? trimmed.replace(/\//g, '\\') : trimmed.replace(/\\/g, '/');
    const collapsed = separator === '\\' ? replaced.replace(/[\\]{2,}/g, '\\') : replaced.replace(/\/{2,}/g, '/');
    return separator === '\\' ? collapsed.toLowerCase() : collapsed;
  }, [getPathSeparator]);

  const composeFullPath = useCallback((directory: string, entryName: string) => {
    const separator = getPathSeparator();
    const normalizedDir = normalizeDirectoryBase(directory);
    const trimmedName = (entryName ?? '').trim();
    if (!normalizedDir) {
      return trimmedName;
    }
    if (!trimmedName) {
      return normalizedDir;
    }
    if (normalizedDir === separator) {
      return `${normalizedDir}${trimmedName}`;
    }
    return `${normalizedDir}${separator}${trimmedName}`;
  }, [getPathSeparator, normalizeDirectoryBase]);

  const getActiveDirectory = useCallback(() => {
    const active = (currentDirectory ?? '').trim();
    if (active) {
      return active;
    }
    const last = (lastDirectoryRef.current ?? '').trim();
    if (last) {
      return last;
    }
    return (workDirectory ?? '').trim();
  }, [currentDirectory, workDirectory]);

  const fetchFileStatuses = useCallback(async (directoryPath: string, items: FileItem[]) => {
    const requestId = statusRequestIdRef.current + 1;
    statusRequestIdRef.current = requestId;

    const fileEntries = items.filter((item) => item.type === 'file');
    if (fileEntries.length === 0) {
      if (statusRequestIdRef.current === requestId) {
        setFileStatusMap({});
        setStatusLoading(false);
      }
      return;
    }

    setStatusLoading(true);

    try {
      const entries = fileEntries.map((item) => {
        const fullPath = composeFullPath(directoryPath, item.name);
        return {
          fullPath,
          key: normalizePathForKey(fullPath),
        };
      });

      const response = await apiService.queryFilesByPaths(entries.map((entry) => entry.fullPath));
      if (statusRequestIdRef.current !== requestId) {
        return;
      }

      if (response.success && response.data) {
        const payload = response.data as BatchFileRecordResponse;
        const records = Array.isArray(payload?.records) ? payload.records : [];
        const lookup = new Map<string, FileRecordStatus>();
        records.forEach((record) => {
          lookup.set(normalizePathForKey(record.path), record);
        });

        const nextMap: Record<string, FileRecordStatus> = {};
        entries.forEach(({ key }) => {
          const record = lookup.get(key);
          if (record) {
            nextMap[key] = record;
          }
        });
        records.forEach((record) => {
          const normalized = normalizePathForKey(record.path);
          if (!nextMap[normalized]) {
            nextMap[normalized] = record;
          }
        });
        setFileStatusMap(nextMap);
      } else {
        message.error(response.message || t('home.messages.loadFileStatusFailed'));
        setFileStatusMap({});
      }
    } catch (error) {
      if (statusRequestIdRef.current === requestId) {
        message.error(t('home.messages.loadFileStatusFailed'));
        setFileStatusMap({});
      }
      console.error('Failed to query file statuses:', error);
    } finally {
      if (statusRequestIdRef.current === requestId) {
        setStatusLoading(false);
      }
    }
  }, [composeFullPath, normalizePathForKey, t]);

  const loadDirectory = useCallback(async (directoryPath: string) => {
    const targetPath = (directoryPath ?? '').trim();
    if (!targetPath) {
      return;
    }
    setLoading(true);
    setFileStatusMap({});
    try {
      const response = await apiService.listDirectory(targetPath);
      if (response.success && response.data) {
        const data = response.data as DirectoryResponse;
        const resolvedPath = typeof data?.directory_path === 'string' && data.directory_path
          ? data.directory_path
          : targetPath;
        const items = Array.isArray(data?.items) ? data.items : [];
        lastDirectoryRef.current = resolvedPath;
        setCurrentDirectory(resolvedPath);
        setFileList(items);
        await fetchFileStatuses(resolvedPath, items);
      } else {
        message.error(response.message || t('home.messages.loadDirectoryFailed'));
        setFileList([]);
        setStatusLoading(false);
      }
    } catch (error) {
      message.error(t('home.messages.loadDirectoryFailed'));
      console.error(error);
      setFileList([]);
      setStatusLoading(false);
    } finally {
      setLoading(false);
    }
  }, [fetchFileStatuses, t]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
        const storedWorkDirectory = cfg?.workDirectory as string | undefined;
        if (storedWorkDirectory) {
          setWorkDirectory(storedWorkDirectory);
          setCurrentDirectory(storedWorkDirectory);
          lastDirectoryRef.current = storedWorkDirectory;
        } else {
          setWorkDirectory('workdir');
          setCurrentDirectory('workdir');
          lastDirectoryRef.current = 'workdir';
        }
        if (typeof cfg?.enablePreview === 'boolean') {
          setEnablePreview(Boolean(cfg.enablePreview));
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
        setWorkDirectory('workdir');
        setCurrentDirectory('workdir');
        lastDirectoryRef.current = 'workdir';
      }
    };

    void loadInitialData();
  }, []);

  useEffect(() => {
    if (currentDirectory) {
      void loadDirectory(currentDirectory);
    }
  }, [currentDirectory, loadDirectory]);

  const handlePreview = useCallback((record: FileItem) => {
    const baseDirectory = getActiveDirectory();
    const fullPath = composeFullPath(baseDirectory, record.name);
    setPreviewFile({ path: fullPath, name: record.name });
    setPreviewVisible(true);
  }, [composeFullPath, getActiveDirectory]);

  const handleImportToRag = useCallback(async (record: FileItem) => {
    if (record.type !== 'file') {
      return;
    }
    const activeDirectory = getActiveDirectory();
    if (!activeDirectory) {
      message.error(t('home.messages.loadDirectoryFailed'));
      return;
    }
    const fullPath = composeFullPath(activeDirectory, record.name);

    let hideLoading: (() => void) | undefined;
    try {
      hideLoading = message.loading(t('home.messages.importingToRag'), 0);
      const saveResp = await apiService.saveFile(fullPath, activeDirectory, true);
      const fileId = (saveResp.data as { file_id?: string } | undefined)?.file_id;
      if (!saveResp.success || !fileId) {
        if (hideLoading) hideLoading();
        message.error(saveResp.message || t('home.messages.importToRagFailed'));
        return;
      }
      if (hideLoading) hideLoading();
    } catch (error) {
      if (hideLoading) hideLoading();
      message.error(t('home.messages.importToRagFailed'));
      console.error(error);
    }
  }, [composeFullPath, getActiveDirectory, t]);

  const handleOpenFolder = useCallback(async (record: FileItem) => {
    const activeDirectory = getActiveDirectory();
    if (!activeDirectory) {
      message.error(t('home.messages.cannotOpenFolder'));
      return;
    }
    const fullPath = composeFullPath(activeDirectory, record.name);
    try {
      const success = await window.electronAPI.openFolder(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFolder'));
      }
    } catch (error) {
      message.error(t('home.messages.openFolderFailed'));
      console.error(error);
    }
  }, [composeFullPath, getActiveDirectory, t]);

  const handleOpenFile = useCallback(async (record: FileItem) => {
    const activeDirectory = getActiveDirectory();
    if (!activeDirectory) {
      message.error(t('home.messages.cannotOpenFile'));
      return;
    }
    const fullPath = composeFullPath(activeDirectory, record.name);
    try {
      const success = await window.electronAPI.openFile(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFile'));
      }
    } catch (error) {
      message.error(t('home.messages.openFileFailed'));
      console.error(error);
    }
  }, [composeFullPath, getActiveDirectory, t]);

  const handleImport = useCallback(async (record: FileItem) => {
    if (record.type !== 'file') {
      return;
    }
    const activeDirectory = getActiveDirectory();
    if (!activeDirectory || !importRef.current) {
      message.error(t('home.import.fileImportFailed'));
      return;
    }
    const fullPath = composeFullPath(activeDirectory, record.name);
    try {
      await importRef.current.importFile(fullPath);
      await loadDirectory(activeDirectory);
    } catch (error) {
      message.error(t('home.import.fileImportFailed'));
      console.error('Failed to import file from directories page:', error);
    }
  }, [composeFullPath, getActiveDirectory, loadDirectory, t]);

  const handleGoUp = useCallback(() => {
    const activeDirectory = getActiveDirectory();
    const workKey = normalizePathForKey(workDirectory);
    const activeKey = normalizePathForKey(activeDirectory);
    if (activeKey && workKey && activeKey === workKey) {
      return;
    }
    const normalizedCurrent = normalizeDirectoryBase(activeDirectory);
    if (!normalizedCurrent) {
      return;
    }
    const separator = getPathSeparator();
    if (normalizedCurrent === separator) {
      return;
    }
    if (separator === '\\' && /^[a-zA-Z]:\\$/u.test(normalizedCurrent)) {
      return;
    }
    const lastIndex = normalizedCurrent.lastIndexOf(separator);
    if (lastIndex < 0) {
      return;
    }
    let parent = normalizedCurrent.slice(0, lastIndex);
    if (!parent) {
      parent = separator;
    } else if (separator === '\\' && /^[a-zA-Z]:$/u.test(parent)) {
      parent = `${parent}\\`;
    }
    setCurrentDirectory(parent);
  }, [getActiveDirectory, getPathSeparator, normalizeDirectoryBase, normalizePathForKey, workDirectory]);

  const handleRowDoubleClick = useCallback(async (record: FileItem) => {
    const activeDirectory = getActiveDirectory();
    const fullPath = composeFullPath(activeDirectory, record.name);

    if (record.type === 'folder') {
      setCurrentDirectory(fullPath);
      return;
    }

    if (enablePreview) {
      setPreviewFile({ path: fullPath, name: record.name });
      setPreviewVisible(true);
      return;
    }

    try {
      const success = await window.electronAPI.openFile(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFile'));
      }
    } catch (error) {
      message.error(t('home.messages.openFileFailed'));
      console.error(error);
    }
  }, [composeFullPath, enablePreview, getActiveDirectory, t]);

  const handleCreateFolder = async () => {
    try {
      const values = await form.validateFields();
      const name = (values.folderName || '').trim();
      if (!name) {
        message.warning(t('home.messages.createFolderInvalidName'));
        return;
      }
      const invalidPattern = /[<>:"/\\|?*]/;
      if (invalidPattern.test(name)) {
        message.error(t('home.messages.createFolderInvalidChars'));
        return;
      }
      setCreating(true);
      const baseDirectory = normalizeDirectoryBase(getActiveDirectory() || workDirectory);
      if (!baseDirectory) {
        message.error(t('home.messages.createFolderFailed'));
        return;
      }
      const targetPath = composeFullPath(baseDirectory, name);
      if (!targetPath) {
        message.error(t('home.messages.createFolderFailed'));
        return;
      }
      const resp = await apiService.createDirectory(targetPath) as { success: boolean; message?: string };
      if (resp.success) {
        message.success(t('home.messages.createFolderSuccess'));
        setCreateModalOpen(false);
        form.resetFields();
        await loadDirectory(baseDirectory);
      } else {
        const msg = resp.message || t('home.messages.createFolderFailed');
        message.error(msg);
      }
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      console.error('Create folder failed:', e);
      message.error(t('home.messages.createFolderFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleImported = useCallback(() => {
    const activeDirectory = getActiveDirectory();
    if (activeDirectory) {
      void loadDirectory(activeDirectory);
    }
  }, [getActiveDirectory, loadDirectory]);

  const columns = useMemo(() => {
    const directoryForStatus = getActiveDirectory();

    const resolveStatus = (record: FileItem) => {
      if (record.type !== 'file') {
        return undefined;
      }
      const key = normalizePathForKey(composeFullPath(directoryForStatus, record.name));
      return fileStatusMap[key];
    };

    const formatSize = (size: number | null) => {
      if (size === null) return '-';
      if (size === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let unitIndex = 0;
      let formattedSize = size;
      while (formattedSize >= 1024 && unitIndex < units.length - 1) {
        formattedSize /= 1024;
        unitIndex++;
      }
      return `${formattedSize.toFixed(1)} ${units[unitIndex]}`;
    };

    return [
      {
        title: t('home.table.columns.name'),
        dataIndex: 'name',
        key: 'name',
        render: (text: string, record: FileItem) => (
          <span>
            {record.type === 'folder' ? '📁 ' : '📄 '}
            {text}
          </span>
        ),
      },
      {
        title: t('home.table.columns.type'),
        dataIndex: 'type',
        key: 'type',
        render: (type: string) => (type === 'folder' ? t('home.table.type.folder') : t('home.table.type.file')),
      },
      {
        title: t('home.table.columns.size'),
        dataIndex: 'size',
        key: 'size',
        render: (size: number | null) => formatSize(size),
      },
      {
        title: t('home.table.columns.createdAt'),
        dataIndex: 'created_at',
        key: 'created_at',
        render: (date: string | null) => (date ? new Date(date).toLocaleString() : '-'),
      },
      {
        title: t('home.table.columns.modifiedAt'),
        dataIndex: 'modified_at',
        key: 'modified_at',
        render: (date: string | null) => (date ? new Date(date).toLocaleString() : '-'),
      },
      {
        title: t('home.table.columns.status'),
        dataIndex: 'status',
        key: 'status',
        render: (_: unknown, record: FileItem) => {
          if (record.type !== 'file') {
            return '-';
          }
          const status = resolveStatus(record);
          if (!status && statusLoading) {
            return <Spin size="small" />;
          }
          if (status?.imported) {
            return <Tag color="green">{t('home.status.imported')}</Tag>;
          }
          if (status?.processed) {
            return <Tag color="orange">{t('home.status.processing')}</Tag>;
          }
          return <Tag color="default">{t('home.status.notImported')}</Tag>;
        },
      },
      {
        title: t('home.table.columns.actions'),
        key: 'actions',
        render: (_text: string, record: FileItem) => {
          const status = resolveStatus(record);
          const canImport = record.type === 'file' && (!status || !status.imported);
          return (
            <div style={{ display: 'flex', gap: '4px' }}>
              {record.type === 'file' && (
                <>
                  <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(record);
                    }}
                    title={t('home.actions.preview')}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<DatabaseOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleImportToRag(record);
                    }}
                    title={t('home.actions.importToRag')}
                  />
                  {canImport && (
                    <Button
                      type="text"
                      size="small"
                      icon={<ImportOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleImport(record);
                      }}
                      title={t('home.actions.importFile')}
                      disabled={statusLoading}
                    />
                  )}
                </>
              )}
              <Button
                type="text"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleOpenFolder(record);
                }}
                title={t('home.actions.openFolder')}
              />
              <Button
                type="text"
                size="small"
                icon={<FileTextOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleOpenFile(record);
                }}
                title={t('home.actions.openFile')}
              />
            </div>
          );
        },
      },
    ];
  }, [
    composeFullPath,
    fileStatusMap,
    getActiveDirectory,
    handleImport,
    handleImportToRag,
    handleOpenFile,
    handleOpenFolder,
    handlePreview,
    normalizePathForKey,
    statusLoading,
    t,
  ]);

  const activeDirectory = getActiveDirectory();
  const disableGoUp = Boolean(activeDirectory) && Boolean(workDirectory) && normalizePathForKey(activeDirectory) === normalizePathForKey(workDirectory);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout style={{ padding: '0 24px 24px' }}>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: '#fff',
          }}
        >
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Button
                icon={<ArrowUpOutlined />}
                onClick={handleGoUp}
                disabled={disableGoUp}
                title={t('home.buttonTitles.goUp')}
              >
                {t('home.buttons.goUp')}
              </Button>
              <Button
                icon={<FolderAddOutlined />}
                onClick={() => setCreateModalOpen(true)}
              >
                {t('home.buttons.createFolder')}
              </Button>
              <h2 style={{ margin: 0 }}>{t('home.currentDirectory', { path: activeDirectory })}</h2>
            </div>
            <Spin spinning={loading}>
              <Table
                columns={columns}
                dataSource={fileList}
                rowKey="name"
                pagination={false}
                onRow={(record) => ({
                  onDoubleClick: () => {
                    void handleRowDoubleClick(record);
                  },
                })}
              />
            </Spin>
          </Content>
        </Layout>
        <Modal
          open={createModalOpen}
          title={t('files.createFolder.modalTitle')}
          okText={t('files.createFolder.okText')}
          cancelText={t('files.createFolder.cancelText')}
          onOk={handleCreateFolder}
          onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
          confirmLoading={creating}
          destroyOnHidden
        >
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item
              label={t('files.createFolder.label')}
              name="folderName"
              rules={[{ required: true, message: t('home.messages.createFolderInvalidName') }]}
            >
              <Input placeholder={t('files.createFolder.placeholder')} allowClear />
            </Form.Item>
            <div style={{ color: '#888', fontSize: 12 }}>
              {t('files.createFolder.help')}: {activeDirectory}
            </div>
          </Form>
        </Modal>
        {previewFile && (
          <FilePreview
            filePath={previewFile.path}
            fileName={previewFile.name}
            visible={previewVisible}
            onClose={() => {
              setPreviewVisible(false);
              setPreviewFile(null);
            }}
          />
        )}
        <FileImport ref={importRef} onImported={handleImported} />

    </Layout>
  );
};

export default Directories;
