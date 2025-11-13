import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Modal,
  Form,
  Input,
  Select,
  Upload,
  message,
  Checkbox,
  Button,
  Space,
  Typography,
  Spin,
} from "antd";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import { UploadOutlined } from "@ant-design/icons";
import type { RcFile, UploadFile, UploadChangeParam } from "antd/es/upload/interface";
import * as Sentry from "@sentry/react";

const { TextArea } = Input;
const { Text } = Typography;

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  defaultIncludeLogs?: boolean;
}

interface FeedbackFormValues {
  name: string;
  contact?: string;
  type?: string;
  description: string;
  includeLogs: boolean;
  attachments: UploadFile[];
}

const FeedbackModal = ({ open, onClose, t, defaultIncludeLogs = false }: FeedbackModalProps) => {
  const [form] = Form.useForm<FeedbackFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [fetchingLogs, setFetchingLogs] = useState(false);
  const [logsAttachment, setLogsAttachment] = useState<{
    filename: string;
    data: Uint8Array;
    contentType?: string;
  } | null>(null);

  const issueTypes = useMemo(
    () => [
      { value: "bug", label: t("settings.feedback.type.bug") },
      { value: "feature", label: t("settings.feedback.type.feature") },
      { value: "general", label: t("settings.feedback.type.general") },
    ],
    [t]
  );

  const initialFormValues = useMemo(
    () => ({ includeLogs: defaultIncludeLogs, attachments: [] as UploadFile[] }),
    [defaultIncludeLogs]
  );

  const base64ToUint8Array = useCallback((base64: string) => {
    const binary = window.atob(base64);
    const length = binary.length;
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }, []);

  const handleClose = useCallback(() => {
    form.resetFields();
    setLogsAttachment(null);
    setFetchingLogs(false);
    onClose();
  }, [form, onClose]);

  const beforeUploadScreenshot = useCallback((file: RcFile) => {
    const isImage = file.type.startsWith("image/");
    if (!isImage) {
      message.error(t("settings.feedback.errors.invalidImage"));
      return Upload.LIST_IGNORE;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      message.error(t("settings.feedback.errors.imageTooLarge"));
      return Upload.LIST_IGNORE;
    }
    return false;
  }, [t]);

  const toggleIncludeLogs = useCallback(async (checked: boolean, options?: { silent?: boolean }) => {
    form.setFieldsValue({ includeLogs: checked });
    setLogsAttachment(null);

    if (!checked) {
      return;
    }

    if (!window.electronAPI?.getLogArchive) {
      message.error(t("settings.feedback.errors.logsUnavailable"));
      form.setFieldsValue({ includeLogs: false });
      return;
    }

    try {
      setFetchingLogs(true);
      const archive = await window.electronAPI.getLogArchive();
      if (!archive) {
        throw new Error("log_archive_missing");
      }
      setLogsAttachment({
        filename: archive.filename,
        data: base64ToUint8Array(archive.data),
        contentType: archive.contentType ?? "application/zip",
      });
      if (!options?.silent) {
        message.success(t("settings.feedback.messages.logsAttached"));
      }
    } catch (error) {
      console.error("Failed to prepare log archive:", error);
      message.error(t("settings.feedback.errors.logsUnavailable"));
      form.setFieldsValue({ includeLogs: false });
    } finally {
      setFetchingLogs(false);
    }
  }, [base64ToUint8Array, form, t]);

  const handleIncludeLogsChange = useCallback((event: CheckboxChangeEvent) => {
    void toggleIncludeLogs(event.target.checked);
  }, [toggleIncludeLogs]);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      if (!Sentry.getCurrentHub().getClient()) {
        message.error(t("settings.feedback.messages.notInitialized"));
        return;
      }

      setSubmitting(true);

      const attachments: Array<{ filename: string; data: Uint8Array; contentType?: string }> = [];

      for (const uploadFile of values.attachments || []) {
        const origin = uploadFile.originFileObj as RcFile | undefined;
        if (!origin) continue;
        const buffer = await origin.arrayBuffer();
        attachments.push({
          filename: origin.name,
          data: new Uint8Array(buffer),
          contentType: origin.type || "application/octet-stream",
        });
      }

      if (values.includeLogs && logsAttachment) {
        attachments.push({
          filename: logsAttachment.filename,
          data: logsAttachment.data,
          contentType: logsAttachment.contentType ?? "application/zip",
        });
      }

      Sentry.captureFeedback(
        {
          name: values.name,
          email: values.contact,
          message: values.description,
          associatedEventId: undefined,
        },
        {
          captureContext: {
            tags: {
              issueType: values.type ?? "general",
            },
            extra: {
              includeLogs: values.includeLogs,
            },
          },
          attachments,
        }
      );

      message.success(t("settings.feedback.messages.submitted"));
      handleClose();
    } catch (error) {
      if (error instanceof Error) {
        console.error("Feedback submission error:", error);
      }
      if (error && (error as { errorFields?: unknown }).errorFields) {
        return;
      }
      message.error(t("settings.feedback.errors.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }, [form, handleClose, logsAttachment, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue({
      includeLogs: defaultIncludeLogs,
      attachments: [],
    });
    setLogsAttachment(null);
    if (defaultIncludeLogs) {
      void toggleIncludeLogs(true, { silent: true });
    }
  }, [open, defaultIncludeLogs, form, toggleIncludeLogs]);

  return (
    <Modal
      open={open}
      title={t("settings.feedback.title")}
      onCancel={handleClose}
      onOk={() => {
        void handleSubmit();
      }}
      confirmLoading={submitting}
      destroyOnClose
      okText={t("settings.feedback.actions.submit")}
      cancelText={t("common.cancel")}
    >
      <Form form={form} layout="vertical" initialValues={initialFormValues}>
        <Form.Item
          label={t("settings.feedback.fields.name")}
          name="name"
          rules={[{ required: true, message: t("settings.feedback.errors.nameRequired") }]}
        >
          <Input placeholder={t("settings.feedback.placeholders.name")} maxLength={120} allowClear />
        </Form.Item>

        <Form.Item label={t("settings.feedback.fields.contact")} name="contact">
          <Input placeholder={t("settings.feedback.placeholders.contact")} maxLength={120} allowClear />
        </Form.Item>

        <Form.Item label={t("settings.feedback.fields.type")} name="type">
          <Select
            allowClear
            options={issueTypes}
            placeholder={t("settings.feedback.placeholders.type")}
          />
        </Form.Item>

        <Form.Item
          label={t("settings.feedback.fields.description")}
          name="description"
          rules={[{ required: true, message: t("settings.feedback.errors.descriptionRequired") }]}
        >
          <TextArea
            placeholder={t("settings.feedback.placeholders.description")}
            rows={4}
            maxLength={2000}
            showCount
          />
        </Form.Item>

        <Form.Item
          label={t("settings.feedback.fields.screenshot")}
          valuePropName="fileList"
          name="attachments"
          getValueFromEvent={(event: UploadChangeParam<UploadFile>) =>
            Array.isArray(event) ? event : event?.fileList ?? []
          }
        >
          <Upload
            beforeUpload={beforeUploadScreenshot}
            listType="picture"
            multiple
            maxCount={3}
            accept="image/*"
            onChange={(info) => {
              form.setFieldsValue({ attachments: info.fileList });
            }}
          >
            <Button icon={<UploadOutlined />}>{t("settings.feedback.actions.uploadScreenshot")}</Button>
          </Upload>
          <Text type="secondary">{t("settings.feedback.descriptions.screenshotHint")}</Text>
        </Form.Item>

        <Form.Item name="includeLogs" valuePropName="checked">
          <Space direction="vertical">
            <Checkbox onChange={(event) => handleIncludeLogsChange(event)} disabled={fetchingLogs}>
              {t("settings.feedback.fields.includeLogs")}
            </Checkbox>
            <Text type="secondary">{t("settings.feedback.descriptions.logsHint")}</Text>
            {fetchingLogs && (
              <Space size="small">
                <Spin size="small" />
                <Text type="secondary">{t("settings.feedback.messages.logsPreparing")}</Text>
              </Space>
            )}
            {logsAttachment && !fetchingLogs && (
              <Text type="secondary">{t("settings.feedback.messages.logsReady")}</Text>
            )}
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default FeedbackModal;
