import { Modal, Button, Spin, message, Space } from 'antd';
import { FolderOpenOutlined, GlobalOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
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
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  useEffect(() => {
    const loadPreview = async () => {
      setLoading(true);
      try {
        const response = await apiService.previewFile(filePath);
        if (response.success) {
          setPreviewData(response.data as PreviewData);
        } else {
          message.error(response.message || '加载预览失败');
          onClose();
        }
      } catch (error) {
        message.error('加载预览失败');
        console.error(error);
        onClose();
      } finally {
        setLoading(false);
      }
    };

    if (visible && filePath) {
      loadPreview();
    }
  }, [visible, filePath, onClose]);

  const handleOpenInFolder = async () => {
    try {
      // 使用系统默认方式打开文件所在文件夹
      const folderPath = filePath.substring(0, filePath.lastIndexOf(getPathSeparator()));
      await window.electronAPI.openFile(folderPath);
    } catch (error) {
      message.error('打开文件夹失败');
      console.error(error);
    }
  };

  const handleOpenWithDefault = async () => {
    try {
      await window.electronAPI.openFile(filePath);
    } catch (error) {
      message.error('打开文件失败');
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
              ... 文件内容过长，已截断显示（前10KB）...
            </div>
          )}
        </div>
      );
    }

    return <div>不支持的文件类型</div>;
  };

  return (
    <Modal
      title={`预览 - ${fileName}`}
      open={visible}
      onCancel={onClose}
      width={800}
      footer={
        <Space>
          <Button icon={<FolderOpenOutlined />} onClick={handleOpenInFolder}>
            在文件夹中打开
          </Button>
          <Button icon={<GlobalOutlined />} onClick={handleOpenWithDefault}>
            用默认程序打开
          </Button>
          <Button onClick={onClose}>
            关闭
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