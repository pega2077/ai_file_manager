import { useState, useEffect } from "react";
import {
  Layout,
  Input,
  Button,
  Spin,
  message,
  Tag,
  Card,
  Slider,
  InputNumber,
  Modal,
  Space,
  Tooltip,
} from "antd";
import { CopyOutlined, EyeOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import {
  apiService,
  QuestionResponse,
  SemanticSearchResult,
  SummarizeDocumentsResult,
} from "../services/api";
import Sidebar from "../components/Sidebar";
import { useTranslation } from "../shared/i18n/I18nProvider";

const { Content } = Layout;
const { Search } = Input;

interface SearchResult {
  file_id: string;
  file_name: string;
  file_path: string;
  file_type: string;
  category: string;
  size: number;
  created_at: string;
  tags: string[];
}

type AnswerResult =
  | { kind: "retrieval"; payload: QuestionResponse }
  | { kind: "summary"; payload: SummarizeDocumentsResult };

const SearchPage = () => {
  const { t, locale } = useTranslation();
  const [searchParams] = useSearchParams();
  const selectedMenu = "search";

  const [questionQuery, setQuestionQuery] = useState("");
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [referencedFiles, setReferencedFiles] = useState<SearchResult[]>([]);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.4);
  const [contextLimit, setContextLimit] = useState(5);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [temperature, setTemperature] = useState(0.7);
  const [searchResults, setSearchResults] = useState<SemanticSearchResult[]>(
    []
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");

  useEffect(() => {
    const type = searchParams.get("type");
    const fileIdsParam = searchParams.get("fileIds");

    if (type === "qa" && fileIdsParam) {
      const fileIds = fileIdsParam.split(",").filter((id) => id && id.trim());
      const loadReferencedFiles = async () => {
        try {
          const files: SearchResult[] = [];
          for (const fileId of fileIds) {
            const normalizedId = fileId?.trim();
            if (!normalizedId) {
              continue;
            }

            try {
              const response = await apiService.getFileDetail(normalizedId);
              if (response.success && response.data) {
                const fileData = response.data as {
                  id?: string;
                  file_id?: string;
                  name: string;
                  path: string;
                  type: string;
                  category: string;
                  size: number;
                  created_at: string;
                  tags?: string[];
                };

                const actualFileId = fileData.file_id || fileData.id;
                if (!actualFileId) {
                  continue;
                }

                files.push({
                  file_id: actualFileId,
                  file_name: fileData.name,
                  file_path: fileData.path,
                  file_type: fileData.type,
                  category: fileData.category,
                  size: fileData.size,
                  created_at: fileData.created_at,
                  tags: fileData.tags || [],
                });
              }
            } catch (innerError) {
              console.warn("Skip invalid referenced file id", innerError);
            }
          }
          setReferencedFiles(files);
        } catch (error) {
          console.error("Failed to load referenced files:", error);
          message.error(t("search.messages.loadReferencedFilesFailed"));
        }
      };

      void loadReferencedFiles();
    }
  }, [searchParams, t]);

  const handleAskQuestion = async (value: string) => {
    const query = value.trim();
    if (!query) {
      message.warning(t("search.messages.emptyQuestion"));
      return;
    }

    setQuestionQuery(value);
    setAnswerResult(null);
    setSearchResults([]);
    setAnswerLoading(true);
    setSearchLoading(false);
    setHasSearched(false);

    const referencedFileIds = referencedFiles
      .map((file) => file.file_id)
      .filter((id): id is string => Boolean(id && id.trim()));

    let detectedPurpose: "retrieval" | "summary" = "retrieval";
    try {
      const purposeResponse = await apiService.queryPurpose(query, {
        temperature,
        max_tokens: maxTokens,
        language: locale,
      });

      if (purposeResponse.success && purposeResponse.data) {
        detectedPurpose = purposeResponse.data.purpose;
      } else {
        message.warning(
          purposeResponse.message || t("search.messages.queryPurposeFallback")
        );
      }
    } catch (error) {
      console.error("Query purpose analysis failed:", error);
      message.warning(t("search.messages.queryPurposeFallback"));
    }

    if (detectedPurpose === "summary" && referencedFileIds.length === 0) {
      message.warning(t("search.messages.summaryNoDocuments"));
      detectedPurpose = "retrieval";
    }

    if (detectedPurpose === "summary") {
      try {
        const summaryResponse = await apiService.summarizeDocuments(
          referencedFileIds,
          {
            instruction: query,
            temperature,
            max_tokens: maxTokens,
            language: locale,
          }
        );

        if (summaryResponse.success && summaryResponse.data) {
          setAnswerResult({ kind: "summary", payload: summaryResponse.data });
        } else {
          message.error(
            summaryResponse.message || t("search.messages.summaryFailed")
          );
        }
      } catch (error) {
        console.error("Summarize documents error:", error);
        message.error(t("search.messages.summaryFailed"));
      } finally {
        setAnswerLoading(false);
      }

      return;
    }

    setHasSearched(true);
    setSearchLoading(true);
    let semanticResults: SemanticSearchResult[] = [];
    let semanticSearchFailed = false;

    try {
      const semanticResponse = await apiService.semanticSearch(query, {
        limit: Math.max(5, contextLimit),
        similarity_threshold: similarityThreshold,
        file_filters:
          referencedFileIds.length > 0
            ? { file_ids: referencedFileIds }
            : undefined,
      });

      if (semanticResponse.success && semanticResponse.data) {
        semanticResults = semanticResponse.data.results || [];
        setSearchResults(semanticResults);
      } else {
        semanticSearchFailed = true;
        setSearchResults([]);
        message.error(
          semanticResponse.message || t("search.messages.semanticSearchFailed")
        );
      }
    } catch (error) {
      semanticSearchFailed = true;
      console.error("Semantic search error:", error);
      setSearchResults([]);
      message.error(t("search.messages.semanticSearchFailed"));
    } finally {
      setSearchLoading(false);
    }

    if (semanticSearchFailed) {
      setAnswerLoading(false);
      return;
    }

    if (semanticResults.length === 0) {
      message.warning(t("search.messages.searchNoResults"));
      setAnswerLoading(false);
      return;
    }

    const topResults = semanticResults.slice(0, 5);
    const topFileIds = Array.from(
      new Set(
        topResults
          .map((result) => result.file_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    try {
      const response = await apiService.askQuestion(query, {
        context_limit: contextLimit,
        similarity_threshold: similarityThreshold,
        temperature,
        max_tokens: maxTokens,
        file_filters:
          topFileIds.length > 0 ? { file_ids: topFileIds } : undefined,
      });

      if (response.success) {
        setAnswerResult({ kind: "retrieval", payload: response.data });
      } else {
        message.error(response.message || t("search.messages.askFailed"));
      }
    } catch (error) {
      console.error("Ask question error:", error);
      message.error(t("search.messages.askRequestFailed"));
    } finally {
      setAnswerLoading(false);
    }
  };

  const handlePreviewResult = (result: SemanticSearchResult) => {
    setPreviewContent(result.chunk_content);
    setPreviewTitle(
      `${result.file_name} · ${t("search.qa.chunk", { index: result.chunk_index + 1 })}`
    );
    setPreviewVisible(true);
  };

  const handleCopySnippetAndOpen = async (result: SemanticSearchResult) => {
    const normalizedContent = result.chunk_content.replace(/\s+/g, " ").trim();
    const snippet = normalizedContent.slice(0, 20);

    if (!snippet) {
      message.warning(t("search.qa.noResultsPlaceholder"));
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(snippet);
        message.success(t("search.messages.copySuccess", { text: snippet }));
      } else {
        message.error(t("search.messages.copyFailed"));
        return;
      }
    } catch (error) {
      console.error("Copy snippet failed:", error);
      message.error(t("search.messages.copyFailed"));
      return;
    }

    if (!result.file_path) {
      message.error(t("search.messages.openFileFailed"));
      return;
    }

    try {
      if (window.electronAPI?.openFile) {
        const opened = await window.electronAPI.openFile(result.file_path);
        if (!opened) {
          message.error(t("search.messages.openFileFailed"));
        }
      } else {
        message.error(t("search.messages.openFileNotSupported"));
      }
    } catch (error) {
      console.error("Open file from snippet failed:", error);
      message.error(t("search.messages.openFileFailed"));
    }
  };

  return (
    <>
      <Layout style={{ minHeight: "100vh" }}>
      <Sidebar selectedMenu={selectedMenu} />
      <Layout>
        <Content style={{ padding: "24px", background: "#fff" }}>
          <div style={{ marginBottom: "24px" }}>
            {referencedFiles.length > 0 && (
              <Card
                size="small"
                style={{
                  marginBottom: "16px",
                  background: "#f6ffed",
                  border: "1px solid #b7eb8f",
                }}
                title={
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>📄 {t("search.qa.referencedFiles")}</span>
                    <Tag color="green">{referencedFiles.length}</Tag>
                  </div>
                }
              >
                {referencedFiles.map((file) => (
                  <div key={file.file_id} style={{ marginBottom: "8px" }}>
                    <div style={{ fontWeight: "bold", fontSize: "14px" }}>
                      {file.file_name}
                    </div>
                    <div style={{ color: "#666", fontSize: "12px" }}>
                      {file.file_path}
                    </div>
                  </div>
                ))}
              </Card>
            )}

            <Card size="small" style={{ marginBottom: "16px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    flex: "1 1 220px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <span style={{ fontWeight: "bold", minWidth: "120px" }}>
                    {t("search.qa.similarityThreshold")}:
                  </span>
                  <Slider
                    min={0}
                    max={1}
                    step={0.1}
                    value={similarityThreshold}
                    onChange={setSimilarityThreshold}
                    style={{ flex: 1, minWidth: "140px" }}
                    tooltip={{
                      formatter: (value) => `${(value! * 100).toFixed(0)}%`,
                    }}
                  />
                  <span style={{ minWidth: "40px", textAlign: "right" }}>
                    {(similarityThreshold * 100).toFixed(0)}%
                  </span>
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span style={{ fontWeight: "bold", minWidth: "100px" }}>
                    {t("search.qa.contextLimit")}:
                  </span>
                  <InputNumber
                    min={1}
                    max={20}
                    value={contextLimit}
                    onChange={(value) => setContextLimit(value || 5)}
                    style={{ width: "80px" }}
                  />
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span style={{ fontWeight: "bold", minWidth: "100px" }}>
                    {t("search.qa.maxTokens")}:
                  </span>
                  <InputNumber
                    min={100}
                    max={4000}
                    step={100}
                    value={maxTokens}
                    onChange={(value) => setMaxTokens(value || 1000)}
                    style={{ width: "100px" }}
                  />
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span style={{ fontWeight: "bold", minWidth: "100px" }}>
                    {t("search.qa.temperature")}:
                  </span>
                  <InputNumber
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(value) => setTemperature(value || 0.7)}
                    style={{ width: "80px" }}
                  />
                </div>
              </div>
            </Card>

            <Search
              placeholder={t("search.placeholders.qa")}
              enterButton={
                <Button type="primary" icon={<QuestionCircleOutlined />}>
                  {t("search.buttons.ask")}
                </Button>
              }
              size="large"
              value={questionQuery}
              onChange={(e) => setQuestionQuery(e.target.value)}
              onSearch={handleAskQuestion}
              loading={answerLoading}
            />
          </div>

          <Card style={{ minHeight: "160px" }} bodyStyle={{ padding: "24px" }}>
            {answerLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <Spin size="large" />
                <div style={{ marginTop: "16px" }}>
                  {t("search.loading.thinking")}
                </div>
              </div>
            ) : answerResult ? (
              answerResult.kind === "retrieval" ? (
                <div
                  style={{
                    fontSize: "16px",
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    color: "#222",
                  }}
                >
                  {answerResult.payload.answer}
                </div>
              ) : (
                <div style={{ color: "#222" }}>
                  <div
                    style={{
                      fontSize: "16px",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {answerResult.payload.summary}
                  </div>
                  <div style={{ marginTop: "16px", fontSize: "13px" }}>
                    <strong>{t("search.qa.summaryConfidence")}:</strong>{" "}
                    {(answerResult.payload.confidence * 100).toFixed(0)}%
                  </div>
                  {answerResult.payload.highlights &&
                    answerResult.payload.highlights.length > 0 && (
                    <div style={{ marginTop: "16px" }}>
                      <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
                        {t("search.qa.summaryHighlights")}
                      </div>
                      <ul style={{ paddingLeft: "18px", marginBottom: 0 }}>
                        {answerResult.payload.highlights.map((item, index) => (
                          <li key={`${item}-${index}`} style={{ marginBottom: "4px" }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {answerResult.payload.documents &&
                    answerResult.payload.documents.length > 0 && (
                    <div style={{ marginTop: "16px" }}>
                      <div style={{ fontWeight: "bold", marginBottom: "8px" }}>
                        {t("search.qa.summaryDocumentsTitle")}
                      </div>
                      <ul style={{ paddingLeft: "18px", marginBottom: 0 }}>
                        {answerResult.payload.documents.map((doc) => (
                          <li key={doc.file_id} style={{ marginBottom: "6px" }}>
                            <div style={{ fontWeight: 500 }}>{doc.file_name || doc.file_path}</div>
                            {doc.file_path && (
                              <div style={{ fontSize: "12px", color: "#666" }}>
                                {doc.file_path}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div style={{ color: "#999", textAlign: "center" }}>
                {t("search.qa.answerPlaceholder")}
              </div>
            )}
          </Card>

          {hasSearched && (
            <Card
              size="small"
              style={{ marginBottom: "16px" }}
              title={
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <span>🔍 {t("search.qa.searchResultsTitle")}</span>
                  <Tag color="blue">
                    {t("search.qa.resultsCount", {
                      count: searchResults.length,
                    })}
                  </Tag>
                </div>
              }
            >
              {searchLoading ? (
                <div style={{ textAlign: "center", padding: "16px 0" }}>
                  <Spin />
                  <div style={{ marginTop: "8px" }}>
                    {t("search.loading.searching")}
                  </div>
                </div>
              ) : searchResults.length > 0 ? (
                searchResults.map((result) => {
                  const snippet =
                    result.chunk_content.length > 200
                      ? `${result.chunk_content.slice(0, 200)}...`
                      : result.chunk_content;

                  return (
                    <div key={result.chunk_id} style={{ marginBottom: "12px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: "bold", fontSize: "14px" }}>
                          {result.file_name}
                        </div>
                        <Tag color="geekblue">{`${(
                          result.similarity_score * 100
                        ).toFixed(0)}%`}</Tag>
                      </div>
                      <div
                        style={{
                          color: "#666",
                          fontSize: "12px",
                          marginBottom: "4px",
                        }}
                      >
                        {result.file_path}
                      </div>
                      <div
                        style={{
                          color: "#333",
                          fontSize: "13px",
                          lineHeight: 1.6,
                        }}
                      >
                        {snippet}
                      </div>
                      <Space style={{ marginTop: "8px" }}>
                        <Tooltip title={t("search.qa.preview")}>
                          <Button
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={() => handlePreviewResult(result)}
                          >
                            {t("search.qa.preview")}
                          </Button>
                        </Tooltip>
                        <Tooltip title={t("search.qa.openSourceFileTooltip")}> 
                          <Button
                            size="small"
                            type="primary"
                            icon={<CopyOutlined />}
                            onClick={() => handleCopySnippetAndOpen(result)}
                          >
                            {t("search.qa.openSourceFile")}
                          </Button>
                        </Tooltip>
                      </Space>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: "#999", textAlign: "center" }}>
                  {t("search.qa.noResultsPlaceholder")}
                </div>
              )}
            </Card>
          )}
        </Content>
      </Layout>
    </Layout>

      <Modal
        open={previewVisible}
        title={previewTitle || t("search.qa.preview")}
        onCancel={() => setPreviewVisible(false)}
        onOk={() => setPreviewVisible(false)}
        okText={t("common.close")}
        cancelButtonProps={{ style: { display: "none" } }}
        width={720}
        bodyStyle={{ maxHeight: "60vh", overflowY: "auto" }}
      >
        <div
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "14px",
            lineHeight: 1.6,
            color: "#333",
          }}
        >
          {previewContent}
        </div>
      </Modal>
    </>
  );
};

export default SearchPage;
