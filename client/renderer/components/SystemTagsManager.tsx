import React, { useState, useEffect } from 'react';
import { Modal, Input, Tag, Button, message, Space, Spin } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import { apiService } from '../services/api';
import { useTranslation } from '../shared/i18n/I18nProvider';

interface SystemTagsManagerProps {
  open: boolean;
  onClose: () => void;
}

const SystemTagsManager: React.FC<SystemTagsManagerProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [tags, setTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      loadTags();
    }
  }, [open]);

  const loadTags = async () => {
    setLoading(true);
    try {
      const response = await apiService.listSystemTags();
      if (response.success && response.data) {
        setTags(response.data.tags || []);
      } else {
        message.error(t('systemTags.messages.loadFailed'));
      }
    } catch (error) {
      console.error('Failed to load system tags:', error);
      message.error(t('systemTags.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = () => {
    const trimmedValue = inputValue.trim();
    if (!trimmedValue) {
      return;
    }

    if (tags.includes(trimmedValue)) {
      message.warning(t('systemTags.messages.tagExists'));
      setInputValue('');
      return;
    }

    setTags([...tags, trimmedValue]);
    setInputValue('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await apiService.saveSystemTags(tags);
      if (response.success) {
        message.success(t('systemTags.messages.saveSuccess'));
        onClose();
      } else {
        message.error(t('systemTags.messages.saveFailed'));
      }
    } catch (error) {
      console.error('Failed to save system tags:', error);
      message.error(t('systemTags.messages.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleInputKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <Modal
      title={t('systemTags.title')}
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}>
          {t('common.save')}
        </Button>,
      ]}
      width={600}
    >
      <Spin spinning={loading}>
        <div style={{ marginBottom: 16 }}>
          <p>{t('systemTags.description')}</p>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={t('systemTags.inputPlaceholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleInputKeyPress}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddTag}>
              {t('systemTags.addButton')}
            </Button>
          </Space.Compact>
        </div>

        <div
          style={{
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            padding: 16,
            minHeight: 200,
            maxHeight: 400,
            overflowY: 'auto',
          }}
        >
          {tags.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
              {t('systemTags.emptyMessage')}
            </div>
          ) : (
            <Space wrap>
              {tags.map((tag) => (
                <Tag
                  key={tag}
                  closable
                  closeIcon={<CloseOutlined />}
                  onClose={() => handleRemoveTag(tag)}
                  style={{ marginBottom: 8 }}
                >
                  {tag}
                </Tag>
              ))}
            </Space>
          )}
        </div>

        <div style={{ marginTop: 16, color: '#666', fontSize: 12 }}>
          {t('systemTags.count', { count: tags.length })}
        </div>
      </Spin>
    </Modal>
  );
};

export default SystemTagsManager;
