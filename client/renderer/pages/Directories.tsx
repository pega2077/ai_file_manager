import { useState, useEffect } from 'react';
import { Layout, Table, Spin, message, Button, Modal, Form, Input } from 'antd';
import { ArrowUpOutlined, EyeOutlined, FolderOpenOutlined, FileTextOutlined, DatabaseOutlined, FolderAddOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import Sidebar from '../components/Sidebar';
import FilePreview from '../components/FilePreview';
import {  FileItem, DirectoryResponse } from '../shared/types';
import { useTranslation } from '../shared/i18n/I18nProvider';
import { useCallback } from 'react';

const { Content } = Layout;

const Directories = () => {
  const { t } = useTranslation();
  const [currentDirectory, setCurrentDirectory] = useState<string>('');
  const [workDirectory, setWorkDirectory] = useState<string>('');
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedMenu = 'files';
  const [enablePreview, setEnablePreview] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ folderName: string }>();

  const columns = [
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
      render: (type: string) => type === 'folder' ? t('home.table.type.folder') : t('home.table.type.file'),
    },
    {
      title: t('home.table.columns.size'),
      dataIndex: 'size',
      key: 'size',
      render: (size: number | null) => {
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
      },
    },
    {
      title: t('home.table.columns.createdAt'),
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string | null) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: t('home.table.columns.modifiedAt'),
      dataIndex: 'modified_at',
      key: 'modified_at',
      render: (date: string | null) => date ? new Date(date).toLocaleString() : '-',
    },
    {
      title: t('home.table.columns.actions'),
      key: 'actions',
      render: (_text: string, record: FileItem) => (
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
                  handleImportToRag(record);
                }}
                title={t('home.actions.importToRag')}
              />
            </>
          )}
          <Button
            type="text"
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFolder(record);
            }}
            title={t('home.actions.openFolder')}
          />
          <Button
            type="text"
            size="small"
            icon={<FileTextOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              handleOpenFile(record);
            }}
            title={t('home.actions.openFile')}
          />
        </div>
      ),
    },
  ];

  const loadDirectory = useCallback(async (directoryPath: string) => {
    setLoading(true);
    try {
      const response = await apiService.listDirectory(directoryPath) as { success: boolean; data: DirectoryResponse; message: string };
      if (response.success) {
        setFileList(response.data.items);
        setCurrentDirectory(directoryPath);
      } else {
        message.error(response.message || t('home.messages.loadDirectoryFailed'));
      }
    } catch (error) {
      message.error(t('home.messages.loadDirectoryFailed'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
  const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig;
        const storedWorkDirectory = cfg?.workDirectory as string | undefined;
        if (storedWorkDirectory) {
          setWorkDirectory(storedWorkDirectory);
          setCurrentDirectory(storedWorkDirectory);
        } else {
          setWorkDirectory('workdir');
          setCurrentDirectory('workdir');
        }
        if (typeof cfg?.enablePreview === 'boolean') {
          setEnablePreview(Boolean(cfg.enablePreview));
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
        setWorkDirectory('workdir');
        setCurrentDirectory('workdir');
      }
    };

    void loadInitialData();
  }, []);

  useEffect(() => {
    if (currentDirectory) {
      void loadDirectory(currentDirectory);
    }
  }, [currentDirectory, loadDirectory]);

  const handlePreview = (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    setPreviewFile({ path: fullPath, name: record.name });
    setPreviewVisible(true);
  };

  const handleImportToRag = async (record: FileItem) => {
    if (record.type !== 'file') return;
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;

    try {
      const loadingKey = message.loading(t('home.messages.importingToRag'), 0);
      // Save the file to ensure a file_id exists in DB (overwrite to avoid duplicates)
      const saveResp = await apiService.saveFile(fullPath, currentDirectory, true);
      const fileId = (saveResp.data as { file_id?: string } | undefined)?.file_id;
      if (!saveResp.success || !fileId) {
        loadingKey();
        message.error(saveResp.message || t('home.messages.importToRagFailed'));
        return;
      }
      loadingKey();
    } catch (error) {
      message.error(t('home.messages.importToRagFailed'));
      console.error(error);
    }
  };

  const handleOpenFolder = async (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    try {
      const success = await window.electronAPI.openFolder(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFolder'));
      }
    } catch (error) {
      message.error(t('home.messages.openFolderFailed'));
      console.error(error);
    }
  };

  const handleOpenFile = async (record: FileItem) => {
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;
    try {
      const success = await window.electronAPI.openFile(fullPath);
      if (!success) {
        message.error(t('home.messages.cannotOpenFile'));
      }
    } catch (error) {
      message.error(t('home.messages.openFileFailed'));
      console.error(error);
    }
  };

  const getPathSeparator = () => {
    // 使用 userAgent 检测 Windows 平台，避免使用已弃用的 platform 属性
    return navigator.userAgent.includes('Windows') ? '\\' : '/';
  };

  const handleGoUp = () => {
    if (currentDirectory === workDirectory) {
      return; // 已经在工作区根目录，无法返回上级
    }

    // 根据平台选择分隔符来分割路径
    const separator = getPathSeparator();
    const pathParts = currentDirectory.split(separator);
    
    // 移除最后一个部分（当前目录名）
    pathParts.pop();
    
    // 重新拼接路径
    const parentPath = pathParts.join(separator);
    
    if (parentPath) {
      setCurrentDirectory(parentPath);
    }
  };

  const handleRowDoubleClick = async (record: FileItem) => {
    // 根据平台选择合适的分隔符
    const separator = getPathSeparator();
    const fullPath = `${currentDirectory}${separator}${record.name}`;

    if (record.type === 'folder') {
      // 切换到子目录
      setCurrentDirectory(fullPath);
    } else {
      // 根据设置决定是预览还是直接打开
      if (enablePreview) {
        // 启用预览，显示预览模态框
        setPreviewFile({ path: fullPath, name: record.name });
        setPreviewVisible(true);
      } else {
        // 直接打开文件
        try {
          const success = await window.electronAPI.openFile(fullPath);
          if (!success) {
            message.error(t('home.messages.cannotOpenFile'));
          }
        } catch (error) {
          message.error(t('home.messages.openFileFailed'));
          console.error(error);
        }
      }
    }
  };

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
      const base = currentDirectory.replace(/[\\/]+$/, '');
      const sep = getPathSeparator();
      const targetPath = `${base}${sep}${name}`;
      const resp = await apiService.createDirectory(targetPath) as { success: boolean; message?: string };
      if (resp.success) {
        message.success(t('home.messages.createFolderSuccess'));
        setCreateModalOpen(false);
        form.resetFields();
        void loadDirectory(currentDirectory);
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
                disabled={currentDirectory === workDirectory}
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
              <h2 style={{ margin: 0 }}>{t('home.currentDirectory', { path: currentDirectory })}</h2>
            </div>
            <Spin spinning={loading}>
              <Table
                columns={columns}
                dataSource={fileList}
                rowKey="name"
                pagination={false}
                onRow={(record) => ({
                  onDoubleClick: () => handleRowDoubleClick(record),
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
          destroyOnClose
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
              {t('files.createFolder.help')}: {currentDirectory}
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

    </Layout>
  );
};

export default Directories;
