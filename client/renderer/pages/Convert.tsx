import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout, Card, Button, Select, Input, Switch, Space, Typography, Alert, message } from 'antd';
import { ReloadOutlined, FolderOpenOutlined, FileDoneOutlined } from '@ant-design/icons';
import Sidebar from '../components/Sidebar';
import { apiService } from '../services/api';

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

const FileConversion: React.FC = () => {
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
        setFormats(response.data);
        const defaultFormat = response.data.output_formats.find((fmt) => markdownFormats.has(fmt.toLowerCase()))
          ?? response.data.output_formats[0];
        setTargetFormat(defaultFormat);
        if (response.data.default_output_directory) {
          setOutputDirectory(response.data.default_output_directory);
        }
      } else {
        message.error(response.message || '获取转换格式失败');
      }
    } catch (error) {
      console.error(error);
      message.error('获取转换格式失败');
    } finally {
      setLoadingFormats(false);
    }
  }, []);

  useEffect(() => {
    void fetchFormats();
  }, [fetchFormats]);

  const handleSelectFile = async () => {
    if (!window.electronAPI) {
      message.error('桌面环境不可用');
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
      message.error('选择文件失败');
    }
  };

  const handleSelectOutputDirectory = async () => {
    if (!window.electronAPI) {
      message.error('桌面环境不可用');
      return;
    }
    try {
      const selected = await window.electronAPI.selectFolder();
      if (selected) {
        setOutputDirectory(selected);
      }
    } catch (error) {
      console.error(error);
      message.error('选择目录失败');
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
      message.warning('请先选择要转换的文件');
      return;
    }
    if (!targetFormat) {
      message.warning('请选择目标格式');
      return;
    }
    if (formats && !formats.pandoc_available && !markdownFormats.has(targetFormat.toLowerCase())) {
      message.warning('当前环境未检测到 Pandoc，仅支持转换为 Markdown');
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
        message.success(response.message || '文件转换成功');
      } else {
        message.error(response.message || '文件转换失败');
      }
    } catch (error) {
      console.error(error);
      message.error('文件转换失败');
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
        message.error('无法打开文件');
      }
    } catch (error) {
      console.error(error);
      message.error('无法打开文件');
    }
  };

  const handleRevealFolder = async () => {
    if (!conversionResult || !window.electronAPI) {
      return;
    }
    try {
      const opened = await window.electronAPI.openFolder(conversionResult.output_file_path);
      if (!opened) {
        message.error('无法打开所在目录');
      }
    } catch (error) {
      console.error(error);
      message.error('无法打开所在目录');
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
                  文件格式转换
                </Title>
                <Paragraph style={{ marginBottom: 0 }}>选择本地文件并一键转换为所需格式</Paragraph>
              </div>
              <Button icon={<ReloadOutlined />} onClick={fetchFormats} loading={loadingFormats}>
                刷新格式列表
              </Button>
            </div>

            {!formats && !loadingFormats ? (
              <Alert message="尚未获取到转换格式，请刷新后重试" type="warning" showIcon />
            ) : null}

            {formats && !formats.pandoc_available ? (
              <Alert
                type="info"
                showIcon
                message="未检测到 Pandoc，仅支持转换为 Markdown。"
                description="请在系统中安装 Pandoc 后重新打开应用，以启用更多转换格式。"
              />
            ) : null}

            <Card title="转换设置" loading={loadingFormats}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <div>
                  <Text strong>源文件</Text>
                  <Space style={{ width: '100%', marginTop: 8 }}>
                    <Input value={sourceFile} placeholder="请选择要转换的文件" readOnly />
                    <Button type="primary" onClick={handleSelectFile}>
                      选择文件
                    </Button>
                  </Space>
                </div>

                <div>
                  <Text strong>目标格式</Text>
                  <Select
                    style={{ width: '100%', marginTop: 8 }}
                    placeholder="请选择目标格式"
                    value={targetFormat}
                    onChange={(value) => setTargetFormat(value)}
                    options={conversionOptions}
                    showSearch
                  />
                </div>

                <div>
                  <Text strong>输出目录</Text>
                  <Space style={{ width: '100%', marginTop: 8 }}>
                    <Input
                      value={outputDirectory}
                      placeholder="默认使用系统转换目录"
                      onChange={(event) => setOutputDirectory(event.target.value)}
                    />
                    <Button icon={<FolderOpenOutlined />} onClick={handleSelectOutputDirectory}>
                      选择目录
                    </Button>
                  </Space>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space>
                    <Text strong>覆盖已存在的文件</Text>
                    <Switch checked={overwrite} onChange={setOverwrite} />
                  </Space>
                  <Button type="primary" loading={converting} onClick={handleConvert}>
                    开始转换
                  </Button>
                </div>
              </Space>
            </Card>

            {conversionResult ? (
              <Card title="转换结果" type="inner">
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>输出文件：</Text>
                    <Text copyable>{conversionResult.output_file_path}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>源文件：</Text>
                    <Text copyable>{conversionResult.source_file_path}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>目标格式：</Text>
                    <Text>{conversionResult.output_format.toUpperCase()}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>文件大小：</Text>
                    <Text>{formatFileSize(conversionResult.size)}</Text>
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text strong>转换信息：</Text>
                    <Text>{conversionResult.message}</Text>
                  </Paragraph>
                  <Space size="middle" style={{ marginTop: 12 }}>
                    <Button icon={<FileDoneOutlined />} onClick={handleOpenConvertedFile}>
                      打开文件
                    </Button>
                    <Button icon={<FolderOpenOutlined />} onClick={handleRevealFolder}>
                      打开所在目录
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
