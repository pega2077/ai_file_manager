import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  theme,
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
  LinkOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import FilePreview from "../components/FilePreview";
import FileImport, { FileImportRef } from "../components/FileImport";
import { apiService, type FileNameAssessmentResult } from "../services/api";
import { ImportedFileItem } from "../shared/types";
import { useTranslation } from "../shared/i18n/I18nProvider";

const { Content } = Layout;
const { Option } = Select;

const MAX_NAME_ASSESSMENT_TEXT = 6000;
const INVALID_FILENAME_PATTERN = /[<>:"/\\|?*]/;
const INVALID_FILENAME_SANITIZE_PATTERN = /[<>:"/\\|?*]+/g;

type ValidateStatus = "success" | "warning" | "error" | "validating" | undefined;

interface PreviewResponseData {
  file_path: string;
  file_type: "text" | "image" | "html" | "pdf" | "video";
  mime_type: string;
  content: string;
  size: number;
  truncated?: boolean;
  encoding?: string;
}

interface NameAssessmentSummary {
  isReasonable: boolean;
  confidence: number;
  reasoning: string;
  qualityNotes: string[];
  suggestedNames: string[];
  appliedName?: string;
}

interface EditFileDetailLite {
  summary?: string;
  path?: string;
  category?: string;
  tags?: string[];
}

const extractExtension = (fileName: string): string => {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return trimmed.slice(lastDot);
};

const htmlToPlainText = (html: string): string => {
  if (!html) return "";
  try {
    if (typeof window !== "undefined" && typeof window.DOMParser !== "undefined") {
      const parser = new window.DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      return (doc.body?.textContent ?? "").trim();
    }
  } catch {
    // fall through to regex-based strip
  }
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

const extractTextFromPreview = (preview: PreviewResponseData | null | undefined): string => {
  if (!preview) return "";
  if (preview.file_type === "text") {
    return preview.content ?? "";
  }
  if (preview.file_type === "html") {
    return htmlToPlainText(preview.content ?? "");
  }
  return "";
};

const normalizeSuggestedName = (suggestion: string, referenceName: string): string => {
  const trimmed = suggestion.trim();
  if (!trimmed) return "";
  let sanitized = trimmed.replace(INVALID_FILENAME_SANITIZE_PATTERN, "_");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  sanitized = sanitized.replace(/^[.]+/, "");
  sanitized = sanitized.replace(/[. ]+$/, "");
  if (!sanitized) return "";

  const referenceExt = extractExtension(referenceName);
  let finalName = sanitized;
  const suggestionExt = extractExtension(sanitized);

  if (referenceExt) {
    if (!suggestionExt) {
      finalName = `${sanitized}${referenceExt}`;
    } else if (suggestionExt.toLowerCase() !== referenceExt.toLowerCase()) {
      const base = sanitized.slice(0, sanitized.length - suggestionExt.length);
      finalName = `${base}${referenceExt}`;
    }
  }

  if (finalName.length > 180) {
    const ext = extractExtension(finalName);
    const baseLength = ext ? 180 - ext.length : 180;
    const base = ext ? finalName.slice(0, finalName.length - ext.length) : finalName;
    finalName = `${base.slice(0, Math.max(1, baseLength))}${ext}`;
  }

  return finalName.replace(INVALID_FILENAME_SANITIZE_PATTERN, "_");
};

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

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
  const { t, locale } = useTranslation();
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
  const [nameAssessing, setNameAssessing] = useState(false);
  const [nameAssessment, setNameAssessment] = useState<NameAssessmentSummary | null>(null);
  const [nameAssessmentStatus, setNameAssessmentStatus] = useState<ValidateStatus>(undefined);
  const [editFileDetail, setEditFileDetail] = useState<EditFileDetailLite | null>(null);
  const [editSourceContent, setEditSourceContent] = useState<string>("");

  const translateOrFallback = useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) => {
      const translated = t(key, params);
      return translated === key ? fallback : translated;
    },
    [t]
  );

  const closeEditModal = useCallback(() => {
    setEditVisible(false);
    setEditingFile(null);
    setEditing(false);
    setNameAssessment(null);
    setNameAssessmentStatus(undefined);
    setEditSourceContent("");
    setEditFileDetail(null);
    setNameAssessing(false);
    editForm.resetFields();
  }, [editForm]);

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
    setNameAssessment(null);
    setNameAssessmentStatus(undefined);
    setEditSourceContent("");
    setEditFileDetail(null);
    setNameAssessing(false);
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
        setEditFileDetail({
          summary: d.summary,
          path: d.path,
          category: d.category,
          tags: d.tags,
        });
      }
    } catch {
      // ignore detail fetch error; keep row values
    }
  };

  const handleValidateFileName = useCallback(async () => {
    if (!editingFile) {
      return;
    }

    const values = editForm.getFieldsValue();
    const currentName = (values.name ?? "").trim();
    if (!currentName) {
      message.warning(
        translateOrFallback(
          "files.messages.editInvalidName",
          "Please enter a valid file name"
        )
      );
      return;
    }

    setNameAssessing(true);
    setNameAssessmentStatus("validating");
    setNameAssessment(null);

    let hideLoading: (() => void) | undefined;

    try {
      hideLoading = message.loading(
        translateOrFallback(
          "files.messages.fileNameAssessmentChecking",
          "Checking file name..."
        ),
        0
      );

      let sourceText = editSourceContent;
      const formPath = typeof values.path === "string" ? values.path.trim() : "";
      const targetPath = formPath || editingFile.path;

      if (!sourceText && targetPath) {
        try {
          const previewResp = await apiService.previewFile(targetPath, { origin: true });
          if (previewResp.success && previewResp.data) {
            const previewData = previewResp.data as PreviewResponseData;
            const extracted = extractTextFromPreview(previewData);
            if (extracted) {
              const truncated = extracted.slice(0, MAX_NAME_ASSESSMENT_TEXT);
              const prepared = truncated.trim();
              if (prepared) {
                sourceText = prepared;
                setEditSourceContent(prepared);
              }
            }
          }
        } catch (error) {
          console.warn("Failed to load preview for file name assessment", error);
        }
      }

      if (!sourceText) {
        const fallbackSummary = (editFileDetail?.summary ?? editingFile.summary ?? "").trim();
        if (fallbackSummary) {
          const truncated = fallbackSummary.slice(0, MAX_NAME_ASSESSMENT_TEXT);
          const prepared = truncated.trim();
          if (prepared) {
            sourceText = prepared;
            setEditSourceContent(prepared);
          }
        }
      }

      if (!sourceText && !editingFile.file_id) {
        setNameAssessmentStatus("warning");
        message.warning(
          translateOrFallback(
            "files.messages.fileNameAssessmentNoContent",
            "Unable to access file content for evaluation."
          )
        );
        return;
      }

      const preparedContent = (sourceText ?? "").trim();
      if (!preparedContent && !editingFile.file_id) {
        setNameAssessmentStatus("warning");
        message.warning(
          translateOrFallback(
            "files.messages.fileNameAssessmentNoContent",
            "Unable to access file content for evaluation."
          )
        );
        return;
      }

      const assessmentResp = await apiService.validateFileName({
        fileId: editingFile.file_id,
        fileName: currentName,
        ...(preparedContent ? { fileContent: preparedContent } : {}),
        language: locale,
      });

      if (!assessmentResp.success || !assessmentResp.data) {
        throw new Error(assessmentResp.message || "File name assessment failed");
      }

      const assessment = assessmentResp.data as FileNameAssessmentResult;
      const qualityNotes = Array.isArray(assessment.quality_notes)
        ? (assessment.quality_notes as unknown[])
            .map((note: unknown) => (typeof note === "string" ? note.trim() : ""))
            .filter((note): note is string => note.length > 0)
        : [];
      const suggestedNames = Array.isArray(assessment.suggested_names)
        ? (assessment.suggested_names as unknown[])
            .map((candidate: unknown) =>
              typeof candidate === "string" ? candidate.trim() : ""
            )
            .filter((candidate): candidate is string => candidate.length > 0)
        : [];

      const summary: NameAssessmentSummary = {
        isReasonable: assessment.is_reasonable,
        confidence:
          typeof assessment.confidence === "number" && Number.isFinite(assessment.confidence)
            ? assessment.confidence
            : 0,
        reasoning:
          typeof assessment.reasoning === "string" ? assessment.reasoning.trim() : "",
        qualityNotes,
        suggestedNames,
      };

      if (summary.isReasonable) {
        setNameAssessment(summary);
        setNameAssessmentStatus("success");
        const confidencePercent = Math.round(summary.confidence * 100);
        if (confidencePercent > 0) {
          message.success(
            translateOrFallback(
              "files.messages.fileNameAssessmentPositiveWithConfidence",
              `Current file name already looks good (confidence ${confidencePercent}%).`,
              { confidence: confidencePercent }
            )
          );
        } else {
          message.success(
            translateOrFallback(
              "files.messages.fileNameAssessmentPositive",
              "Current file name already looks good."
            )
          );
        }
        return;
      }

      const suggestion = summary.suggestedNames[0];
      if (!suggestion) {
        setNameAssessment(summary);
        setNameAssessmentStatus("warning");
        message.warning(
          translateOrFallback(
            "files.messages.fileNameAssessmentNoSuggestion",
            "No better file name suggestions were returned."
          )
        );
        return;
      }

      const normalizedSuggestion = normalizeSuggestedName(suggestion, currentName);
      if (!normalizedSuggestion) {
        setNameAssessment(summary);
        setNameAssessmentStatus("warning");
        message.warning(
          translateOrFallback(
            "files.messages.fileNameAssessmentSuggestionInvalid",
            "Suggested file name is invalid."
          )
        );
        return;
      }

      if (normalizedSuggestion.toLowerCase() === currentName.toLowerCase()) {
        setNameAssessment(summary);
        setNameAssessmentStatus("warning");
        message.info(
          translateOrFallback(
            "files.messages.fileNameAssessmentSuggestionSame",
            "Suggested file name matches the current name."
          )
        );
        return;
      }

      if (INVALID_FILENAME_PATTERN.test(normalizedSuggestion)) {
        setNameAssessment(summary);
        setNameAssessmentStatus("warning");
        message.warning(
          translateOrFallback(
            "files.messages.fileNameAssessmentSuggestionInvalid",
            "Suggested file name is invalid."
          )
        );
        return;
      }

      const updateResp = await apiService.updateFile({
        file_id: editingFile.file_id,
        name: normalizedSuggestion,
      });

      if (!updateResp.success || !updateResp.data) {
        throw new Error(updateResp.message || "Failed to update file name");
      }

      const updateData = updateResp.data as {
        name: string;
        path: string;
        category?: string;
        tags?: string[];
      };

      editForm.setFieldsValue({
        name: updateData.name,
        path: updateData.path,
        category: updateData.category ?? editForm.getFieldValue("category"),
        tags: updateData.tags ?? editForm.getFieldValue("tags"),
      });

      setEditingFile((prev) =>
        prev
          ? {
              ...prev,
              name: updateData.name,
              path: updateData.path,
              category: updateData.category ?? prev.category,
              tags: Array.isArray(updateData.tags) ? updateData.tags : prev.tags,
            }
          : prev
      );
      setEditFileDetail((prev) =>
        prev
          ? {
              ...prev,
              path: updateData.path,
              category: updateData.category ?? prev.category,
              tags: Array.isArray(updateData.tags) ? updateData.tags : prev.tags,
            }
          : prev
      );

      summary.appliedName = updateData.name;
      setNameAssessment(summary);
      setNameAssessmentStatus("success");

      message.success(
        translateOrFallback(
          "files.messages.fileNameAssessmentRenamed",
          `File renamed to ${updateData.name}.`,
          { name: updateData.name }
        )
      );

      await fetchFiles(currentPageRef.current || 1);
    } catch (error) {
      console.error("File name assessment failed", error);
      setNameAssessmentStatus("error");
      const errMsg = (error as Error)?.message;
      message.error(
        errMsg && errMsg.trim().length > 0
          ? errMsg
          : translateOrFallback(
              "files.messages.fileNameAssessmentFailed",
              "Failed to validate file name."
            )
      );
    } finally {
      if (hideLoading) hideLoading();
      setNameAssessing(false);
    }
  }, [
    editFileDetail,
    editForm,
    editSourceContent,
    editingFile,
    fetchFiles,
    locale,
    translateOrFallback,
  ]);

  const nameAssessmentHelp = useMemo(() => {
    if (!nameAssessment) {
      return null;
    }

    const lines: string[] = [];

    if (Number.isFinite(nameAssessment.confidence) && nameAssessment.confidence > 0) {
      const confidencePercent = Math.round(nameAssessment.confidence * 100);
      lines.push(
        translateOrFallback(
          "files.edit.assessmentConfidence",
          `Confidence: ${confidencePercent}%`,
          { confidence: confidencePercent }
        )
      );
    }

    if (nameAssessment.reasoning) {
      lines.push(nameAssessment.reasoning);
    }

    if (nameAssessment.appliedName) {
      lines.push(
        translateOrFallback(
          "files.edit.assessmentRenamed",
          `Renamed to: ${nameAssessment.appliedName}`,
          { name: nameAssessment.appliedName }
        )
      );
    }

    if (nameAssessment.qualityNotes.length > 0) {
      const joinedNotes = nameAssessment.qualityNotes.join("; ");
      lines.push(
        translateOrFallback(
          "files.edit.assessmentNotes",
          `Notes: ${joinedNotes}`,
          { notes: joinedNotes }
        )
      );
    }

    if (lines.length === 0) {
      return null;
    }

    return (
      <div>
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    );
  }, [nameAssessment, translateOrFallback]);

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
        setEditing(false);
  closeEditModal();
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
        onCancel={closeEditModal}
        confirmLoading={editing}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item label={t("files.table.columns.path")} name="path">
            <Input disabled />
          </Form.Item>
          <Form.Item
            label={
              <Space size={8} align="center">
                <span>{t("files.table.columns.name")}</span>
                <Button
                  type="link"
                  size="small"
                  onClick={handleValidateFileName}
                  loading={nameAssessing}
                  disabled={!editingFile}
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {translateOrFallback("files.edit.suggestNameButton", "Check name")}
                </Button>
              </Space>
            }
            name="name"
            rules={[
              {
                required: true,
                message:
                  t("files.messages.editInvalidName") || "Please input name",
              },
            ]}
            validateStatus={nameAssessmentStatus}
            hasFeedback={Boolean(nameAssessmentStatus)}
            help={nameAssessmentHelp}
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
  const [webImporting, setWebImporting] = useState(false);
  const { token } = theme.useToken();

  const outerLayoutStyle = useMemo(
    () => ({
      minHeight: "100vh",
      background: token.colorBgLayout,
      transition: "background-color 0.3s ease",
    }),
    [token.colorBgLayout]
  );

  const innerLayoutStyle = useMemo(
    () => ({
      padding: "0 24px 24px",
      background: token.colorBgLayout,
      transition: "background-color 0.3s ease",
    }),
    [token.colorBgLayout]
  );

  const contentStyle = useMemo(
    () => ({
      padding: 24,
      margin: 0,
      minHeight: 280,
      background: token.colorBgContainer,
      transition: "background-color 0.3s ease",
    }),
    [token.colorBgContainer]
  );
  const secondaryTextColor = token.colorTextTertiary;

  // URL input modal states
  const [urlInputVisible, setUrlInputVisible] = useState(false);
  const [urlInputValue, setUrlInputValue] = useState("");
  const [batchImporting, setBatchImporting] = useState(false);

  // Work directory for creating folders under
  const [workDirectory, setWorkDirectory] = useState<string>("workdir");
  // Create folder modal state
  const [createFolderVisible, setCreateFolderVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ folderName: string }>();

  // Import flow is encapsulated in FileImport component now.

  const importFileFromPath = useCallback(
    async (filePath: string) => {
      try {
        await importRef.current?.importFile(filePath);
      } catch (error) {
        window.electronAPI?.logError?.("files-import-file-failed", {
          err: String(error),
          filePath,
        });
        message.error(t("files.messages.fileImportFailed"));
      }
    },
    [t]
  );

  const readClipboardText = useCallback(async (): Promise<string> => {
    if (navigator?.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          return text;
        }
      } catch (error) {
        window.electronAPI?.logError?.("files-read-clipboard-browser-failed", {
          err: String(error),
        });
      }
    }

    if (window.electronAPI?.readClipboardText) {
      try {
        return await window.electronAPI.readClipboardText();
      } catch (error) {
        window.electronAPI?.logError?.("files-read-clipboard-electron-failed", {
          err: String(error),
        });
      }
    }

    return "";
  }, []);

  const handleWebImport = useCallback(
    async (rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (!trimmed) {
        message.warning(t("bot.messages.invalidUrl"));
        return;
      }
      if (!isValidHttpUrl(trimmed)) {
        message.error(t("bot.messages.invalidUrl"));
        return;
      }
      if (webImporting) {
        message.info(t("bot.messages.webImportInProgress"));
        return;
      }

      setWebImporting(true);
      let hideLoading: (() => void) | undefined;
      try {
        hideLoading = message.loading(t("bot.messages.fetchingWebpage"), 0);
        const response = await apiService.convertWebpage({ url: trimmed });
        const data = response.data as { output_file_path?: string };
        if (!data || !data.output_file_path) {
          throw new Error("missing_output_path");
        }
        await importFileFromPath(data.output_file_path);
        message.success(t("bot.messages.webImportSuccess"));
      } catch (error) {
        window.electronAPI?.logError?.("files-web-import-failed", {
          url: trimmed,
          err: String(error),
        });
        message.error(t("bot.messages.webImportFailed"));
      } finally {
        if (hideLoading) {
          hideLoading();
        }
        setWebImporting(false);
      }
    },
    [importFileFromPath, t, webImporting]
  );

  const handleBatchWebImport = useCallback(async (urls: string[]) => {
    setBatchImporting(true);
    try {
      for (const url of urls) {
        await handleWebImport(url);
      }
    } finally {
      setBatchImporting(false);
    }
  }, [handleWebImport]);

  const handleImportClipboardUrl = useCallback(async () => {
    try {
      const clipboardText = await readClipboardText();
      if (clipboardText) {
        const urls = clipboardText.split('\n').map(u => u.trim()).filter(u => u && isValidHttpUrl(u));
        if (urls.length > 0) {
          if (urls.length === 1) {
            setUrlInputValue(urls[0]);
            setUrlInputVisible(true);
          } else {
            await handleBatchWebImport(urls);
          }
          return;
        }
      }
      // No valid URLs in clipboard
      setUrlInputValue("");
      setUrlInputVisible(true);
    } catch (error) {
      window.electronAPI?.logError?.("files-import-clipboard-url-failed", {
        err: String(error),
      });
      message.error(t("bot.messages.webImportFailed"));
    }
  }, [readClipboardText, t, handleBatchWebImport]);

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

  useEffect(() => {
    const handlePasteShortcut = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName?.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const pastedText = event.clipboardData?.getData("text")?.trim();
      if (!pastedText || !isValidHttpUrl(pastedText)) {
        return;
      }

      event.preventDefault();
      void handleWebImport(pastedText);
    };

    window.addEventListener("paste", handlePasteShortcut);
    return () => {
      window.removeEventListener("paste", handlePasteShortcut);
    };
  }, [handleWebImport]);

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

  // Handle URL input modal OK
  const handleUrlInputOk = async () => {
    const urls = urlInputValue.split('\n').map(u => u.trim()).filter(u => u && isValidHttpUrl(u));
    if (urls.length === 0) {
      message.warning(t("bot.messages.invalidUrl"));
      return;
    }
    setUrlInputVisible(false);
    setUrlInputValue("");
    await handleBatchWebImport(urls);
  };

  return (
    <Layout style={outerLayoutStyle}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout style={innerLayoutStyle}>
        <Content style={contentStyle}>
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
                icon={<LinkOutlined />}
                onClick={handleImportClipboardUrl}
                size="large"
                loading={webImporting || batchImporting}
                disabled={webImporting || batchImporting}
              >
                {t("files.buttons.importUrl")}
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

          <FileList
            refreshTrigger={refreshTrigger}
            onRetryImport={handleRetryImport}
          />
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
              <div style={{ color: secondaryTextColor, fontSize: 12 }}>
                {t("files.createFolder.help")}: {workDirectory}
              </div>
            </Form>
          </Modal>

          <Modal
            open={urlInputVisible}
            title={t("files.urlInput.modalTitle")}
            okText={t("files.urlInput.okText")}
            cancelText={t("files.urlInput.cancelText")}
            onOk={handleUrlInputOk}
            onCancel={() => {
              setUrlInputVisible(false);
              setUrlInputValue("");
            }}
            confirmLoading={batchImporting}
            destroyOnHidden
          >
            <Input.TextArea
              value={urlInputValue}
              onChange={(e) => setUrlInputValue(e.target.value)}
              placeholder={t("files.urlInput.placeholder")}
              rows={6}
              allowClear
            />
          </Modal>
        </Content>
      </Layout>
    </Layout>
  );
};

export default FilesPage;
