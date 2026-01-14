import { Modal, Button, Spin, message, Space, Alert } from 'antd';
import { FolderOpenOutlined, GlobalOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';
import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from '../shared/i18n/I18nProvider';
import { apiService } from '../services/api';
import type { AppConfig } from '../shared/types';
import { electronAPI } from "../shared/electronAPI";
import {
  DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS,
  extractPreviewExtension,
  isPreviewExtensionSupported,
  sanitizePreviewExtensions,
} from '../../shared/filePreviewConfig';

interface FilePreviewProps {
  filePath: string;
  fileName: string;
  visible: boolean;
  onClose: () => void;
}

interface PreviewData {
  file_path: string;
  file_type: 'text' | 'image' | 'html' | 'pdf' | 'video';
  mime_type: string;
  content: string;
  size: number;
  truncated?: boolean;
  encoding?: string;
}

const FilePreview = ({ filePath, fileName, visible, onClose }: FilePreviewProps) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [supportedExtensions, setSupportedExtensions] = useState<string[]>(() =>
    Array.from(DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS)
  );
  const [extensionsReady, setExtensionsReady] = useState(false);

  // When maximized we allow the preview to take most of the viewport height
  const previewMaxHeight = isMaximized ? 'calc(100vh - 150px)' : '60vh';

  const htmlSrcDoc = useMemo(() => {
    if (!previewData || previewData.file_type !== 'html') {
      return null;
    }
    const fileUrl = electronAPI.toFileUrl?.(previewData.file_path);
    if (!fileUrl) {
      return previewData.content;
    }
    const lastSlashIndex = fileUrl.lastIndexOf('/');
    const baseHref = lastSlashIndex >= 0 ? fileUrl.slice(0, lastSlashIndex + 1) : fileUrl;
    const safeBase = baseHref.replace(/"/g, '&quot;');
    return `<base href="${safeBase}">\n${previewData.content}`;
  }, [previewData]);

  const normalizedExtension = useMemo(() => extractPreviewExtension(fileName || filePath), [fileName, filePath]);

  const previewAllowed = useMemo(
    () => isPreviewExtensionSupported(normalizedExtension, supportedExtensions),
    [normalizedExtension, supportedExtensions]
  );

  const supportedExtensionsLabel = useMemo(
    () =>
      supportedExtensions
        .map((ext) => `.${ext}`)
        .sort((a, b) => a.localeCompare(b))
        .join(', '),
    [supportedExtensions]
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;
    setExtensionsReady(false);

    const loadSupportedExtensions = async () => {
      if (!electronAPI.getAppConfig) {
        if (!cancelled) {
          setExtensionsReady(true);
        }
        return;
      }

      try {
        const rawConfig = (await electronAPI.getAppConfig()) as AppConfig | undefined;
        if (cancelled) {
          return;
        }
        const sanitized = sanitizePreviewExtensions(
          rawConfig?.previewSupportedExtensions,
          DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS
        );
        setSupportedExtensions((current) => {
          if (
            current.length === sanitized.length &&
            current.every((value, index) => value === sanitized[index])
          ) {
            return current;
          }
          return sanitized;
        });
      } catch (error) {
        electronAPI.logError?.('filePreview.loadSupportedExtensionsFailed', {
          err: String(error),
        });
      } finally {
        if (!cancelled) {
          setExtensionsReady(true);
        }
      }
    };

    void loadSupportedExtensions();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setLoading(false);
      return;
    }

    if (!filePath) {
      setLoading(false);
      setPreviewData(null);
      return;
    }

    if (!extensionsReady) {
      setLoading(true);
      setPreviewData(null);
      return;
    }

    if (!previewAllowed) {
      setLoading(false);
      setPreviewData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPreviewData(null);

    const loadPreview = async () => {
      try {
        const response = await apiService.previewFile(filePath, { origin: true });
        if (cancelled) {
          return;
        }
        if (response.success) {
          setPreviewData(response.data as PreviewData);
        } else {
          message.error(response.message || t('filePreview.messages.loadFailed'));
          onClose();
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        message.error(t('filePreview.messages.loadFailed'));
        console.error(error);
        onClose();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [visible, filePath, previewAllowed, extensionsReady, onClose, t]);

  // When maximized, intercept Escape to exit maximize mode instead of closing modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isMaximized && e.key === 'Escape') {
        setIsMaximized(false);
        e.stopPropagation();
      }
    };

    if (isMaximized) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMaximized]);

  // Reset maximize state when modal is closed
  useEffect(() => {
    if (!visible) {
      setIsMaximized(false);
    }
  }, [visible]);

  useEffect(() => {
    setVideoError(false);
  }, [previewData?.file_path, previewData?.file_type]);

  const handleOpenInFolder = async () => {
    try {
      // Use system default handler to open the file directory
      const folderPath = filePath.substring(0, filePath.lastIndexOf(getPathSeparator()));
      await electronAPI.openFile(folderPath);
    } catch (error) {
      message.error(t('filePreview.messages.openFolderFailed'));
      console.error(error);
    }
  };

  const handleOpenWithDefault = async () => {
    try {
      await electronAPI.openFile(filePath);
    } catch (error) {
      message.error(t('filePreview.messages.openFileFailed'));
      console.error(error);
    }
  };

  const getPathSeparator = () => {
    return navigator.userAgent.includes('Windows') ? '\\' : '/';
  };

  const isMarkdownPreview = (data: PreviewData) => {
    const mimeType = data.mime_type?.toLowerCase() ?? '';
    if (mimeType.includes('markdown')) {
      return true;
    }

    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension === 'md' || extension === 'markdown';
  };

  const renderPreviewContent = () => {
    if (!previewData) return null;

    if (previewData.file_type === 'video') {
      const source = (() => {
        const content = previewData.content || '';
        if (/^(data:|blob:|https?:|file:)/i.test(content)) {
          return content;
        }
        const fileUrl = electronAPI.toFileUrl?.(previewData.file_path);
        return fileUrl && fileUrl.length > 0 ? fileUrl : content;
      })();

      const handleVideoError = () => {
        setVideoError(true);
        message.warning(t('filePreview.messages.videoPlaybackNotSupported'));
      };

      if (videoError) {
        return (
          <Alert
            type="warning"
            showIcon
            message={t('filePreview.messages.videoPlaybackNotSupported')}
            action={
              <Button type="primary" onClick={handleOpenWithDefault}>
                {t('filePreview.buttons.openWithDefault')}
              </Button>
            }
          />
        );
      }

      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <video
            key={source}
            controls
            controlsList="nodownload"
            preload="metadata"
            style={{
              width: '100%',
              maxHeight: previewMaxHeight,
              borderRadius: '4px',
              backgroundColor: '#000'
            }}
            onError={handleVideoError}
          >
            <source src={source} type={previewData.mime_type || 'video/mp4'} />
            {t('filePreview.messages.videoPlaybackNotSupported')}
          </video>
        </div>
      );
    }

    if (previewData.file_type === 'image') {
      return (
        <div style={{ textAlign: 'center' }}>
          <img
            src={previewData.content}
            alt={fileName}
            style={{
              maxWidth: '100%',
              maxHeight: previewMaxHeight,
              objectFit: 'contain'
            }}
          />
        </div>
      );
    } else if (previewData.file_type === 'html') {
      return (
        <div
          style={{
            maxHeight: previewMaxHeight,
            borderRadius: '4px',
            overflow: 'hidden',
            border: '1px solid #f0f0f0'
          }}
        >
          <iframe
            title={fileName}
            sandbox="allow-same-origin"
            srcDoc={htmlSrcDoc ?? previewData.content}
            style={{
              width: '100%',
              height: previewMaxHeight,
              border: 'none',
              background: '#fff'
            }}
          />
        </div>
      );
          } else if (previewData.file_type === 'pdf') {
            return (
              <div
                style={{
                  maxHeight: previewMaxHeight,
                  borderRadius: '4px',
                  overflow: 'hidden',
                  border: '1px solid #f0f0f0'
                }}
              >
                <iframe
                  title={fileName}
                  src={previewData.content}
                  style={{
                    width: '100%',
                    height: previewMaxHeight,
                    border: 'none',
                    background: '#fff'
                  }}
                />
              </div>
            );
    } else if (previewData.file_type === 'text') {
      if (isMarkdownPreview(previewData)) {
        return (
          <div
            style={{
              maxHeight: previewMaxHeight,
              overflow: 'auto',
              background: '#fff',
              padding: '16px',
              borderRadius: '4px',
              color: '#1f1f1f',
              lineHeight: 1.6
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewData.content}</ReactMarkdown>
            {previewData.truncated && (
              <div style={{ marginTop: '16px', color: '#999', fontStyle: 'italic' }}>
                {t('filePreview.messages.truncatedMessage')}
              </div>
            )}
          </div>
        );
      }

      return (
        <div
          style={{
            maxHeight: previewMaxHeight,
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
      width={isMaximized ? '100%' : 800}
      style={isMaximized ? { top: 0, padding: 0 } : undefined}
      styles={
        isMaximized
          ? {
              body: {
                height: 'calc(100vh - 150px)',
                padding: '24px'
              }
            }
          : undefined
      }
      keyboard={!isMaximized}
      maskClosable={!isMaximized}
      footer={
        <Space>
          <Button icon={<FolderOpenOutlined />} onClick={handleOpenInFolder}>
            {t('filePreview.buttons.openInFolder')}
          </Button>
          <Button icon={<GlobalOutlined />} onClick={handleOpenWithDefault}>
            {t('filePreview.buttons.openWithDefault')}
          </Button>
          <Button
            icon={isMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            onClick={() => setIsMaximized((s) => !s)}
          >
            {isMaximized ? t('filePreview.buttons.restore') : t('filePreview.buttons.maximize')}
          </Button>
          <Button onClick={onClose}>
            {t('filePreview.buttons.close')}
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {!extensionsReady ? null : previewAllowed ? (
          renderPreviewContent()
        ) : (
          <Alert
            type="info"
            showIcon
            message={t('filePreview.messages.previewDisabled')}
            description={t('filePreview.messages.supportedTypesHint', {
              types: supportedExtensionsLabel,
            })}
          />
        )}
      </Spin>
    </Modal>
  );
};

export default FilePreview;