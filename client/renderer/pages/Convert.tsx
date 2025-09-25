import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout, Card, Button, Select, Input, Switch, Space, Typography, Alert, message } from 'antd';
import { ReloadOutlined, FolderOpenOutlined, FileDoneOutlined } from '@ant-design/icons';
import Sidebar from '../components/Sidebar';
import { apiService } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';

const { Content } = Layout;
const { Title, Paragraph, Text } = Typography;

interface ConversionFormats {
  input_formats: string[];
  output_formats: string[];
  default_output_directory: string;
  pandoc_available: boolean;
  markitdown_available: boolean;
}

interface ConversionResult {
  source_file_path: string;
  output_file_path: string;
  output_format: string;
  size: number;
  message: string;
}

const markdownFormats = new Set(['md', 'markdown']);

// Backend may return new shape (inputs/outputs) or legacy (input_formats/output_formats)
type BackendFormatsResponse = {
  inputs?: string[];
  outputs?: string[];
  combined?: string[];
  pandocPath?: string | null;
  default_output_directory?: string;
  pandoc_available?: boolean;
  markitdown_available?: boolean;
  // legacy fields for backward compatibility
  input_formats?: string[];
  output_formats?: string[];
};

const FileConversion: React.FC = () => {
  const { t } = useTranslation();
  const selectedMenu = 'convert';
  const [formats, setFormats] = useState<ConversionFormats | null>(null);
  const [loadingFormats, setLoadingFormats] = useState(false);
  const [sourceFile, setSourceFile] = useState('');
  const [targetFormat, setTargetFormat] = useState<string>();
  const [outputDirectory, setOutputDirectory] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [converting, setConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);

  const fetchFormats = useCallback(async () => {
    setLoadingFormats(true);
    try {
      const response = await apiService.getConversionFormats();
      if (response.success) {
        const raw: BackendFormatsResponse = response.data as unknown as BackendFormatsResponse;
        // Normalize backend response to component's expected shape
        const inputs: string[] = Array.isArray(raw?.inputs)
          ? raw.inputs
          : Array.isArray(raw?.input_formats)
            ? raw.input_formats
            : [];
        const outputs: string[] = Array.isArray(raw?.outputs)
          ? raw.outputs
          : Array.isArray(raw?.output_formats)
            ? raw.output_formats
            : [];
        const normalized: ConversionFormats = {
          input_formats: inputs,
          output_formats: outputs,
          default_output_directory: typeof raw?.default_output_directory === 'string' ? raw.default_output_directory : '',
          pandoc_available: Boolean(raw?.pandocPath) || Boolean(raw?.pandoc_available),
          markitdown_available: Boolean(raw?.markitdown_available),
        };

        setFormats(normalized);
        const defaultFormat = normalized.output_formats.find((fmt) => markdownFormats.has(fmt.toLowerCase()))
          ?? normalized.output_formats[0];
        if (defaultFormat) setTargetFormat(defaultFormat);
        if (normalized.default_output_directory) {
          setOutputDirectory(normalized.default_output_directory);
        }
      } else {
        message.error(response.message || t('convert.messages.fetchFormatsFailed'));
      }
    } catch (error) {
      console.error(error);
      // Fallback to minimal formats so the page remains usable when Pandoc listing fails
      const fallback: ConversionFormats = {
        input_formats: [],
        output_formats: ['md', 'markdown'],
        default_output_directory: '',
        pandoc_available: false,
        markitdown_available: true,
      };
      setFormats(fallback);
      setTargetFormat('md');
      message.error(t('convert.messages.fetchFormatsFailed'));
    } finally {
      setLoadingFormats(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchFormats();
  }, [fetchFormats]);

  const handleSelectFile = async () => {
    if (!window.electronAPI) {
      message.error(t('convert.messages.desktopNotAvailable'));
      return;
    }
    try {
      const selected = await window.electronAPI.selectFile();
      if (selected) {
        setSourceFile(selected);
        setConversionResult(null);
      }
    } catch (error) {
      console.error(error);
      message.error(t('convert.messages.selectFileFailed'));
    }
  };

  const handleSelectOutputDirectory = async () => {
    if (!window.electronAPI) {
      message.error(t('convert.messages.desktopNotAvailable'));
      return;
    }
    try {
      const selected = await window.electronAPI.selectFolder();
      if (selected) {
        setOutputDirectory(selected);
      }
    } catch (error) {
      console.error(error);
      message.error(t('convert.messages.selectDirectoryFailed'));
    }
  };

  const conversionOptions = useMemo(() => {
    if (!formats) {
      return [] as { label: string; value: string; disabled?: boolean }[];
    }
    const disableNonMarkdown = !formats.pandoc_available;
    return formats.output_formats.map((format) => {
      const lowerCase = format.toLowerCase();
      const isMarkdown = markdownFormats.has(lowerCase);
      return {
        label: format.toUpperCase(),
        value: format,
        disabled: disableNonMarkdown && !isMarkdown,
      };
    });
  }, [formats]);

  const formatFileSize = (size: number) => {
    if (size < 1024) {
      return `${size} B`;
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = size / 1024;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(2)} ${units[index]}`;
  };

  const handleConvert = async () => {
    if (!sourceFile) {
      message.warning(t('convert.messages.selectFileFirst'));
      return;
    }
    if (!targetFormat) {
      message.warning(t('convert.messages.selectTargetFormat'));
      return;
    }
    if (formats && !formats.pandoc_available && !markdownFormats.has(targetFormat.toLowerCase())) {
      message.warning(t('convert.messages.pandocNotAvailable'));
      return;
    }

    setConverting(true);
    setConversionResult(null);
    try {
      const payload = {
        filePath: sourceFile,
        targetFormat,
        outputDirectory: outputDirectory.trim() ? outputDirectory.trim() : undefined,
        overwrite,
      };
      const response = await apiService.convertFile(payload);
      if (response.success) {
        setConversionResult(response.data);
        message.success(response.message || t('convert.messages.conversionSuccess'));
      } else {
        message.error(response.message || t('convert.messages.conversionFailed'));
      }
    } catch (error) {
      console.error(error);
      message.error(t('convert.messages.conversionFailed'));
    } finally {
      setConverting(false);
    }
  };

  const handleOpenConvertedFile = async () => {
    if (!conversionResult || !window.electronAPI) {
      return;
    }
    try {
      const opened = await window.electronAPI.openFile(conversionResult.output_file_path);
      if (!opened) {
        message.error(t('convert.messages.cannotOpenFile'));
      }
    } catch (error) {
      console.error(error);
      message.error(t('convert.messages.cannotOpenFile'));
    }
  };

  const handleRevealFolder = async () => {
    if (!conversionResult || !window.electronAPI) {
      return;
    }
    try {
      const opened = await window.electronAPI.openFolder(conversionResult.output_file_path);
      if (!opened) {
        message.error(t('convert.messages.cannotOpenDirectory'));
      }
    } catch (error) {
      console.error(error);
      message.error(t('convert.messages.cannotOpenDirectory'));
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
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Title level={2} style={{ marginBottom: 0 }}>
                  {t('convert.pageTitle')}
                </Title>
                <Paragraph style={{ marginBottom: 0 }}>{t('convert.description')}</Paragraph>
              </div>
              <Button icon={<ReloadOutlined />} onClick={fetchFormats} loading={loadingFormats}>
                {t('convert.actions.refreshFormats')}
              </Button>
            </div>

            {!formats && !loadingFormats ? (
              <Alert message={t('convert.alerts.noFormats')} type="warning" showIcon />
            ) : null}

            {formats && !formats.pandoc_available ? (
              <Alert
                type="info"
                showIcon
                message={t('convert.alerts.pandocNotAvailable')}
                description={t('convert.alerts.pandocDescription')}
              />
            ) : null}

            <Card title={t('convert.sections.settings')} loading={loadingFormats}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <Text strong>{t('convert.labels.sourceFile')}</Text>
                  <Space style={{ width: '100%', marginTop: 8 }}>
                    <Input value={sourceFile} placeholder={t('convert.placeholders.selectFile')} readOnly />
                    <Button type="primary" onClick={handleSelectFile}>
                      {t('convert.actions.selectFile')}
                    </Button>
                  </Space>
                </div>

                <div>
                  <Text strong>{t('convert.labels.targetFormat')}</Text>
                  <Select
                    style={{ width: '100%', marginTop: 8 }}
                    placeholder={t('convert.placeholders.selectFormat')}
                    value={targetFormat}
                    onChange={(value) => setTargetFormat(value)}
                    options={conversionOptions}
                    showSearch
                  />
                </div>

                <div>
                  <Text strong>{t('convert.labels.outputDirectory')}</Text>
                  <Space style={{ width: '100%', marginTop: 8 }}>
                    <Input
                      value={outputDirectory}
                      placeholder={t('convert.placeholders.defaultDirectory')}
                      onChange={(event) => setOutputDirectory(event.target.value)}
                    />
                    <Button icon={<FolderOpenOutlined />} onClick={handleSelectOutputDirectory}>
                      {t('convert.actions.selectDirectory')}
                    </Button>
                  </Space>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space>
                    <Text strong>{t('convert.labels.overwrite')}</Text>
                    <Switch checked={overwrite} onChange={setOverwrite} />
                  </Space>
                  <Button type="primary" loading={converting} onClick={handleConvert}>
                    {t('convert.actions.startConversion')}
                  </Button>
                </div>
              </Space>
            </Card>

            {conversionResult ? (
              <Card title={t('convert.sections.result')} type="inner">
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>{t('convert.labels.outputFileLabel')}</Text>
                    <Text copyable>{conversionResult.output_file_path}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>{t('convert.labels.sourceFileLabel')}</Text>
                    <Text copyable>{conversionResult.source_file_path}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>{t('convert.labels.targetFormatLabel')}</Text>
                    <Text>{conversionResult.output_format.toUpperCase()}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>{t('convert.labels.fileSize')}</Text>
                    <Text>{formatFileSize(conversionResult.size)}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>{t('convert.labels.conversionInfo')}</Text>
                    <Text>{conversionResult.message}</Text>
                  </Paragraph>
                  <Space size="middle" style={{ marginTop: 12 }}>
                    <Button icon={<FileDoneOutlined />} onClick={handleOpenConvertedFile}>
                      {t('convert.actions.openFile')}
                    </Button>
                    <Button icon={<FolderOpenOutlined />} onClick={handleRevealFolder}>
                      {t('convert.actions.openDirectory')}
                    </Button>
                  </Space>
                </Space>
              </Card>
            ) : null}
          </Space>
        </Content>
      </Layout>
    </Layout>
  );
};

export default FileConversion;
