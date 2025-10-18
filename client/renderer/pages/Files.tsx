import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Layout,
  Button,
  message,
  Select,
  Table,
  Input,
  Tag,
  Space,
  Pagination,
  Modal,
  Form,
  Checkbox,
} from "antd";
import type { TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ReloadOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  QuestionCircleOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import FilePreview from "../components/FilePreview";
import FileImport, { FileImportRef } from "../components/FileImport";
import { apiService } from "../services/api";
import { ImportedFileItem } from "../shared/types";
import { useTranslation } from "../shared/i18n/I18nProvider";

const { Content } = Layout;
const { Option } = Select;

interface PaginationInfo {
  current_page: number;
  total_pages: number;
  total_count: number;
  limit: number;
}

interface FileListResponse {
  files: ImportedFileItem[];
  pagination: PaginationInfo;
}

interface FileListProps {
  onFileSelect?: (file: ImportedFileItem) => void;
  refreshTrigger?: number;
  onRetryImport?: (file: ImportedFileItem) => void;
}

const FileList: React.FC<FileListProps> = ({
  onFileSelect,
  refreshTrigger,
  onRetryImport,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [files, setFiles] = useState<ImportedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  // no workDirectory needed in list component
  const [pagination, setPagination] = useState<PaginationInfo>({
    current_page: 1,
    total_pages: 1,
    total_count: 0,
    limit: 20,
  });
  const currentPageRef = useRef(1);

  // 筛选条件
  const [filters, setFilters] = useState({
    search: "",
    category: "",
    type: "",
    tags: [] as string[],
    sort_by: "",
    sort_order: "desc",
  });

  // 预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    path: string;
    name: string;
  } | null>(null);
  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingFile, setEditingFile] = useState<ImportedFileItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tagGenerating, setTagGenerating] = useState<Record<string, boolean>>({});
  const [editForm] = Form.useForm<{
    name: string;
    category: string;
    tags: string[];
    path?: string;
    type?: string;
  }>();

  // 获取文件列表
  const fetchFiles = useCallback(
    async (page: number = 1) => {
      setLoading(true);
      try {
        const params = {
          page,
          limit: pagination.limit,
          ...filters,
        };

        const response = await apiService.getFileList(params);
        if (response.success) {
          const data = response.data as FileListResponse;
          setFiles(data.files);
          setPagination(data.pagination);
        } else {
          message.error(
            response.message || t("files.messages.fetchFilesFailed")
          );
        }
      } catch (error) {
        console.error("获取文件列表失败:", error);
        message.error(t("files.messages.fetchFilesFailed"));
      } finally {
        setLoading(false);
      }
    },
    [pagination.limit, filters, t]
  );

  // 预览文件
  const handlePreview = (file: ImportedFileItem) => {
    setPreviewFile({ path: file.path, name: file.name });
    setPreviewVisible(true);
  };

  // 打开文件目录
  const handleOpenDirectory = async (file: ImportedFileItem) => {
    try {
      // 使用 path.dirname 获取目录路径
      const dirPath =
        file.path.substring(0, file.path.lastIndexOf("\\")) ||
        file.path.substring(0, file.path.lastIndexOf("/"));

      if (window.electronAPI && window.electronAPI.openFolder) {
        const success = await window.electronAPI.openFolder(dirPath);
        if (!success) {
          message.error(t("files.messages.openDirectoryFailed"));
        }
      } else {
        message.error(t("files.messages.openDirectoryNotSupported"));
      }
    } catch (error) {
      console.error("打开目录失败:", error);
      message.error(t("files.messages.openDirectoryFailed"));
    }
  };

  // 打开文件
  const handleOpenFile = async (file: ImportedFileItem) => {
    try {
      if (window.electronAPI && window.electronAPI.openFile) {
        const success = await window.electronAPI.openFile(file.path);
        if (!success) {
          message.error(t("files.messages.openFileFailed"));
        }
      } else {
        message.error(t("files.messages.openFileNotSupported"));
      }
    } catch (error) {
      console.error("打开文件失败:", error);
      message.error(t("files.messages.openFileFailed"));
    }
  };

  // 导入到知识库
  const handleImportToRag = async (file: ImportedFileItem) => {
    try {
      const loadingKey = message.loading(
        t("files.messages.importingToRag", { name: file.name }),
        0
      );

      // The file is already recorded in DB after save; avoid duplicate DB insert in RAG import.
      const response = await apiService.importToRag(file.file_id, true);
      loadingKey();

      if (response.success) {
        message.success(
          t("files.messages.importedToRagSuccess", { name: file.name })
        );
        // 刷新文件列表以更新状态
        fetchFiles(pagination.current_page);
      } else {
        message.error(
          response.message ||
            t("files.messages.importToRagFailed", { name: file.name })
        );
      }
    } catch (error) {
      message.error(t("files.messages.importToRagFailed", { name: file.name }));
      console.error("导入知识库失败:", error);
    }
  };

  const handleDelete = (file: ImportedFileItem) => {
    let moveToRecycleBin = false;
    Modal.confirm({
      title: t("files.delete.confirmTitle", { name: file.name }),
      content: (
        <div>
          <p>{t("files.delete.confirmMessage", { name: file.name })}</p>
          <Checkbox
            onChange={(e) => {
              moveToRecycleBin = e.target.checked;
            }}
          >
            {t("files.delete.deleteFromDiskLabel")}
          </Checkbox>
        </div>
      ),
      okText: t("files.delete.okText") || t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      icon: <ExclamationCircleOutlined style={{ color: "#faad14" }} />,
      async onOk() {
        let handled = false;
        setDeletingId(file.file_id);
        try {
          const resp = await apiService.deleteFile({
            file_id: file.file_id,
            deleteFromDisk: moveToRecycleBin,
          });
          if (!resp.success) {
            handled = true;
            const errMsg =
              resp.message ||
              t("files.messages.deleteFailed", { name: file.name });
            message.error(errMsg);
            throw new Error(errMsg);
          }
          message.success(
            t("files.messages.deleteSuccess", { name: file.name })
          );
          const nextPage =
            files.length === 1 && pagination.current_page > 1
              ? pagination.current_page - 1
              : pagination.current_page;
          await fetchFiles(nextPage);
        } catch (error) {
          if (!handled) {
            message.error(
              t("files.messages.deleteFailed", { name: file.name })
            );
          }
          throw error;
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  // Open edit modal
  const openEdit = async (file: ImportedFileItem) => {
    setEditingFile(file);
    // Prefill from row data immediately
    editForm.setFieldsValue({
      name: file.name,
      category: file.category || "",
      tags: file.tags || [],
      // extra fields for read-only display
      path: file.path,
      type: file.type,
    });
    setEditVisible(true);
    // Then fetch latest detail to ensure up-to-date values
    try {
      const detailResp = await apiService.getFileDetail(file.file_id);
      if (detailResp?.success && detailResp.data) {
        const d = detailResp.data;
        editForm.setFieldsValue({
          name: d.name,
          category: d.category || "",
          tags: d.tags || [],
          path: d.path,
          type: d.type,
        });
      }
    } catch {
      // ignore detail fetch error; keep row values
    }
  };

  // Submit edit
  const submitEdit = async () => {
    try {
      const values = await editForm.validateFields();
      const name = (values.name || "").trim();
      const category = (values.category || "").trim();
      const rawTags = Array.isArray(values.tags) ? values.tags : [];
      if (!editingFile) return;
      if (!name) {
        message.warning(t("files.messages.editInvalidName") || "Invalid name");
        return;
      }
      // Basic invalid characters check for Windows and general OS
      const invalidPattern = /[<>:"/\\|?*]/;
      if (invalidPattern.test(name)) {
        message.error(t("files.messages.createFolderInvalidChars"));
        return;
      }
      const tags = rawTags
        .map((s) => (s || "").trim())
        .filter((s) => s.length > 0);
      setEditing(true);
      const resp = await apiService.updateFile({
        file_id: editingFile.file_id,
        name,
        category: category || undefined,
        tags,
      });
      if (resp.success) {
        message.success(t("files.messages.updateSuccess") || "Updated");
        setEditVisible(false);
        setEditing(false);
        setEditingFile(null);
        fetchFiles(pagination.current_page);
      } else {
        setEditing(false);
        message.error(
          resp.message || t("files.messages.updateFailed") || "Update failed"
        );
      }
    } catch (e: unknown) {
      if (e && typeof e === "object" && "errorFields" in e) return; // form validation error
      setEditing(false);
      message.error(t("files.messages.updateFailed") || "Update failed");
    }
  };

  // 提问文件
  const handleAskQuestion = (file: ImportedFileItem) => {
    // 构建URL参数，传递type=qa和fileIds
    const params = new URLSearchParams({
      type: "qa",
      fileIds: file.file_id,
    });
    console.log(file.file_id + " " + params.toString());
    // 使用React Router导航跳转到Search页面
    navigate(`/search?${params.toString()}`);
  };

  const handleGenerateTags = useCallback(
    async (file: ImportedFileItem) => {
      setTagGenerating((prev) => ({ ...prev, [file.file_id]: true }));
      const hideLoading = message.loading(
        t("files.messages.generateTagsInProgress", { name: file.name }),
        0
      );

      try {
        const response = await apiService.updateFileTags({
          file_id: file.file_id,
          overwrite: true,
        });

        if (response.success && response.data) {
          if (response.data.updated) {
            message.success(
              t("files.messages.generateTagsSuccess", { name: file.name })
            );
            await fetchFiles(currentPageRef.current || 1);
          } else if (response.message === "no_tags_generated") {
            message.warning(
              t("files.messages.generateTagsNoContent", { name: file.name })
            );
          } else if (response.message === "tags_exist") {
            message.info(
              t("files.messages.generateTagsAlreadyExists", { name: file.name })
            );
          } else {
            message.info(
              t("files.messages.generateTagsNoChange", { name: file.name })
            );
          }
        } else {
          message.error(
            response.message ||
              t("files.messages.generateTagsFailed", { name: file.name })
          );
        }
      } catch (error) {
        const fallbackMsg = t("files.messages.generateTagsFailed", { name: file.name });
        const noContentMsg = t("files.messages.generateTagsNoContent", { name: file.name });
        if (error instanceof Error && error.message) {
          if (error.message.includes("No analyzable content")) {
            message.warning(noContentMsg);
          } else {
            message.error(error.message || fallbackMsg);
          }
        } else {
          message.error(fallbackMsg);
        }
      } finally {
        hideLoading();
        setTagGenerating((prev) => {
          const next = { ...prev };
          delete next[file.file_id];
          return next;
        });
      }
    },
    [fetchFiles, t]
  );

  const handlePendingStatusClick = useCallback(
    (file: ImportedFileItem) => {
      if (!onRetryImport) {
        return;
      }
      Modal.confirm({
        title: t("files.messages.retryImportConfirmTitle", { name: file.name }),
        content: t("files.messages.retryImportConfirmContent"),
        okText: t("common.retry"),
        cancelText: t("common.cancel"),
        icon: <ReloadOutlined style={{ color: "#faad14" }} />,
        centered: true,
        onOk: () => {
          onRetryImport(file);
        },
      });
    },
    [onRetryImport, t]
  );

  const getCategoryLabel = useCallback(
    (rawCategory?: string | null) => {
      const normalized = (rawCategory ?? "").trim();
      if (!normalized) {
        return t("files.table.category.uncategorized");
      }

      const lower = normalized.toLowerCase();
      const categoryLocaleMap: Record<string, string> = {
        document: "files.options.categories.document",
        sheet: "files.options.categories.sheet",
        image: "files.options.categories.image",
        video: "files.options.categories.video",
        audio: "files.options.categories.audio",
        archive: "files.options.categories.archive",
        other: "files.options.categories.other",
      };

      const translationKey = categoryLocaleMap[lower];
      if (translationKey) {
        return t(translationKey);
      }

      return normalized;
    },
    [t]
  );

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // 表格列配置
  const columns: ColumnsType<ImportedFileItem> = [
    {
      title: t("files.table.columns.name"),
      dataIndex: "name",
      key: "name",
      ellipsis: false,
      width: 200,
      fixed: "left",
      sorter: true,
      render: (name: string, record: ImportedFileItem) => (
        <div>
          <FileTextOutlined style={{ marginRight: 8 }} />
          <span title={record.path}>{name}</span>
        </div>
      ),
    },
    {
      title: t("files.table.columns.category"),
      dataIndex: "category",
      key: "category",
      width: 120,
      render: (category: string) => (
        <Tag color="green">
          {getCategoryLabel(category)}
        </Tag>
      ),
    },
    {
      title: t("files.table.columns.size"),
      dataIndex: "size",
      key: "size",
      width: 100,
      sorter: true,
      render: (size: number) => formatFileSize(size),
    },
    {
      title: t("files.table.columns.tags"),
      dataIndex: "tags",
      key: "tags",
      fixed: "right",
      width: 200,
      render: (_: string[], record: ImportedFileItem) => {
        const tags = Array.isArray(record.tags) ? record.tags : [];
        if (tags.length === 0) {
          const generating = Boolean(tagGenerating[record.file_id]);
          return (
            <Button
              type="link"
              size="small"
              loading={generating}
              onClick={(event) => {
                event.stopPropagation();
                handleGenerateTags(record);
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {t("files.actions.generateTags")}
            </Button>
          );
        }

        return (
          <div>
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        );
      },
    },
    {
      title: t("files.table.columns.addedAt"),
      dataIndex: "created_at",
      key: "created_at",
      width: 120,
      sorter: true,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: t("files.table.columns.status"),
      key: "status",
      width: 200,
      render: (_: unknown, record: ImportedFileItem) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {record.imported ? (
              <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 8 }} />
            ) : (
              <CloseCircleOutlined style={{ color: "#faad14", marginRight: 8 }} />
            )}
            <span style={{ color: record.imported ? "#52c41a" : "#faad14" }}>
              {t("files.table.columns.importStatus")}: {record.imported ? (
                t("files.table.importStatus.imported")
              ) : onRetryImport ? (
                <span
                  role="button"
                  tabIndex={0}
                  style={{
                    color: "#faad14",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    handlePendingStatusClick(record);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      handlePendingStatusClick(record);
                    }
                  }}
                >
                  {t("files.table.importStatus.pending")}
                </span>
              ) : (
                t("files.table.importStatus.pending")
              )}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            {record.processed ? (
              <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 8 }} />
            ) : (
              <CloseCircleOutlined style={{ color: "#ff4d4f", marginRight: 8 }} />
            )}
            <span style={{ color: record.processed ? "#52c41a" : "#ff4d4f" }}>
              {t("files.table.columns.ragStatus")}: {record.processed ? t("files.table.ragStatus.imported") : t("files.table.ragStatus.notImported")}
            </span>
          </div>
        </div>
      ),
    },
    {
      title: t("files.table.columns.actions"),
      key: "actions",
      width: 200,
      fixed: "right",
      render: (_: unknown, record: ImportedFileItem) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => handlePreview(record)}
            title={t("files.actions.preview")}
          />
          <Button
            type="text"
            icon={<FolderOpenOutlined />}
            onClick={() => handleOpenDirectory(record)}
            title={t("files.actions.openDirectory")}
          />
          <Button
            type="text"
            icon={<FileTextOutlined />}
            onClick={() => handleOpenFile(record)}
            title={t("files.actions.openFile")}
          />
          <Button
            type="text"
            icon={<DatabaseOutlined />}
            onClick={() => handleImportToRag(record)}
            title={t("files.actions.importToRag")}
            disabled={!record.imported || record.processed}
          />
          <Button
            type="text"
            icon={<QuestionCircleOutlined />}
            onClick={() => handleAskQuestion(record)}
            title={t("files.actions.askQuestion")}
          />
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            title={t("files.actions.editFile") || "Edit"}
          />
          <Button
            type="text"
            icon={<DeleteOutlined />}
            danger
            onClick={() => handleDelete(record)}
            title={t("files.actions.delete") || "Delete"}
            loading={deletingId === record.file_id}
            disabled={deletingId === record.file_id}
          />
        </Space>
      ),
    },
  ];

  // 处理筛选条件变化
  const handleFilterChange = (key: string, value: string | string[]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    fetchFiles(1);
  };

  // 处理分页变化
  const handlePageChange = (page: number) => {
    fetchFiles(page);
  };

  // 处理表格变化（排序、分页等）
  const handleTableChange: TableProps<ImportedFileItem>["onChange"] = (
    pagination,
    _filters,
    sorter
  ) => {
    if (
      sorter &&
      typeof sorter === "object" &&
      "field" in sorter &&
      "order" in sorter
    ) {
      const sortOrder = sorter.order === "ascend" ? "asc" : "desc";
      setFilters((prev) => ({
        ...prev,
        sort_by: sorter.field as string,
        sort_order: sortOrder,
      }));
      fetchFiles(pagination.current || 1);
    } else {
      // 取消排序
      setFilters((prev) => ({
        ...prev,
        sort_by: "",
        sort_order: "desc",
      }));
      fetchFiles(pagination.current || 1);
    }
  };

  // 搜索
  const handleSearch = () => {
    fetchFiles(1);
  };

  // 初始化加载
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    currentPageRef.current = pagination.current_page || 1;
  }, [pagination.current_page]);

  useEffect(() => {
    const handleExternalRefresh = () => {
      void fetchFiles(currentPageRef.current || 1);
    };

    window.addEventListener(
      "files:refresh",
      handleExternalRefresh as EventListener
    );

    return () => {
      window.removeEventListener(
        "files:refresh",
        handleExternalRefresh as EventListener
      );
    };
  }, [fetchFiles]);

  // 监听刷新触发器
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchFiles();
    }
  }, [refreshTrigger, fetchFiles]);

  return (
    <div style={{ padding: 16 }}>
      {/* 筛选条件 */}
      <div
        style={{ marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}
      >
        <Input
          placeholder={t("files.placeholders.searchFileName")}
          prefix={<SearchOutlined />}
          value={filters.search}
          onChange={(e) => handleFilterChange("search", e.target.value)}
          onPressEnter={handleSearch}
          style={{ width: 300 }}
        />
        <label style={{ display: "flex", alignItems: "center" }}>
          {t("files.placeholders.selectCategory")}
        </label>
        <Select
          placeholder={t("files.placeholders.selectCategory")}
          value={filters.category}
          onChange={(value) => handleFilterChange("category", value)}
          style={{ width: 150 }}
          allowClear
        >
          <Option value="document">
            {t("files.options.categories.document")}
          </Option>
          <Option value="sheet">{t("files.options.categories.sheet")}</Option>
          <Option value="image">{t("files.options.categories.image")}</Option>
          <Option value="video">{t("files.options.categories.video")}</Option>
          <Option value="audio">{t("files.options.categories.audio")}</Option>
          <Option value="archive">
            {t("files.options.categories.archive")}
          </Option>
          <Option value="other">{t("files.options.categories.other")}</Option>
        </Select>
        <label style={{ display: "flex", alignItems: "center" }}>
          {t("files.placeholders.selectType")}
        </label>
        <Select
          placeholder={t("files.placeholders.selectType")}
          value={filters.type}
          onChange={(value) => handleFilterChange("type", value)}
          style={{ width: 150 }}
          allowClear
        >
          <Option value="pdf">{t("files.options.types.pdf")}</Option>
          <Option value="docx">{t("files.options.types.docx")}</Option>
          <Option value="xlsx">{t("files.options.types.xlsx")}</Option>
          <Option value="pptx">{t("files.options.types.pptx")}</Option>
          <Option value="txt">{t("files.options.types.txt")}</Option>
          <Option value="jpg">{t("files.options.types.jpg")}</Option>
          <Option value="png">{t("files.options.types.png")}</Option>
          <Option value="mp4">{t("files.options.types.mp4")}</Option>
          <Option value="zip">{t("files.options.types.zip")}</Option>
        </Select>
        <Button type="primary" onClick={handleSearch}>
          {t("files.buttons.search")}
        </Button>
      </div>

      {/* 文件列表表格 */}
      <Table
        columns={columns}
        dataSource={files}
        rowKey="file_id"
        loading={loading}
        pagination={false}
        size="small"
        onChange={handleTableChange}
        onRow={(record) => ({
          onClick: () => onFileSelect?.(record),
        })}
      />

      {/* 分页 */}
      {pagination.total_pages > 1 && (
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <Pagination
            current={pagination.current_page}
            total={pagination.total_count}
            pageSize={pagination.limit}
            onChange={handlePageChange}
            showSizeChanger={false}
            showQuickJumper
            showTotal={(total, range) =>
              t("files.pagination.showTotal", {
                start: range[0],
                end: range[1],
                total,
              })
            }
          />
        </div>
      )}

      {/* 预览模态框 */}
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

      {/* 编辑文件信息模态框 */}
      <Modal
        open={editVisible}
        title={t("files.edit.modalTitle") || "Edit File"}
        okText={t("common.confirm") || "Confirm"}
        cancelText={t("common.cancel") || "Cancel"}
        onOk={submitEdit}
        onCancel={() => {
          setEditVisible(false);
          setEditingFile(null);
          editForm.resetFields();
        }}
        confirmLoading={editing}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item label={t("files.table.columns.path")} name="path">
            <Input disabled />
          </Form.Item>
          <Form.Item
            label={t("files.table.columns.name")}
            name="name"
            rules={[
              {
                required: true,
                message:
                  t("files.messages.editInvalidName") || "Please input name",
              },
            ]}
          >
            <Input allowClear />
          </Form.Item>
          <Form.Item label={t("files.table.columns.category")} name="category">
            <Select
              allowClear
              placeholder={t("files.placeholders.selectCategory")}
            >
              <Option value="document">
                {t("files.options.categories.document")}
              </Option>
              <Option value="sheet">
                {t("files.options.categories.sheet")}
              </Option>
              <Option value="image">
                {t("files.options.categories.image")}
              </Option>
              <Option value="video">
                {t("files.options.categories.video")}
              </Option>
              <Option value="audio">
                {t("files.options.categories.audio")}
              </Option>
              <Option value="archive">
                {t("files.options.categories.archive")}
              </Option>
              <Option value="other">
                {t("files.options.categories.other")}
              </Option>
            </Select>
          </Form.Item>
          <Form.Item label={t("files.table.columns.tags")} name="tags">
            <Select
              mode="tags"
              allowClear
              tokenSeparators={[",", " "]}
              placeholder={
                t("files.placeholders.tagsCommaSeparated") ||
                "Add tags, press Enter"
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

const FilesPage: React.FC = () => {
  const { t } = useTranslation();
  const selectedMenu = "file-list";
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const importRef = useRef<FileImportRef>(null);

  // Work directory for creating folders under
  const [workDirectory, setWorkDirectory] = useState<string>("workdir");
  // Create folder modal state
  const [createFolderVisible, setCreateFolderVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ folderName: string }>();

  // Import flow is encapsulated in FileImport component now.

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleRetryImport = useCallback(
    (file: ImportedFileItem) => {
      if (!importRef.current) {
        message.error(t("files.messages.retryImportUnavailable"));
        return;
      }
      void importRef.current
        .retryImport(file)
        .catch((error: unknown) => {
          window.electronAPI?.logError?.("retry import failed", {
            err: String(error),
            fileId: file.file_id,
          });
        });
    },
    [t]
  );

  // Load workDirectory from app config
  useEffect(() => {
    const loadWorkDirectory = async () => {
      try {
        const cfg =
          (await window.electronAPI.getAppConfig()) as import("../shared/types").AppConfig;
        const wd = cfg?.workDirectory as string | undefined;
        if (wd) setWorkDirectory(wd);
      } catch (error) {
        console.error("Failed to load workDirectory:", error);
      }
    };
    void loadWorkDirectory();
  }, []);

  // Validate and create folder
  const handleCreateFolder = async () => {
    try {
      const values = await form.validateFields();
      const name = (values.folderName || "").trim();
      if (!name) {
        message.warning(t("files.messages.createFolderInvalidName"));
        return;
      }
      // Simple invalid chars check for Windows and general OS
      const invalidPattern = /[<>:"/\\|?*]/;
      if (invalidPattern.test(name)) {
        message.error(t("files.messages.createFolderInvalidChars"));
        return;
      }
      setCreating(true);
      const base = workDirectory.replace(/[\\/]+$/, "");
      const targetPath = `${base}/${name}`;
      const resp = await apiService.createDirectory(targetPath);
      if (resp.success) {
        message.success(t("files.messages.createFolderSuccess"));
        setCreateFolderVisible(false);
        form.resetFields();
        // trigger file list refresh
        setRefreshTrigger((prev) => prev + 1);
      } else {
        message.error(resp.message || t("files.messages.createFolderFailed"));
      }
    } catch (e: unknown) {
      // Ignore validation errors
      if (e && typeof e === "object" && "errorFields" in e) return;
      console.error("Create folder failed:", e);
      message.error(t("files.messages.createFolderFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout style={{ padding: "0 24px 24px" }}>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: "#fff",
          }}
        >
          <div
            style={{
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h1>{t("files.pageTitle")}</h1>
              <p>{t("files.pageDescription")}</p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
                size="large"
              >
                {t("files.buttons.refresh")}
              </Button>
              <Button
                icon={<FolderAddOutlined />}
                onClick={() => setCreateFolderVisible(true)}
                size="large"
              >
                {t("files.buttons.createFolder")}
              </Button>
              <Button
                type="primary"
                icon={<FileAddOutlined />}
                onClick={() => importRef.current?.startImport()}
                size="large"
              >
                {t("files.buttons.importFile")}
              </Button>
            </div>
          </div>

      <FileList refreshTrigger={refreshTrigger} onRetryImport={handleRetryImport} />
          <FileImport
            ref={importRef}
            onImported={() => setRefreshTrigger((prev) => prev + 1)}
          />

          <Modal
            open={createFolderVisible}
            title={t("files.createFolder.modalTitle")}
            okText={t("files.createFolder.okText")}
            cancelText={t("files.createFolder.cancelText")}
            onOk={handleCreateFolder}
            onCancel={() => {
              setCreateFolderVisible(false);
              form.resetFields();
            }}
            confirmLoading={creating}
            destroyOnHidden
          >
            <Form form={form} layout="vertical" preserve={false}>
              <Form.Item
                label={t("files.createFolder.label")}
                name="folderName"
                rules={[
                  {
                    required: true,
                    message: t("files.messages.createFolderInvalidName"),
                  },
                ]}
              >
                <Input
                  placeholder={t("files.createFolder.placeholder")}
                  allowClear
                />
              </Form.Item>
              <div style={{ color: "#888", fontSize: 12 }}>
                {t("files.createFolder.help")}: {workDirectory}
              </div>
            </Form>
          </Modal>
        </Content>
      </Layout>
    </Layout>
  );
};

export default FilesPage;
