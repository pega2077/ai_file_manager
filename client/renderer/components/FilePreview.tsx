import { Modal, Button, Spin, message, Space } from 'antd';
import { FolderOpenOutlined, GlobalOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useTranslation } from '../shared/i18n/I18nProvider';
import { apiService } from '../services/api';

interface FilePreviewProps {
  filePath: string;
  fileName: string;
  visible: boolean;
  onClose: () => void;
}

interface PreviewData {
  file_path: string;
  file_type: 'text' | 'image';
  mime_type: string;
  content: string;
  size: number;
  truncated?: boolean;
}

const FilePreview = ({ filePath, fileName, visible, onClose }: FilePreviewProps) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  useEffect(() => {
    const loadPreview = async () => {
      setLoading(true);
      try {
  const response = await apiService.previewFile(filePath, { origin: true });
        if (response.success) {
          setPreviewData(response.data as PreviewData);
        } else {
          message.error(response.message || t('filePreview.messages.loadFailed'));
          onClose();
        }
      } catch (error) {
        message.error(t('filePreview.messages.loadFailed'));
        console.error(error);
        onClose();
      } finally {
        setLoading(false);
      }
    };

    if (visible && filePath) {
      loadPreview();
    }
  }, [visible, filePath, onClose, t]);

  const handleOpenInFolder = async () => {
    try {
      // 使用系统默认方式打开文件所在文件夹
      const folderPath = filePath.substring(0, filePath.lastIndexOf(getPathSeparator()));
      await window.electronAPI.openFile(folderPath);
    } catch (error) {
      message.error(t('filePreview.messages.openFolderFailed'));
      console.error(error);
    }
  };

  const handleOpenWithDefault = async () => {
    try {
      await window.electronAPI.openFile(filePath);
    } catch (error) {
      message.error(t('filePreview.messages.openFileFailed'));
      console.error(error);
    }
  };

  const getPathSeparator = () => {
    return navigator.userAgent.includes('Windows') ? '\\' : '/';
  };

  const renderPreviewContent = () => {
    if (!previewData) return null;

    if (previewData.file_type === 'image') {
      return (
        <div style={{ textAlign: 'center' }}>
          <img
            src={previewData.content}
            alt={fileName}
            style={{
              maxWidth: '100%',
              maxHeight: '60vh',
              objectFit: 'contain'
            }}
          />
        </div>
      );
    } else if (previewData.file_type === 'text') {
      return (
        <div
          style={{
            maxHeight: '60vh',
            overflow: 'auto',
            background: '#f5f5f5',
            padding: '16px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}
        >
          {previewData.content}
          {previewData.truncated && (
            <div style={{ marginTop: '16px', color: '#999', fontStyle: 'italic' }}>
              {t('filePreview.messages.truncatedMessage')}
            </div>
          )}
        </div>
      );
    }

    return <div>{t('filePreview.messages.unsupportedFileType')}</div>;
  };

  return (
    <Modal
      title={t('filePreview.modalTitle', { fileName })}
      open={visible}
      onCancel={onClose}
      width={800}
      footer={
        <Space>
          <Button icon={<FolderOpenOutlined />} onClick={handleOpenInFolder}>
            {t('filePreview.buttons.openInFolder')}
          </Button>
          <Button icon={<GlobalOutlined />} onClick={handleOpenWithDefault}>
            {t('filePreview.buttons.openWithDefault')}
          </Button>
          <Button onClick={onClose}>
            {t('filePreview.buttons.close')}
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {renderPreviewContent()}
      </Spin>
    </Modal>
  );
};

export default FilePreview;